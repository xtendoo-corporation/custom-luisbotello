import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {MockTransport} from "../../static/src/app/redsys/mock/mock_transport.js";
import {formatQueryDate} from "../../static/src/app/redsys/mock/scenarios.js";
import {INIT_ARGS, KEY, isWellFormed, setup, tag, tagOrder, tags} from "./helpers.js";

// Orden de etiquetas del ejemplo real del manual v2.52 (3.8) para fnDllOperPinPad.
const MANUAL_PAY_TAGS = [
  "Operaciones",
  "resultadoOperacion",
  "tipoPago",
  "importe",
  "moneda",
  "tarjetaComercioRecibo",
  "tarjetaClienteRecibo",
  "marcaTarjeta",
  "caducidad",
  "comercio",
  "terminal",
  "pedido",
  "tipoTasaAplicada",
  "identificadorRTS",
  "factura",
  "fechaOperacion",
  "estado",
  "resultado",
  "codigoRespuesta",
  "Literales",
  "literal",
  "firma",
  "operacionemv",
  "conttrans",
  "sectarjeta",
  "idapp",
  "codrespauto",
];
const MANUAL_REFUND_TAGS = [
  "Operaciones",
  "comunicacionContable",
  "resultadoComunicacion",
  "importe",
  "moneda",
  "comercio",
  "terminal",
  "pedido",
  "factura",
  "identificadorRTS",
  "pedidoBase",
  "fechaOperacion",
  "estado",
  "resultado",
  "firma",
];

describe("init", () => {
  it("Response 0 y no registra la clave", () => {
    const s = setup();
    s.t.EnableLog();
    const lines = [];
    s.t._logger = (l) => lines.push(l);
    assert.deepEqual(s.init(), {Response: 0, Result: null});
    assert.ok(s.t.initialized);
    const dump = JSON.stringify(s.t.callLog) + lines.join("\n");
    assert.ok(!dump.includes(KEY), "la clave no debe aparecer en logs");
    assert.ok(!JSON.stringify(s.t).includes(KEY), "la clave no debe guardarse");
  });

  it("valida comercio/terminal/clave/versión", () => {
    const s = setup();
    assert.equal(s.init(["", "1", KEY, "", ""]).Response, -3);
    assert.equal(s.init(["1", "", KEY, "", ""]).Response, -4);
    assert.equal(s.init(["1", "1", "", "", ""]).Response, -5);
    assert.equal(s.init(["1", "1", KEY, "COM9", "7.7"]).Response, -21);
    assert.equal(s.init().Response, 0);
  });

  for (const code of [-16, -20, -40, -18, -1]) {
    it(`escenario forzado init ${code}`, () => {
      const s = setup();
      s.t.forceNext({name: "init_error", code});
      assert.equal(s.init().Response, code);
      assert.ok(!s.t.initialized);
      assert.equal(s.init().Response, 0, "es de un solo uso");
    });
  }

  it("atajos init_minus16/20/40", () => {
    const s = setup();
    for (const c of [16, 20, 40]) {
      s.t.forceNext(`init_minus${c}`);
      assert.equal(s.init().Response, -c);
    }
  });
});

