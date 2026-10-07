import test from "node:test";
import assert from "node:assert/strict";
import { RedsysService, formatAmount, makeReference, formatRedsysDate } from "../static/src/app/redsys/redsys_service.js";
import { FakeTransport, AUTH_XML, QUERY_XML } from "./fake_transport.js";

const REF = "ODOO-AAAA1111";
const KEY = "SECRETKEY-123456";

async function setup(opts = {}) {
    const transport = new FakeTransport();
    let t = Date.UTC(2026, 9, 7, 10, 0, 0);
    const svc = new RedsysService({
        now: () => new Date(t),
        sleep: async () => {},
        callTimeoutMs: 0,
        initCooldownMs: 0,
        ...opts,
    });
    svc.configure({ merchant: "777888991", terminal: "1", signKey: KEY, port: "COM9:,19200,N,8,1", version: "6.1", transport });
    const r = await svc.init();
    assert.equal(r.ok, true);
    return { svc, transport, advance: (ms) => (t += ms) };
}

test("helpers: importe, referencia, fecha", () => {
    assert.equal(formatAmount(12.3), "12.30");
    assert.equal(formatAmount("12,34"), "12.34");
    assert.equal(formatAmount(1234.5), "1234.50");
    assert.equal(formatAmount(0), null);
    assert.equal(formatAmount(-1), null);
    assert.equal(formatAmount("abc"), null);
    assert.equal(makeReference("1a2b3c4d-9999"), "ODOO-1A2B3C4D");
    assert.equal(makeReference("zz"), null);
    assert.equal(formatRedsysDate(new Date(2007, 3, 15, 17, 29, 5)), "20070415 172905");
});

test("init: idempotente y pasa puerto/versión juntos", async () => {
    const { svc, transport } = await setup();
    assert.deepEqual((await svc.init()).ok, true);
    assert.equal(transport.count("init"), 1);
    assert.equal(transport.calls[0].args.length, 5);
});

test("init: sin puerto/versión se envían solo 3 argumentos", async () => {
    const transport = new FakeTransport();
    const svc = new RedsysService({ sleep: async () => {}, callTimeoutMs: 0 });
    svc.configure({ merchant: "1", terminal: "1", signKey: KEY, port: "COM1", transport });
    await svc.init();
    assert.equal(transport.calls[0].args.length, 3);
});

test("pay autorizado: guarda pedido/RTS y devuelve datos de tarjeta", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: 0, Result: AUTH_XML() });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.status, "authorized");
    assert.equal(r.pedido, "10549");
    assert.equal(r.rts, "070001070319153828378272");
    assert.equal(r.authCode, "080922");
    assert.equal(r.cardBrand, "MASTERCARD");
    assert.equal(r.last4, "0018");
    assert.deepEqual(transport.calls.at(-1).args, ["12.34", REF, "PAGO"]);
    assert.equal(svc.isBusy(), false);
});

test("pay denegado", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: 0, Result: AUTH_XML({ resultado: "Denegada", codigo: "190" }) });
    const r = await svc.pay({ amount: 5, reference: REF });
    assert.equal(r.status, "denied");
    assert.equal(r.errorCode, "190");
});

test("retorno 0 con estado distinto de F no autoriza (aunque diga Autorizada)", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: 0, Result: AUTH_XML({ estado: "P" }) });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([]) });
    const r = await svc.pay({ amount: 5, reference: REF });
    assert.notEqual(r.status, "authorized");
});

test("-2 + cobrado: recupera por consulta ±10 min por referencia", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -2, Result: null });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([{ factura: REF, pedido: "777", rts: "RTSX" }]) });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.status, "authorized");
    assert.equal(r.recovered, true);
    assert.equal(r.pedido, "777");
    assert.equal(r.rts, "RTSX");
    const q = transport.calls.find((c) => c.command === "fnDllOperConsulta").args;
    assert.equal(q[2], REF);
    const t0 = Date.UTC(2026, 9, 7, 10, 0, 0);
    assert.equal(q[3], formatRedsysDate(new Date(t0 - 600000))); // t0 - 10 min
    assert.equal(q[4], formatRedsysDate(new Date(t0 + 600000))); // t0 + 10 min
    assert.equal(q[5], "PAGO");
    assert.equal(transport.count("fnDllOperPinPad"), 1); // ningún reintento ciego
});

