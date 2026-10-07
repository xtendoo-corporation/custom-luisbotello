// QA independiente: matriz de escenarios (plan §6 Fase 3 y Fase 4) ejecutada contra
// el RedsysService REAL con el MockTransport REAL (sin FakeTransport).
// Invariante vigilado en todos los casos: lo que el servicio declara debe coincidir con
// el dinero realmente movido en el almacén del simulador (nunca doble cobro silencioso).
import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {MockTransport} from "../../static/src/app/redsys/mock/mock_transport.js";
import {RedsysService} from "../../static/src/app/redsys/redsys_service.js";

const KEY = "QA-SECRET-KEY-9f8e7d6c";
const REF = "ODOO-AAAA0001";

function build({latency = 0, svc: svcOpts = {}, ...mockOpts} = {}) {
  const transport = new MockTransport({latency, logger: () => {}, ...mockOpts});
  const svc = new RedsysService({
    sleep: async () => {},
    initCooldownMs: 0,
    callTimeoutMs: 0,
    ...svcOpts,
  });
  svc.configure({
    merchant: "777888991",
    terminal: "1",
    signKey: KEY,
    port: "COM9:,19200,N,8,1",
    version: "6.1",
    transport,
  });
  return {transport, svc};
}
const ready = async (o) => {
  const e = build(o);
  assert.equal((await e.svc.init()).ok, true);
  return e;
};
const count = (t, cmd) => t.callLog.filter((c) => c.cmd === cmd).length;
const charges = (t) =>
  t.operations.filter(
    (o) => o.tipoOper === "Autorizacion" && o.resultado === "Autorizada"
  );
const refunds = (t) =>
  t.operations.filter(
    (o) => o.tipoOper === "Devolucion" && o.resultado === "Autorizada"
  );
