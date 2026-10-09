import assert from "node:assert/strict";
import {test} from "node:test";
import {createRedsysEntry} from "../../static/src/app/utils/redsys_factory.js";
import {makeReference} from "../../static/src/app/redsys/redsys_service.js";

const METHOD = {
  id: 7,
  redsys_merchant_code: "777888991",
  redsys_terminal_number: "1",
  redsys_com_port: "COM9:,19200,N,8,1",
  redsys_protocol_version: "6.1",
  redsys_transport: "js",
  redsys_simulation: true,
};

test("sin flag de URL el mock NO se usa aunque el metodo sea de simulacion", () => {
  const e = createRedsysEntry({
    method: METHOD,
    signKey: "K",
    search: "",
    loader: async () => null,
  });
  assert.equal(e.kind, "js");
  assert.ok(!e.transport.isMock);
});

test("con flag de URL y simulacion => mock", () => {
  const e = createRedsysEntry({method: METHOD, signKey: "K", search: "?redsys_sim=1"});
  assert.equal(e.kind, "mock");
  assert.equal(e.transport.isMock, true);
});

test("sin simulacion del metodo el flag de URL no activa el mock", () => {
  const e = createRedsysEntry({
    method: {...METHOD, redsys_simulation: false},
    signKey: "K",
    search: "?redsys_sim=1",
  });
  assert.notEqual(e.kind, "mock");
});

test("transporte http", () => {
  const e = createRedsysEntry({
    method: {...METHOD, redsys_simulation: false, redsys_transport: "http"},
    signKey: "K",
  });
  assert.equal(e.kind, "http");
});

test("sin clave o sin FUC => error, sin servicio", () => {
  assert.ok(createRedsysEntry({method: METHOD, signKey: ""}).error);
  assert.ok(
    createRedsysEntry({method: {...METHOD, redsys_merchant_code: ""}, signKey: "K"})
      .error
  );
});

test("flujo completo con mock: init + pago + devolucion + recuperacion por consulta", async () => {
  const e = createRedsysEntry({
    method: METHOD,
    signKey: "SECRET",
    search: "?redsys_sim=1",
  });
  const {redsys, transport} = e;
  transport.setLatency?.(0);
  assert.equal((await redsys.init()).ok, true);
  const ref = makeReference("ab12cd34-0000");
  assert.equal(ref, "ODOO-AB12CD34");
  const pay = await redsys.pay({amount: 12.5, reference: ref});
  assert.equal(pay.status, "authorized");
  const ref2 = makeReference("11112222-0000");
  const refund = await redsys.refund({
    pedido: pay.pedido,
    rts: pay.rts,
    amount: 5,
    reference: ref2,
  });
  assert.equal(refund.status, "authorized");
  const over = await redsys.refund({
    pedido: pay.pedido,
    rts: pay.rts,
    amount: 50,
    reference: "ODOO-99999999",
  });
  assert.notEqual(over.status, "authorized");
  // La consulta por referencia encuentra el cobro (recuperacion tras recarga)
  const now = new Date();
  const q = await redsys.query({
    reference: ref,
    from: new Date(now - 600000),
    to: new Date(Number(now) + 600000),
    type: "PAGO",
  });
  assert.equal(q.found, true);
  assert.ok(!JSON.stringify(transport.callLog || []).includes("SECRET"));
});