describe("pago autorizado", () => {
  it("XML con la estructura del manual y datos coherentes", () => {
    const s = setup();
    s.init();
    const r = s.pay("12.34", "ODOO-ABCD1234");
    assert.equal(r.Response, 0);
    assert.deepEqual(tagOrder(r.Result), MANUAL_PAY_TAGS);
    assert.ok(isWellFormed(r.Result));
    assert.equal(tag(r.Result, "estado"), "F");
    assert.equal(tag(r.Result, "resultado"), "Autorizada");
    assert.equal(tag(r.Result, "importe"), "12.34");
    assert.equal(tag(r.Result, "factura"), "ODOO-ABCD1234");
    assert.equal(tag(r.Result, "comercio"), "777888991");
    assert.equal(tag(r.Result, "pedido"), "10549");
    assert.match(tag(r.Result, "identificadorRTS"), /^\d{24}$/);
    assert.match(tag(r.Result, "tarjetaClienteRecibo"), /^\*{12}\d{4}$/);
    assert.match(
      tag(r.Result, "fechaOperacion"),
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/
    );
    assert.match(tag(r.Result, "firma"), /^MOCK[0-9A-F]{36}$/);
    assert.ok(!r.Result.includes(KEY));
  });

  it("eventos 1 -> 4 -> 3 en orden y tras la latencia de lectura", () => {
    const s = setup();
    s.init();
    s.events.length = 0;
    let ret;
    s.t.execFnDll("fnDllOperPinPad", ["1.00", "X", "PAGO"], (x) => (ret = x));
    s.clock.advance(14000);
    assert.deepEqual(
      s.events.map((e) => e.n),
      [1]
    );
    assert.equal(ret, undefined);
    s.clock.advance(1500); // 15.5 s: lectura OK
    assert.deepEqual(
      s.events.map((e) => e.n),
      [1, 4]
    );
    s.clock.advance(1500);
    assert.deepEqual(
      s.events.map((e) => e.n),
      [1, 4, 3]
    );
    assert.equal(ret.Response, 0);
    assert.ok(!s.t.busy);
  });

  it("latencia configurable por constructor y por escenario", () => {
    const s = setup({latency: 0});
    s.init();
    assert.equal(
      s.pay("1.00", "A", 0).Response,
      0,
      "latencia 0 resuelve sin avanzar tiempo"
    );
    const s2 = setup();
    s2.init();
    s2.t.forceNext({name: "authorized", latency: {cardRead: 40000, process: 0}});
    let ret;
    s2.t.execFnDll("fnDllOperPinPad", ["1.00", "A", "PAGO"], (x) => (ret = x));
    s2.clock.advance(39999);
    assert.equal(ret, undefined);
    s2.clock.advance(1);
    assert.equal(ret.Response, 0);
  });

  it("marca de tarjeta configurable", () => {
    const s = setup({brand: "VISA", last4: "4242"});
    s.init();
    const r = s.pay();
    assert.equal(tag(r.Result, "marcaTarjeta"), "1");
    assert.ok(tag(r.Result, "tarjetaClienteRecibo").endsWith("4242"));
  });

  it("evento 2 opcional antes del 1", () => {
    const s = setup({keysUpdating: true});
    s.init();
    s.pay();
    assert.deepEqual(
      s.events.map((e) => e.n),
      [2, 1, 4, 3]
    );
  });
});

describe("pago denegado", () => {
  it("codigoRespuesta real y no autoriza", () => {
    const s = setup();
    s.init();
    s.t.forceNext({name: "denied", denialCode: 116});
    const r = s.pay();
    assert.equal(r.Response, 0);
    assert.equal(tag(r.Result, "estado"), "F");
    assert.equal(tag(r.Result, "resultado"), "Denegada");
    assert.equal(tag(r.Result, "codigoRespuesta"), "116");
    assert.deepEqual(tagOrder(r.Result), MANUAL_PAY_TAGS);
  });

  it("variante estado G y código por defecto 190", () => {
    const s = setup();
    s.init();
    s.t.forceNext("denied_g");
    const r = s.pay();
    assert.equal(tag(r.Result, "estado"), "G");
    assert.equal(tag(r.Result, "codigoRespuesta"), "190");
  });

  it("la denegada consta en el almacén como DENEGADA", () => {
    const s = setup();
    s.init();
    s.t.forceNext({name: "denied", denialCode: 117});
    s.pay("5.00", "DEN-1");
    const q = s.consult({factura: "DEN-1"});
    assert.equal(tag(q.Result, "resultado"), "DENEGADA");
    assert.equal(tag(q.Result, "codigoRespuesta"), "117");
    const onlyAuth = s.consult({factura: "DEN-1", resultado: "AUTORIZADA"});
    assert.equal(tag(onlyAuth.Result, "numoperaciones"), "0");
  });
});