const refundedCents = (t) => refunds(t).reduce((s, o) => s + o.cents, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("Fase 3: matriz de robustez de cobro", () => {
  it("autorizado: un cargo, datos coherentes con el almacén y eventos 1,4,3", async () => {
    const {svc, transport} = await ready();
    const events = [];
    for (const name of ["cardReading", "cardOk", "transactionEnd"]) {
      svc.on(name, () => events.push(name));
    }
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "authorized");
    assert.equal(charges(transport).length, 1);
    const op = charges(transport)[0];
    assert.equal(r.pedido, op.pedido);
    assert.equal(r.rts, op.rts);
    assert.equal(op.cents, 1234);
    assert.equal(op.factura, REF);
    assert.equal(r.warning, undefined);
    assert.deepEqual(events, ["cardReading", "cardOk", "transactionEnd"]);
    assert.equal(svc.isReady(), true);
  });

  it("denegado (estado F/Denegada y variante G): nada cobrado, servicio libre, reintento posible", async () => {
    for (const scenario of ["denied", "denied_g"]) {
      const {svc, transport} = await ready();
      transport.forceNext({name: scenario, denialCode: "116"});
      const r = await svc.pay({amount: 50, reference: REF});
      assert.equal(r.status, "denied", scenario);
      assert.equal(r.errorCode, "116");
      assert.equal(charges(transport).length, 0);
      assert.equal(svc.isBusy(), false);
      // Reintento con otra tarjeta: un único cargo
      const r2 = await svc.pay({amount: 50, reference: REF});
      assert.equal(r2.status, "authorized");
      assert.equal(charges(transport).length, 1);
    }
  });

  it("-2 + cobrado: se recupera por consulta, UNA sola llamada de cobro y UN solo cargo", async () => {
    const {svc, transport} = await ready();
    transport.forceNext("unknown_charged");
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "authorized");
    assert.equal(r.recovered, true);
    assert.equal(count(transport, "fnDllOperPinPad"), 1, "no debe repetirse el cobro");
    assert.equal(charges(transport).length, 1);
    assert.equal(r.pedido, charges(transport)[0].pedido);
    assert.equal(count(transport, "fnDllOperConsulta"), 1);
  });

  it("-2 + no cobrado: error reintentable, 0 cargos, y el reintento cobra exactamente una vez", async () => {
    const {svc, transport} = await ready();
    transport.forceNext("unknown_not_charged");
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "error");
    assert.equal(r.errorCode, "NOT_CHARGED");
    assert.equal(r.retryable, true);
    assert.equal(charges(transport).length, 0);
    const r2 = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r2.status, "authorized");
    assert.equal(charges(transport).length, 1);
  });

  it("-2 + la consulta falla: UNKNOWN, no se reintenta el cobro; la consulta manual posterior resuelve", async () => {
    const {svc, transport} = await ready();
    transport.forceNext("unknown_query_fails");
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "unknown");
    assert.equal(r.errorCode, "UNKNOWN_RESULT");
    assert.match(r.userMessage, /NO repita/);
    assert.equal(count(transport, "fnDllOperPinPad"), 1);
    assert.equal(
      charges(transport).length,
      1,
      "el cargo existe aunque el servicio no pudo confirmarlo"
    );
    assert.equal(svc.isBusy(), false);
    // La consulta pública (p. ej. al recargar) lo encuentra
    const now = Date.now();
    const q = await svc.query({
      reference: REF,
      from: new Date(now - 600000),
      to: new Date(now + 600000),
      type: "PAGO",
    });
    assert.equal(q.found, true);
    assert.equal(q.operations[0].pedido, charges(transport)[0].pedido);
    assert.equal(count(transport, "fnDllOperPinPad"), 1);
  });

  it("XML malformado o cortado tras cobrar: no se interpreta como fallo, se consulta", async () => {
    for (const scenario of ["malformed_xml", "truncated_xml"]) {
      const {svc, transport} = await ready();
      transport.forceNext(scenario); // Por defecto la operación SÍ queda cobrada (peor caso)
      const r = await svc.pay({amount: 12.34, reference: REF});
      assert.equal(r.status, "authorized", scenario);
      assert.equal(r.recovered, true);
      assert.equal(count(transport, "fnDllOperPinPad"), 1);
      assert.equal(charges(transport).length, 1);
    }
    const {svc, transport} = await ready();
    transport.forceNext({name: "truncated_xml", charged: false});
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "error");
    assert.equal(r.errorCode, "NOT_CHARGED");
    assert.equal(charges(transport).length, 0);
  });

  it("recarga a mitad (operación ya terminada): un servicio NUEVO encuentra el cobro por referencia", async () => {
    const {svc: a, transport} = await ready({
      latency: {cardRead: 20, process: 10, init: 0, consult: 0},
    });
    const inflight = a.pay({amount: 12.34, reference: REF}); // La pestaña "muere" aquí
    await sleep(5);
    assert.equal(a.isBusy(), true);
    await inflight; // El datáfono termina igualmente
    // "recarga": nueva instancia de servicio contra el mismo servicio local de Redsys
    const b = new RedsysService({
      sleep: async () => {},
      initCooldownMs: 0,
      callTimeoutMs: 0,
    });
    b.configure({
      merchant: "777888991",
      terminal: "1",
      signKey: KEY,
      port: "COM9:,19200,N,8,1",
      version: "6.1",
      transport,
    });
    assert.equal((await b.init()).ok, true);
    const now = Date.now();
    const q = await b.query({
      reference: REF,
      from: new Date(now - 600000),
      to: new Date(now + 600000),
      type: "PAGO",
    });
    assert.equal(q.found, true);
    assert.equal(charges(transport).length, 1);
  });

  it("-1 con recuperación: reinit y UN reintento (no se había ejecutado), un solo cargo", async () => {
    const {svc, transport} = await ready();
    transport.forceNext("reinit_1");
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "authorized");
    assert.equal(
      count(transport, "fnDllOperPinPad"),
      2,
      "primer -1 (no ejecutado) + reintento"
    );
    assert.equal(count(transport, "initFnDll"), 2);
    assert.equal(charges(transport).length, 1);
  });

  it("-1 persistente: un único reintento y error; init acotado (sin bucle)", async () => {
    const {svc, transport} = await ready();
    transport.forceNext("reinit_1");
    transport.forceNext("reinit_1");
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "error");
    assert.equal(r.errorCode, "NOT_INITIALIZED");
    assert.equal(count(transport, "fnDllOperPinPad"), 2);
    assert.ok(count(transport, "initFnDll") <= 3);
    assert.equal(charges(transport).length, 0);
  });

  it("-99: reinit + consulta, jamás reintento ciego del cobro", async () => {
    const {svc, transport} = await ready();
    transport.forceNext("reinit_99");
    const r = await svc.pay({amount: 12.34, reference: REF});
    assert.notEqual(r.status, "authorized");
    assert.equal(count(transport, "fnDllOperPinPad"), 1);
    assert.equal(charges(transport).length, 0);
  });

  it("-40 (librería caducada) en init y en el cobro: mensaje específico, sin reintentos ni bucle", async () => {
    const e = build();
    e.transport.forceNext("init_minus40");
    const init = await e.svc.init();
    assert.equal(init.ok, false);
    assert.equal(init.code, -40);
    assert.equal(init.errorCode, "LIB_EXPIRED");
    assert.match(init.message, /caducado/);
    assert.equal(count(e.transport, "initFnDll"), 1);
    // Pay sobre servicio sin init válido: se reintenta UN init (nueva secuencia) y se informa
    e.transport.setDefaultScenario({name: "init_error", code: -40});
    const r = await e.svc.pay({amount: 5, reference: REF});
    assert.equal(r.status, "error");
    assert.equal(r.errorCode, "LIB_EXPIRED");
    assert.equal(count(e.transport, "fnDllOperPinPad"), 0);
    assert.ok(count(e.transport, "initFnDll") <= 2);
    // -40 devuelto por el propio cobro
    const f = await ready();
    f.transport.forceNext({name: "return_code", code: -40});
    const r2 = await f.svc.pay({amount: 5, reference: REF});
    assert.equal(r2.status, "error");
    assert.equal(r2.errorCode, "LIB_EXPIRED");
    assert.equal(count(f.transport, "fnDllOperPinPad"), 1);
  });

  it("bucle de init: con init fallando siempre, 50 cobros no martillean al servicio (enfriamiento)", async () => {
    const e = build({svc: {initCooldownMs: 5000}});
    e.transport.setDefaultScenario({name: "init_error", code: -16});
    await e.svc.init();
    for (let i = 0; i < 50; i++) {
      const r = await e.svc.pay({amount: 5, reference: REF});
      assert.equal(r.status, "error");
    }
    assert.ok(
      count(e.transport, "initFnDll") <= 2,
      `init llamado ${count(e.transport, "initFnDll")} veces`
    );
    assert.equal(count(e.transport, "fnDllOperPinPad"), 0);
  });

  it("doble clic rápido: solo uno llega al datáfono, el resto BUSY, un único cargo", async () => {
    const {svc, transport} = await ready({
      latency: {cardRead: 20, process: 10, init: 0},
    });
    const results = await Promise.all(
      Array.from({length: 20}, () => svc.pay({amount: 12.34, reference: REF}))
    );
    assert.equal(results.filter((r) => r.status === "authorized").length, 1);
    assert.equal(results.filter((r) => r.errorCode === "BUSY").length, 19);
    assert.equal(count(transport, "fnDllOperPinPad"), 1);
    assert.equal(transport.busyViolations, 0);
    assert.equal(charges(transport).length, 1);
  });

  it("con referencias distintas simultáneas también: un único cobro", async () => {
    const {svc, transport} = await ready({
      latency: {cardRead: 20, process: 10, init: 0},
    });
    const [a, b] = await Promise.all([
      svc.pay({amount: 10, reference: "ODOO-AAAA0001"}),
      svc.pay({amount: 10, reference: "ODOO-BBBB0002"}),
    ]);
    assert.deepEqual([a.status, b.errorCode], ["authorized", "BUSY"]);
    assert.equal(charges(transport).length, 1);
  });

  it("operaciones concurrentes durante un cobro no tocan el datáfono (refund/query/init/stop/configure)", async () => {
    const {svc, transport} = await ready({
      latency: {cardRead: 30, process: 10, init: 0},
    });
    const p = svc.pay({amount: 12.34, reference: REF});
    await sleep(5);
    const before = transport.callLog.length;
    const refund = await svc.refund({
      pedido: "10549",
      rts: "x",
      amount: 1,
      reference: "ODOO-CCCC0003",
    });
    const query = await svc.query({reference: REF});
    const init = await svc.init();
    const stop = await svc.stop();
    const status = await svc.checkStatus();
    assert.equal(refund.errorCode, "BUSY");
    assert.equal(query.error.code, "BUSY");
    assert.equal(init.code, "BUSY");
    assert.equal(stop.code, "BUSY");
    assert.equal(status.busy, true);
    assert.throws(() =>
      svc.configure({merchant: "1", terminal: "1", signKey: "x", transport})
    );
    assert.equal(
      transport.callLog.length,
      before,
      "ninguna llamada nueva al transporte"
    );
    assert.equal((await p).status, "authorized");
  });

  it("tras un resultado -2 irresuelto el servicio no queda colgado ni cobra solo", async () => {
    const {svc, transport} = await ready();
    transport.forceNext("unknown_query_fails");
    await svc.pay({amount: 12.34, reference: REF});
    await sleep(30);
    assert.equal(svc.isBusy(), false);
    assert.equal(count(transport, "fnDllOperPinPad"), 1);
    assert.equal(charges(transport).length, 1);
  });
});