test("-2 + no cobrado: error reintentable, sin repetir el cobro", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -2, Result: null });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([]) });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.status, "error");
    assert.equal(r.errorCode, "NOT_CHARGED");
    assert.equal(r.retryable, true);
    assert.equal(transport.count("fnDllOperPinPad"), 1);
});

test("-2 + operaciones de otra referencia no cuentan", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -2, Result: null });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([{ factura: "OTRA" }]) });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.errorCode, "NOT_CHARGED");
});

test("-2 + la consulta falla: unknown, jamás reintento", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -2, Result: null });
    transport.queue("fnDllOperConsulta", { Response: -2, Result: null });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.status, "unknown");
    assert.equal(r.errorCode, "UNKNOWN_RESULT");
    assert.equal(transport.count("fnDllOperPinPad"), 1);
    assert.equal(transport.count("fnDllOperConsulta"), 1);
});

test("consulta: -3 reintenta una vez con cadenas vacías", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -2, Result: null });
    transport.queue("fnDllOperConsulta", { Response: -3, Result: null }, { Response: 0, Result: QUERY_XML([{ factura: REF }]) });
    const r = await svc.pay({ amount: 1, reference: REF });
    assert.equal(r.status, "authorized");
    const qs = transport.calls.filter((c) => c.command === "fnDllOperConsulta");
    assert.equal(qs[0].args[0], null);
    assert.equal(qs[1].args[0], "");
});

test("fallo de transporte (excepción) durante el cobro: se trata como -2", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { throws: true });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([{ factura: REF }]) });
    const r = await svc.pay({ amount: 1, reference: REF });
    assert.equal(r.status, "authorized");
});

test("timeout local del transporte durante el cobro (QA-02): consulta pero NUNCA concluye NOT_CHARGED", async () => {
    const { svc, transport } = await setup({ callTimeoutMs: 20 });
    transport.queue("fnDllOperPinPad", { never: true });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([]) });
    const r = await svc.pay({ amount: 1, reference: REF });
    assert.equal(r.status, "unknown");
    assert.equal(svc.state, "ready", "la máquina de estados no queda colgada");
    assert.equal(svc.isBusy(), true, "pero la DLL puede seguir esperando: ocupado hasta su retorno tardío / orphanMs");
});

test("timeout local + la consulta encuentra el cobro autorizado: se recupera", async () => {
    const { svc, transport } = await setup({ callTimeoutMs: 20 });
    transport.queue("fnDllOperPinPad", { never: true });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([{ factura: REF }]) });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.status, "authorized");
    assert.equal(r.recovered, true);
});

test("-1 en pago: reinit y UN reintento del pago (no se ejecutó)", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -1, Result: null }, { Response: 0, Result: AUTH_XML() });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.status, "authorized");
    assert.equal(transport.count("init"), 2);
    assert.equal(transport.count("fnDllOperPinPad"), 2);
});

test("-1 persistente: un solo reintento, luego error (nunca bucle)", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -1 }, { Response: -1 }, { Response: -1 });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.status, "error");
    assert.equal(transport.count("fnDllOperPinPad"), 2);
    assert.equal(transport.count("init"), 2);
});

test("-99 en pago: reinit + consulta, sin repetir el cobro a ciegas", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: -99 });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([]) });
    const r = await svc.pay({ amount: 12.34, reference: REF });
    assert.equal(r.errorCode, "NOT_CHARGED");
    assert.equal(transport.count("init"), 2);
    assert.equal(transport.count("fnDllOperPinPad"), 1);
});

test("init: -1 reintenta una sola vez con backoff y tiene éxito", async () => {
    const transport = new FakeTransport();
    const sleeps = [];
    const svc = new RedsysService({ sleep: async (ms) => sleeps.push(ms), callTimeoutMs: 0, initBackoffMs: 1500 });
    svc.configure({ merchant: "1", terminal: "1", signKey: KEY, transport });
    transport.initQueue.push({ Response: -1 }, { Response: 0 });
    const r = await svc.init();
    assert.equal(r.ok, true);
    assert.equal(transport.count("init"), 2);
    assert.deepEqual(sleeps, [1500]);
});

test("init: -99 dos veces falla tras exactamente 2 llamadas", async () => {
    const transport = new FakeTransport();
    const svc = new RedsysService({ sleep: async () => {}, callTimeoutMs: 0 });
    svc.configure({ merchant: "1", terminal: "1", signKey: KEY, transport });
    transport.initQueue.push({ Response: -99 }, { Response: -99 }, { Response: 0 });
    const r = await svc.init();
    assert.equal(r.ok, false);
    assert.equal(transport.count("init"), 2);
    assert.equal(svc.state, "failed");
});