describe("-2 resultado desconocido", () => {
  it("cobrado: -2, eventos 1,4,5,3 y la consulta lo encuentra", () => {
    const s = setup();
    s.init();
    s.t.forceNext("unknown_charged");
    const t0 = s.clock.now();
    const r = s.pay("20.00", "ODOO-CHG00001");
    assert.deepEqual(r, {Response: -2, Result: null});
    assert.deepEqual(
      s.events.map((e) => e.n),
      [1, 4, 5, 3]
    );
    assert.ok(!s.t.busy);
    const q = s.consult({
      factura: "ODOO-CHG00001",
      from: formatQueryDate(t0 - 600000),
      to: formatQueryDate(s.clock.now() + 600000),
      tipo: "PAGO",
    });
    assert.equal(q.Response, 0);
    assert.equal(tag(q.Result, "estado"), "F");
    assert.equal(tag(q.Result, "resultado"), "AUTORIZADA");
    assert.equal(tag(q.Result, "factura"), "ODOO-CHG00001");
    assert.equal(tag(q.Result, "importe"), "20.00");
    assert.match(tag(q.Result, "identificadorRTS"), /^\d{24}$/);
  });

  it("sin cobro: -2 y la consulta no encuentra nada", () => {
    const s = setup();
    s.init();
    s.t.forceNext("unknown_not_charged");
    assert.equal(s.pay("20.00", "ODOO-NOCHG001").Response, -2);
    assert.deepEqual(
      s.events.map((e) => e.n),
      [1, 5, 3]
    );
    const q = s.consult({factura: "ODOO-NOCHG001"});
    assert.equal(q.Response, 0);
    assert.equal(tag(q.Result, "numoperaciones"), "0");
    assert.equal(tag(q.Result, "operacion"), null);
  });

  it("cobrado y la consulta también da -2 (una vez)", () => {
    const s = setup();
    s.init();
    s.t.forceNext("unknown_query_fails");
    assert.equal(s.pay("3.00", "ODOO-QF000001").Response, -2);
    assert.equal(s.consult({factura: "ODOO-QF000001"}).Response, -2);
    const again = s.consult({factura: "ODOO-QF000001"});
    assert.equal(again.Response, 0);
    assert.equal(tag(again.Result, "numoperaciones"), "1");
  });

  it("el tiempo de espera es configurable", () => {
    const s = setup();
    s.init();
    s.t.forceNext({name: "unknown_not_charged", latency: {timeout: 5000}});
    let ret;
    s.t.execFnDll("fnDllOperPinPad", ["1.00", "A", "PAGO"], (x) => (ret = x));
    s.clock.advance(4999);
    assert.equal(ret, undefined);
    s.clock.advance(1);
    assert.equal(ret.Response, -2);
  });
});

describe("re-init, códigos y respuestas defectuosas", () => {
  for (const [name, code] of [
    ["reinit_1", -1],
    ["reinit_99", -99],
  ]) {
    it(`${name}: exige re-init y luego funciona`, () => {
      const s = setup();
      s.init();
      s.t.forceNext(name);
      assert.equal(s.pay().Response, code);
      assert.ok(!s.t.initialized);
      assert.equal(s.pay().Response, code, "sigue fallando sin re-init");
      assert.equal(s.consult({factura: "x"}).Response, code);
      s.init();
      assert.equal(s.pay().Response, 0);
    });
  }

  it("sin init, -1", () => {
    const s = setup();
    assert.equal(s.pay().Response, -1);
  });

  it("return_code arbitrario", () => {
    const s = setup();
    s.init();
    s.t.forceNext({name: "return_code", code: -17});
    assert.equal(s.pay().Response, -17);
    assert.ok(s.t.initialized, "no invalida la inicialización");
  });

  it("XML malformado: Response 0 pero no parseable; la operación sí queda cobrada", () => {
    const s = setup();
    s.init();
    s.t.forceNext("malformed_xml");
    const r = s.pay("9.99", "ODOO-MAL00001");
    assert.equal(r.Response, 0);
    assert.ok(!isWellFormed(r.Result));
    assert.equal(
      tag(s.consult({factura: "ODOO-MAL00001"}).Result, "numoperaciones"),
      "1"
    );
  });

  it("XML cortado y charged:false", () => {
    const s = setup();
    s.init();
    s.t.forceNext({name: "truncated_xml", charged: false});
    const r = s.pay("9.99", "ODOO-TRU00001");
    assert.equal(r.Response, 0);
    assert.ok(!r.Result.includes("</Operaciones>"));
    assert.ok(!isWellFormed(r.Result));
    assert.equal(
      tag(s.consult({factura: "ODOO-TRU00001"}).Result, "numoperaciones"),
      "0"
    );
  });
});