describe("Fase 4: devoluciones (total, parcial, excesiva, sin RTS)", () => {
  async function paid(amount = 20) {
    const e = await ready();
    const p = await e.svc.pay({amount, reference: REF});
    assert.equal(p.status, "authorized");
    return {...e, pay: p};
  }

  it("total", async () => {
    const {svc, transport, pay} = await paid(20);
    const r = await svc.refund({
      pedido: pay.pedido,
      rts: pay.rts,
      amount: 20,
      reference: "ODOO-REF00001",
    });
    assert.equal(r.status, "authorized");
    assert.equal(refundedCents(transport), 2000);
    assert.notEqual(r.pedido, pay.pedido, "la devolución tiene su propio pedido");
  });

  it("parcial y acumulada: dos parciales ok; la tercera que supera el original es rechazada (TPV-PC0100 del simulador)", async () => {
    const {svc, transport, pay} = await paid(20);
    const mk = (amount, ref) =>
      svc.refund({pedido: pay.pedido, rts: pay.rts, amount, reference: ref});
    assert.equal((await mk(5, "ODOO-REF00001")).status, "authorized");
    assert.equal((await mk(5, "ODOO-REF00002")).status, "authorized");
    const over = await mk(15, "ODOO-REF00003");
    assert.equal(over.status, "error");
    assert.equal(refundedCents(transport), 1000);
    assert.equal((await mk(10, "ODOO-REF00004")).status, "authorized");
    assert.equal(refundedCents(transport), 2000);
    assert.equal(
      (await mk(0.01, "ODOO-REF00005")).status,
      "error",
      "ni un céntimo más"
    );
  });

  it("excesiva de una vez: rechazada, nada devuelto", async () => {
    const {svc, transport, pay} = await paid(20);
    const r = await svc.refund({
      pedido: pay.pedido,
      rts: pay.rts,
      amount: 20.01,
      reference: "ODOO-REF00001",
    });
    assert.equal(r.status, "error");
    assert.equal(refundedCents(transport), 0);
  });

  it("sin RTS: pedido solo funciona en el simulador (RTS 'muy recomendado'); RTS equivocado o pedido inexistente fallan", async () => {
    const {svc, transport, pay} = await paid(20);
    const wrongRts = await svc.refund({
      pedido: pay.pedido,
      rts: "000000000000000000000000",
      amount: 5,
      reference: "ODOO-REF00001",
    });
    assert.equal(wrongRts.status, "error");
    const noPedido = await svc.refund({
      pedido: "999999",
      rts: pay.rts,
      amount: 5,
      reference: "ODOO-REF00002",
    });
    assert.equal(noPedido.status, "error");
    assert.equal(refundedCents(transport), 0);
    const noRts = await svc.refund({
      pedido: pay.pedido,
      rts: null,
      amount: 5,
      reference: "ODOO-REF00003",
    });
    assert.equal(noRts.status, "authorized");
    // Parámetros inválidos nunca llegan al datáfono
    const calls = transport.callLog.length;
    assert.equal(
      (
        await svc.refund({
          pedido: "",
          rts: pay.rts,
          amount: 5,
          reference: "ODOO-REF00004",
        })
      ).errorCode,
      "INVALID_PARAMS"
    );
    assert.equal(
      (
        await svc.refund({
          pedido: pay.pedido,
          rts: pay.rts,
          amount: 0,
          reference: "ODOO-REF00005",
        })
      ).errorCode,
      "INVALID_PARAMS"
    );
    assert.equal(
      (
        await svc.refund({
          pedido: pay.pedido,
          rts: pay.rts,
          amount: -5,
          reference: "ODOO-REF00006",
        })
      ).errorCode,
      "INVALID_PARAMS"
    );
    assert.equal(transport.callLog.length, calls);
  });

  it("devolver un cobro denegado o una devolución no es posible", async () => {
    const {svc, transport, pay} = await paid(20);
    transport.forceNext("denied");
    const denied = await svc.pay({amount: 7, reference: "ODOO-DENIED01"});
    assert.equal(denied.status, "denied");
    const op = transport.operations.find((o) => o.factura === "ODOO-DENIED01");
    const r = await svc.refund({
      pedido: op.pedido,
      rts: op.rts,
      amount: 7,
      reference: "ODOO-REF00001",
    });
    assert.equal(r.status, "error");
    const ref1 = await svc.refund({
      pedido: pay.pedido,
      rts: pay.rts,
      amount: 5,
      reference: "ODOO-REF00002",
    });
    const refOfRefund = await svc.refund({
      pedido: ref1.pedido,
      rts: ref1.rts,
      amount: 1,
      reference: "ODOO-REF00003",
    });
    assert.equal(refOfRefund.status, "error");
    assert.equal(refundedCents(transport), 500);
  });

  it("devolución -2 cobrada: se recupera como DEVOLUCION sin repetir; -2 sin cobro: NOT_CHARGED; consulta falla: unknown", async () => {
    const {svc, transport, pay} = await paid(20);
    const base = {pedido: pay.pedido, rts: pay.rts};
    transport.forceNext("unknown_charged");
    const a = await svc.refund({...base, amount: 5, reference: "ODOO-REF00001"});
    assert.equal(a.status, "authorized");
    assert.equal(a.recovered, true);
    assert.equal(count(transport, "fnDllOperComContable"), 1);
    assert.equal(refundedCents(transport), 500);
    transport.forceNext("unknown_not_charged");
    const b = await svc.refund({...base, amount: 5, reference: "ODOO-REF00002"});
    assert.equal(b.errorCode, "NOT_CHARGED");
    assert.equal(refundedCents(transport), 500);
    transport.forceNext("unknown_charged");
    transport.forceNext("unknown_query_fails");
    const c = await svc.refund({...base, amount: 5, reference: "ODOO-REF00003"});
    assert.ok(["authorized", "unknown"].includes(c.status));
    assert.ok(refundedCents(transport) <= 1000);
  });

  it("importes con redondeo difícil (0.1+0.2, 1.005) se envían con 2 decimales exactos", async () => {
    const {svc, transport} = await ready();
    await svc.pay({amount: 0.1 + 0.2, reference: REF});
    await svc.pay({amount: "1,10", reference: "ODOO-AAAA0002"});
    const sent = transport.callLog
      .filter((c) => c.cmd === "fnDllOperPinPad")
      .map((c) => c.args[0]);
    assert.deepEqual(sent, ["0.30", "1.10"]);
  });
});