test("init: enfriamiento tras fallo definitivo evita golpear la cuenta", async () => {
    const transport = new FakeTransport();
    const svc = new RedsysService({ sleep: async () => {}, callTimeoutMs: 0, initCooldownMs: 5000 });
    svc.configure({ merchant: "1", terminal: "1", signKey: KEY, transport });
    transport.initQueue.push({ Response: -18 });
    await svc.init();
    const again = await svc.init();
    assert.equal(again.cooldown, true);
    assert.equal(transport.count("init"), 1);
});

test("init: -18 no se reintenta y el mensaje es en español", async () => {
    const transport = new FakeTransport();
    const svc = new RedsysService({ sleep: async () => {}, callTimeoutMs: 0 });
    svc.configure({ merchant: "1", terminal: "1", signKey: KEY, transport });
    transport.initQueue.push({ Response: -18 });
    const r = await svc.init();
    assert.equal(r.ok, false);
    assert.equal(transport.count("init"), 1);
    assert.match(r.message, /comercio, terminal o clave/);
});

test("-40: librería caducada, mensaje específico y sin reintentos", async () => {
    const transport = new FakeTransport();
    const svc = new RedsysService({ sleep: async () => {}, callTimeoutMs: 0 });
    svc.configure({ merchant: "1", terminal: "1", signKey: KEY, transport });
    transport.initQueue.push({ Response: -40 });
    const r = await svc.init();
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "LIB_EXPIRED");
    assert.match(r.message, /caducado/);
    assert.equal(transport.count("init"), 1);
    // -40 durante un cobro
    const { svc: s2, transport: t2 } = await setup();
    t2.queue("fnDllOperPinPad", { Response: -40 });
    const p = await s2.pay({ amount: 1, reference: REF });
    assert.equal(p.errorCode, "LIB_EXPIRED");
    assert.equal(t2.count("fnDllOperPinPad"), 1);
});

test("doble llamada simultánea: la segunda recibe BUSY sin tocar el transporte", async () => {
    const { svc, transport } = await setup();
    let release;
    transport.queue("fnDllOperPinPad", (args) => {
        return { never: true, release: (r) => r };
    });
    // Respuesta diferida controlada manualmente
    const origExec = transport.execFnDll.bind(transport);
    transport.execFnDll = (command, args, cb) => {
        if (command === "fnDllOperPinPad") {
            transport.calls.push({ command, args });
            release = () => cb({ Response: 0, Result: AUTH_XML() });
            return;
        }
        origExec(command, args, cb);
    };
    const first = svc.pay({ amount: 12.34, reference: REF });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(svc.isBusy(), true);
    const second = await svc.pay({ amount: 12.34, reference: "ODOO-BBBB2222" });
    assert.equal(second.status, "error");
    assert.equal(second.errorCode, "BUSY");
    const refund = await svc.refund({ pedido: "1", rts: "R", amount: 1, reference: "ODOO-CCCC3333" });
    assert.equal(refund.errorCode, "BUSY");
    assert.equal(transport.count("fnDllOperPinPad"), 1);
    release();
    const r1 = await first;
    assert.equal(r1.status, "authorized");
    assert.equal(svc.isBusy(), false);
});

test("doble llamada en el mismo tick: solo una llega al transporte", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", { Response: 0, Result: AUTH_XML() });
    const [a, b] = await Promise.all([
        svc.pay({ amount: 12.34, reference: REF }),
        svc.pay({ amount: 12.34, reference: REF }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), ["authorized", "error"]);
    assert.equal(transport.count("fnDllOperPinPad"), 1);
});

test("parámetros inválidos no llegan al transporte", async () => {
    const { svc, transport } = await setup();
    assert.equal((await svc.pay({ amount: 0, reference: REF })).errorCode, "INVALID_PARAMS");
    assert.equal((await svc.pay({ amount: 1, reference: "X".repeat(21) })).errorCode, "INVALID_PARAMS");
    assert.equal(transport.count("fnDllOperPinPad"), 0);
});