describe("validaciones y concurrencia", () => {
  it("importe/referencia/comando inválidos", () => {
    const s = setup();
    s.init();
    assert.equal(s.pay("12,34").Response, -18);
    assert.equal(s.pay("12.3").Response, -18);
    assert.equal(s.pay("0.00").Response, -18);
    assert.equal(s.pay("1.00", "X".repeat(21)).Response, -13);
    assert.equal(s.exec("fnDllNoExiste", []).Response, -13);
    assert.equal(
      s.exec("fnDllOperPinPad", ["1.00", "A", "PREAUTORIZACION"]).Response,
      -13
    );
  });

  it("una sola transacción simultánea", () => {
    const s = setup();
    s.init();
    const rets = [];
    s.t.execFnDll("fnDllOperPinPad", ["1.00", "A", "PAGO"], (x) =>
      rets.push(["a", x.Response])
    );
    assert.ok(s.t.busy);
    s.t.execFnDll("fnDllOperPinPad", ["2.00", "B", "PAGO"], (x) =>
      rets.push(["b", x.Response])
    );
    s.clock.advance(120000);
    assert.deepEqual(rets.sort(), [
      ["a", 0],
      ["b", -3],
    ]);
    assert.equal(s.t.busyViolations, 1);
    assert.equal(s.t.operations.length, 1);
  });

  it("checkStatus 0 / -1 / -2 / -3", () => {
    const s = setup();
    assert.equal(s.exec("fnDllCheckStatus", []).Response, -1);
    s.init();
    assert.equal(s.exec("fnDllCheckStatus", []).Response, 0);
    s.t.forceNext("check_terminal_fail");
    assert.equal(s.exec("fnDllCheckStatus", []).Response, -2);
    s.t.forceNext("check_server_fail");
    assert.equal(s.exec("fnDllCheckStatus", []).Response, -3);
    assert.equal(s.exec("fnDllCheckStatus", []).Response, 0);
  });

  it("fnDllParaTpvpcLatente desinicializa", () => {
    const s = setup();
    s.init();
    assert.equal(s.exec("fnDllParaTpvpcLatente", []).Response, 0);
    assert.equal(s.pay().Response, -1);
  });

  it("la cola forzada solo la consume la operación que aplica", () => {
    const s = setup();
    s.t.forceNext({name: "init_error", code: -16});
    s.t.forceNext("denied");
    assert.equal(s.t.queue.length, 2);
    assert.equal(s.init().Response, -16);
    assert.equal(s.init().Response, 0);
    assert.equal(tag(s.pay().Result, "resultado"), "Denegada");
    assert.equal(tag(s.pay().Result, "resultado"), "Autorizada");
    assert.equal(s.t.queue.length, 0);
    assert.throws(() => s.t.forceNext("no_existe"), /desconocido/);
  });

  it("escenario por defecto", () => {
    const s = setup({scenario: "denied"});
    s.init();
    assert.equal(tag(s.pay().Result, "resultado"), "Denegada");
    assert.equal(tag(s.pay().Result, "resultado"), "Denegada");
  });
});

describe("devoluciones y consulta coherentes", () => {
  const payOk = (s, amount = "10.00", ref = "ODOO-PAY00001") => {
    const r = s.pay(amount, ref);
    return {pedido: tag(r.Result, "pedido"), rts: tag(r.Result, "identificadorRTS")};
  };

  it("devolución parcial y total con la estructura del manual", () => {
    const s = setup();
    s.init();
    const {pedido, rts} = payOk(s);
    const r1 = s.refund(pedido, rts, "4.00");
    assert.equal(r1.Response, 0);
    assert.deepEqual(tagOrder(r1.Result), MANUAL_REFUND_TAGS);
    assert.equal(tag(r1.Result, "estado"), "F");
    assert.equal(tag(r1.Result, "resultado"), "Autorizada");
    assert.equal(tag(r1.Result, "pedidoBase"), pedido);
    assert.notEqual(tag(r1.Result, "pedido"), pedido);
    const r2 = s.refund(pedido, rts, "6.00");
    assert.equal(tag(r2.Result, "resultado"), "Autorizada");
    // Importe agotado
    const r3 = s.refund(pedido, rts, "0.01");
    assert.equal(r3.Response, -3);
    assert.equal(tag(r3.Result, "codigo"), "TPV-PC0100");
  });

  it("importe mayor que el original", () => {
    const s = setup();
    s.init();
    const {pedido, rts} = payOk(s);
    const r = s.refund(pedido, rts, "10.01");
    assert.equal(tag(r.Result, "codigo"), "TPV-PC0100");
    assert.equal(s.t.operations.length, 1, "no se crea operación");
  });

  it("sin pedido/RTS existente no hay devolución", () => {
    const s = setup();
    s.init();
    const {pedido, rts} = payOk(s);
    assert.equal(tag(s.refund("99999", rts, "1.00").Result, "codigo"), "TPV-PC0091");
    assert.equal(
      tag(s.refund(pedido, "070001000000000000000000", "1.00").Result, "codigo"),
      "TPV-PC0091"
    );
    assert.equal(s.refund(pedido, null, "1.00").Response, 0, "RTS opcional");
    assert.equal(
      s.exec("fnDllOperComContable", [null, null, "1.00", "x", "DEVOLUCION"]).Response,
      -3
    );
    assert.equal(
      s.exec("fnDllOperComContable", [pedido, rts, "1,00", "x", "DEVOLUCION"]).Response,
      -3
    );
  });

  it("no se devuelve una operación denegada ni una devolución", () => {
    const s = setup();
    s.init();
    s.t.forceNext("denied");
    const den = s.pay("5.00", "D");
    assert.equal(
      tag(s.refund(tag(den.Result, "pedido"), null, "1.00").Result, "codigo"),
      "TPV-PC0123"
    );
    const {pedido, rts} = payOk(s);
    const ref = s.refund(pedido, rts, "1.00");
    assert.equal(
      tag(s.refund(tag(ref.Result, "pedido"), null, "1.00").Result, "codigo"),
      "TPV-PC0091"
    );
  });

  it("devolución -2 cobrada aparece en la consulta como Devolucion", () => {
    const s = setup();
    s.init();
    const {pedido, rts} = payOk(s);
    s.t.forceNext("unknown_charged");
    assert.equal(s.refund(pedido, rts, "2.00", "REF-U").Response, -2);
    const q = s.consult({factura: "REF-U"});
    assert.equal(tag(q.Result, "tipoOper"), "Devolucion");
    assert.equal(tag(q.Result, "pedidoBase"), pedido);
    assert.equal(tag(q.Result, "codigoRespuesta"), null);
  });

  it("consulta: filtros, nulos, orden y RTS que ignora el resto", () => {
    const s = setup();
    s.init();
    const a = payOk(s, "1.00", "A");
    s.clock.advance(60000);
    const b = payOk(s, "2.00", "B");
    const q = s.consult({});
    assert.equal(tag(q.Result, "numoperaciones"), "2");
    assert.deepEqual(tags(q.Result, "factura"), ["B", "A"], "más reciente primero");
    assert.deepEqual(tagOrder(q.Result).slice(0, 2), [
      "consultas",
      "resultadoConsulta",
    ]);
    assert.equal(tag(q.Result, "comercio"), "777888991");
    assert.match(tag(q.Result, "timestamp"), /^\d{8} \d{6}$/);
    assert.deepEqual(tags(s.consult({pedido: a.pedido}).Result, "factura"), ["A"]);
    assert.deepEqual(tags(s.consult({rts: b.rts, factura: "A"}).Result, "factura"), [
      "B",
    ]);
    assert.deepEqual(tags(s.consult({tipo: "DEVOLUCION"}).Result, "factura"), []);
    const tb = s.t.store.findByPedido(b.pedido).fechaMs;
    const w = s.consult({
      from: formatQueryDate(tb - 1000),
      to: formatQueryDate(tb + 1000),
    });
    assert.deepEqual(tags(w.Result, "factura"), ["B"]);
    assert.equal(s.consult({from: "ayer"}).Response, -3);
    assert.equal(s.consult({tipo: "OTRO"}).Response, -3);
  });

  it("consulta paginada", () => {
    const s = setup({latency: 0});
    s.init();
    for (let i = 0; i < 30; i++) {
      s.t.seedOperation({factura: `S${i}`, fechaMs: s.clock.now() + i});
    }
    const p0 = s.consult({page: "0"});
    assert.equal(tag(p0.Result, "numoperaciones"), "25");
    assert.equal(tag(p0.Result, "totalpaginas"), "2");
    assert.equal(tag(s.consult({page: "1"}).Result, "numoperaciones"), "5");
  });
});