test("refund autorizado y argumentos de fnDllOperComContable", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperComContable", { Response: 0, Result: AUTH_XML({ pedido: "20001", factura: "ODOO-REF00001" }) });
    const r = await svc.refund({ pedido: "10549", rts: "RTSORIG", amount: 5, reference: "ODOO-REF00001" });
    assert.equal(r.status, "authorized");
    assert.equal(r.pedido, "20001");
    assert.deepEqual(transport.calls.at(-1).args, ["10549", "RTSORIG", "5.00", "ODOO-REF00001", "DEVOLUCION"]);
});

test("refund -2: recupera por consulta de tipo DEVOLUCION", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperComContable", { Response: -2 });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([{ factura: "ODOO-REF00001", pedido: "20002" }]) });
    const r = await svc.refund({ pedido: "10549", rts: "R", amount: 5, reference: "ODOO-REF00001" });
    assert.equal(r.status, "authorized");
    assert.equal(transport.calls.find((c) => c.command === "fnDllOperConsulta").args[5], "DEVOLUCION");
});

test("error de negocio TPV-PC0100 en devolución: mensaje del Anexo VI", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperComContable", {
        Response: 0,
        Result: "<Operaciones><Error><codigo>TPV-PC0100</codigo><mensaje>x</mensaje><descripcion>y</descripcion></Error></Operaciones>",
    });
    const r = await svc.refund({ pedido: "1", rts: "R", amount: 5, reference: "ODOO-REF00001" });
    assert.equal(r.status, "error");
    assert.equal(r.errorCode, "TPV-PC0100");
    assert.match(r.userMessage, /No se puede devolver/);
});

test("TPV-PC0118 (ya autorizada) fuerza consulta en vez de dar error", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", {
        Response: 0,
        Result: "<Operaciones><Error><codigo>TPV-PC0118</codigo><mensaje>dup</mensaje></Error></Operaciones>",
    });
    transport.queue("fnDllOperConsulta", { Response: 0, Result: QUERY_XML([{ factura: REF }]) });
    const r = await svc.pay({ amount: 1, reference: REF });
    assert.equal(r.status, "authorized");
});

test("cancelado en el datáfono (EMV0002): error sin consulta", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllOperPinPad", {
        Response: 0,
        Result: "<Operaciones><Error><codigo>TPV-PC_EMV0002</codigo><mensaje>Operación CANCELADA</mensaje></Error></Operaciones>",
    });
    const r = await svc.pay({ amount: 1, reference: REF });
    assert.equal(r.status, "error");
    assert.match(r.userMessage, /cancelada/i);
    assert.equal(transport.count("fnDllOperConsulta"), 0);
});

test("checkStatus: normaliza y no interrumpe una operación en curso", async () => {
    const { svc, transport } = await setup();
    transport.queue("fnDllCheckStatus", { Response: 0 }, { Response: -3 }, { Response: 7 });
    assert.deepEqual(await svc.checkStatus(), { code: 0 });
    assert.deepEqual(await svc.checkStatus(), { code: -3 });
    assert.deepEqual(await svc.checkStatus(), { code: -2 });
});

test("eventos: pinpadImplantadoEvent_N se reemite con el nombre del contrato", async () => {
    const { svc, transport } = await setup();
    const seen = [];
    svc.on("cardReading", (p) => seen.push(["cardReading", p]));
    svc.on("transactionEnd", (p) => seen.push(["transactionEnd", p]));
    transport.handlers["pinpadImplantadoEvent_1"]({ x: 1 });
    transport.handlers["pinpadImplantadoEvent_3"]({ y: 2 });
    assert.deepEqual(seen.map((s) => s[0]), ["cardReading", "transactionEnd"]);
});

test("stop: llama a fnDllParaTpvpcLatente y exige init de nuevo", async () => {
    const { svc, transport } = await setup();
    await svc.stop();
    assert.equal(transport.count("fnDllParaTpvpcLatente"), 1);
    assert.equal(svc.state, "uninitialized");
});

test("la clave de firma nunca aparece en logs, resultados ni serialización", async () => {
    const logs = [];
    const { svc, transport } = await setup({ logger: (m, d) => logs.push(JSON.stringify([m, d])) });
    transport.queue("fnDllOperPinPad", { Response: -2 });
    transport.queue("fnDllOperConsulta", { Response: -2 });
    const r = await svc.pay({ amount: 1, reference: REF });
    const blob = JSON.stringify([logs, r, svc]);
    assert.equal(blob.includes(KEY), false);
});