describe("infraestructura", () => {
  it("reloj real: callbacks asíncronos con latencia 0", async () => {
    const t = new MockTransport({latency: 0});
    const call = (fn) => new Promise((res) => fn(res));
    const init = await call((cb) => t.initFnDll(INIT_ARGS, cb));
    assert.equal(init.Response, 0);
    const ev = [];
    [1, 4, 3].forEach((n) =>
      t.subscribeEvent(`pinpadImplantadoEvent_${n}`, () => ev.push(n))
    );
    let sync = true;
    const p = call((cb) => t.execFnDll("fnDllOperPinPad", ["1.00", "A", "PAGO"], cb));
    sync = false;
    const r = await p;
    assert.equal(sync, false);
    assert.equal(r.Response, 0);
    assert.deepEqual(ev, [1, 4, 3]);
  });

  it("reset cancela temporizadores pendientes", () => {
    const s = setup();
    s.init();
    let called = false;
    s.t.execFnDll("fnDllOperPinPad", ["1.00", "A", "PAGO"], () => (called = true));
    s.t.reset();
    s.clock.advance(120000);
    assert.ok(!called);
    assert.equal(s.clock.pending, 0);
  });

  it("callLog no contiene la clave ni PAN completo", () => {
    const s = setup();
    s.init();
    s.pay();
    const dump = JSON.stringify(s.t.callLog.map((e) => [e.cmd, e.args]));
    assert.ok(!dump.includes(KEY));
    assert.ok(!/\d{13,19}/.test(dump.replace(/\*{12}\d{4}/g, "")), "sin PAN");
  });

  it("EnableLog/DisableLog", () => {
    const lines = [];
    const s = setup({logger: (l) => lines.push(l)});
    s.init();
    assert.equal(lines.length, 0);
    s.t.EnableLog();
    s.pay();
    assert.ok(lines.length > 0);
    const n = lines.length;
    s.t.DisableLog();
    s.pay();
    assert.equal(lines.length, n);
  });
});
