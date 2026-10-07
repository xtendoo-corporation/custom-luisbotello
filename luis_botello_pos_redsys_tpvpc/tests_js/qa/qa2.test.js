// QA independiente, ronda 2: intenta romper las correcciones de la ronda 1 y busca regresiones /
// caminos nuevos de doble cobro o cobro sin registro. Ver docs/qa_report2.md.
//
// Convención (igual que adversarial.test.js): `{ todo }` = HALLAZGO NUEVO ABIERTO; el test describe el
// comportamiento DESEADO, hoy falla y no rompe la suite. Al corregir el código pasará solo: quitar `todo`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {describe, it} from "node:test";
import {fileURLToPath} from "node:url";
import {MockTransport} from "../../static/src/app/redsys/mock/mock_transport.js";
import {RedsysService} from "../../static/src/app/redsys/redsys_service.js";
import {makeStartMarks} from "../../static/src/app/utils/redsys_pos_logic.js";
import {FakeTransport} from "../fake_transport.js";
import {KEY, makePos, transportOf} from "./harness/pos.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../static/src");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const payCount = (t) => t.callLog.filter((c) => c.cmd === "fnDllOperPinPad").length;
const charges = (t) =>
  t.operations.filter(
    (o) => o.tipoOper === "Autorizacion" && o.resultado === "Autorizada"
  );

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, f.name);
    f.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
/** Código de producción (sin comentarios) de todos los .js de static/src salvo el simulador. */
function productionSources() {
  return walk(SRC)
    .filter((f) => f.endsWith(".js") && !f.includes(`${path.sep}mock${path.sep}`))
    .map((f) => [
      path.relative(SRC, f),
      fs
        .readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, ""),
    ]);
}

async function fresh(opts) {
  const ctx = await makePos(opts);
  const transport = await transportOf(ctx);
  return {...ctx, transport};
}

// ------------------------------------------------------------------------------------------------
describe("ronda 2: intentos de romper las correcciones", () => {
  it("QA-11 defensa en profundidad: línea unknown con estado 'retry' (p. ej. 'Force cancel' del core) NO llega al datáfono", async () => {
    const {addLine, transport, dialogs} = await fresh();
    const line = addLine({
      redsys_state: "unknown",
      redsys_reference: "ODOO-DEADBEEF",
      payment_ref_no: "ODOO-DEADBEEF",
    });
    line.setPaymentStatus("retry");
    assert.equal(await line.pay(), false);
    assert.equal(payCount(transport), 0, "ni un solo cobro");
    assert.equal(
      line.payment_status,
      "force_done",
      "vuelve a quedar bloqueada, no 'retry'"
    );
    assert.match(dialogs.at(-1).props.title, /pendiente/i);
  });

  it("QA-13 cinco clics simultáneos en 'Reintentar' tras una denegación: un cobro y el estado final coherente en todas las llamadas", async () => {
    const {addLine, transport} = await fresh();
    const line = addLine();
    transport.forceNext({name: "denied", denialCode: "116"});
    assert.equal(await line.pay(), false);
    assert.equal(line.payment_status, "retry");
    const results = await Promise.all([
      line.pay(),
      line.pay(),
      line.pay(),
      line.pay(),
      line.pay(),
    ]);
    assert.deepEqual(results, [true, true, true, true, true]);
    assert.equal(line.payment_status, "done");
    assert.equal(charges(transport).length, 1);
    assert.equal(payCount(transport), 2, "1 denegado + 1 cobrado");
  });

  it("QA-01 ciclo completo con temporizador real: gracia -> reconsulta sola -> sigue bloqueada (nunca 'retry' automático) -> solo releaseLine libera", async () => {
    const {addLine, svc, order} = await fresh();
    svc.config.graceMs = 30;
    const line = addLine({
      redsys_reference: "ODOO-GRACE001",
      payment_ref_no: "ODOO-GRACE001",
    });
    line.setPaymentStatus("waitingCard");
    svc.markStart("ODOO-GRACE001");
    const first = await svc.recoverLine(line);
    assert.equal(first.outcome, "unknown");
    assert.equal(line.payment_status, "force_done");
    assert.equal(line.redsys_state, "unknown");
    await sleep(1300); // RetryInMs = max(1000, resto de gracia + 1000)
    assert.equal(
      line.payment_status,
      "force_done",
      "la reconsulta automática NO libera sola"
    );
    assert.equal(line.redsys_state, "unknown");
    assert.equal(svc.unresolved(order).length, 1, "sigue bloqueando otro cobro");
    assert.equal(await svc.releaseLine(line), true);
    assert.equal(line.payment_status, "retry");
    assert.ok(!line.redsys_state);
  });

  it("localStorage: solo claves redsys_start:<ref> con un entero; ni clave de firma ni PAN; se limpian al resolver", async () => {
    const written = new Map();
    const storage = {
      getItem: (k) => (written.has(k) ? written.get(k) : null),
      setItem: (k, v) => written.set(k, String(v)),
      removeItem: (k) => written.delete(k),
    };
    const history = [];
    const origSet = storage.setItem;
    storage.setItem = (k, v) => {
      history.push([k, String(v)]);
      return origSet(k, v);
    };
    // El servicio lee window.localStorage al arrancar: se inyecta antes de crear el POS.
    await makePos(); // Asegura que globalThis.window existe
    globalThis.window.localStorage = storage;
    try {
      const {addLine, transport} = await fresh();
      const ok = addLine();
      assert.equal(await ok.pay(), true);
      assert.equal(written.size, 0, "autorizado: la marca se borra");
      const bad = addLine();
      transport.forceNext("unknown_query_fails");
      assert.equal(await bad.pay(), false);
      assert.equal(
        written.size,
        1,
        "unknown: la marca se conserva (base de la gracia tras recargar)"
      );
    } finally {
      delete globalThis.window.localStorage;
    }
    assert.ok(history.length >= 2);
    for (const [k, v] of history) {
      assert.match(k, /^redsys_start:ODOO-[0-9A-F]{8}$/);
      assert.match(v, /^\d{13}$/);
      assert.ok(!(k + v).includes(KEY));
    }
  });

  it("marcas de inicio: valores corruptos/futuros en localStorage nunca ACORTAN la gracia (conservador)", () => {
    const now = 1_800_000_000_000;
    for (const raw of ["abc", "NaN", "Infinity", String(now + 3_600_000)]) {
      const marks = makeStartMarks({getItem: () => raw, setItem() {}, removeItem() {}});
      const got = marks.getOrStart("ODOO-X", now);
      // Corrupto => se trata como 'sin marca' y empieza ahora; futuro => elapsed negativo => espera la gracia entera.
      assert.ok(got === now || got === now + 3_600_000, `raw=${raw} got=${got}`);
    }
    // Un storage que lanza no rompe nada (modo privado / bloqueado).
    const boom = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
    };
    const marks = makeStartMarks(boom);
    assert.equal(marks.getOrStart("ODOO-Y", 123), 123);
    assert.equal(marks.get("ODOO-Y"), 123, "cae a memoria");
  });

  it("QA2-16 (BAJO) una marca vacía, '0' o no de 13 dígitos en localStorage NO da la gracia por vencida", () => {
    const marks = makeStartMarks({getItem: () => "", setItem() {}, removeItem() {}});
    const got = marks.getOrStart("ODOO-Z", 1_800_000_000_000);
    assert.equal(got, 1_800_000_000_000, "una marca vacía debe tratarse como ausente");
  });

  it("Web Locks: el cerrojo nunca queda retenido tras un error de transporte, una excepción o un timeout local", async () => {
    const held = new Set();
    const locks = {
      request(name, opts, cb) {
        if (held.has(name)) return Promise.resolve(cb(null));
        held.add(name);
        return Promise.resolve(cb({name})).finally(() => held.delete(name));
      },
    };
    for (const mode of ["throws", "never", "minus1"]) {
      const t = new FakeTransport();
      t.queue(
        "fnDllOperPinPad",
        mode === "throws"
          ? {throws: true}
          : mode === "never"
          ? {never: true}
          : {Response: -1, Result: null}
      );
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: mode === "never" ? 20 : 0,
        orphanMs: 60,
        locks,
      });
      s.configure({
        merchant: "777888991",
        terminal: "1",
        signKey: KEY,
        port: "COM9:,19200,N,8,1",
        version: "6.1",
        transport: t,
      });
      await s.init();
      await s.pay({amount: 5, reference: "ODOO-LOCK0001"});
      if (mode === "never") {
        // QA2-12: tras un timeout local la DLL puede seguir viva: el cerrojo lo retiene el "huérfano"
        // hasta el retorno tardío o el plazo (orphanMs), y entonces se libera solo.
        assert.equal(
          held.size,
          1,
          "cerrojo retenido mientras el cobro huérfano pueda seguir vivo"
        );
        await sleep(120);
      }
      assert.equal(held.size, 0, `cerrojo liberado (${mode})`);
    }
  });

  it("QA-12/secretos: ni el ticket, ni el XML, ni los diálogos, ni los avisos, ni la reactividad de `state` contienen la clave", async () => {
    const {addLine, transport, dialogs, notifications, svc} = await fresh();
    const a = addLine();
    await a.pay();
    const b = addLine();
    transport.forceNext("unknown_query_fails");
    await b.pay();
    const blob = JSON.stringify({
      dialogs: dialogs.map((d) => d.props),
      notifications,
      state: svc.state,
      a: [a.ticket, a.redsys_xml],
      b: [b.redsys_state],
    });
    assert.ok(!blob.includes(KEY));
  });
});

// ------------------------------------------------------------------------------------------------
describe("ronda 2: hallazgos nuevos (todo = abiertos)", () => {
  it("QA2-01 (BLOQUEANTE) cancelar/borrar un PEDIDO con líneas Redsys authorized/unknown/refund/en curso está bloqueado (PosStore.beforeDeleteOrder y _onBeforeDeleteOrder)", async () => {
    const ctx = await fresh();
    const {m, pos, addLine, dialogs} = ctx;
    const store = new m.stubs.PosStore();
    store.dialog = pos.dialog;
    const order = ctx.order;
    order.id = 5;
    // Pedido limpio (solo una línea Redsys denegada, sin estado): se puede borrar
    const clean = addLine();
    clean.setPaymentStatus("retry");
    assert.equal(
      await store._onBeforeDeleteOrder(order),
      true,
      "sin cargo posible: se borra"
    );
    assert.equal(await store.beforeDeleteOrder(order), true);
    order.payment_ids.length = 0;
    for (const [name, vals] of [
      ["authorized", {redsys_state: "authorized", payment_status: "done"}],
      ["refund", {redsys_state: "refund", payment_status: "done", amount: -5}],
      ["unknown", {redsys_state: "unknown", payment_status: "force_done"}],
      ["en curso", {payment_status: "waitingCard"}],
      ["force_done sin estado", {payment_status: "force_done"}],
    ]) {
      order.payment_ids.length = 0;
      addLine(vals);
      const before = dialogs.length;
      assert.equal(
        await store._onBeforeDeleteOrder(order),
        false,
        `${name}: _onBeforeDeleteOrder`
      );
      assert.equal(
        await store.beforeDeleteOrder(order),
        false,
        `${name}: beforeDeleteOrder`
      );
      assert.equal(dialogs.length, before + 2, `${name}: se explica al cajero`);
    }
  });

  it("QA2-01 alternativa clara: 'Guardar el pedido para conciliación' solo con líneas ya con estado Redsys; con una operación en curso solo se explica", async () => {
    const ctx = await fresh();
    const {m, pos, addLine, dialogs, order} = ctx;
    const store = new m.stubs.PosStore();
    store.dialog = pos.dialog;
    order.id = 9;
    addLine({
      redsys_state: "unknown",
      payment_status: "force_done",
      redsys_reference: "ODOO-SAVE0001",
    });
    await store._onBeforeDeleteOrder(order);
    const dlg = dialogs.at(-1);
    assert.equal(dlg.props.confirmLabel, "Guardar el pedido para conciliación");
    assert.match(dlg.props.body, /ODOO-SAVE0001/);
    await dlg.props.confirm();
    assert.deepEqual(store.pending, [9]);
    assert.equal(store.synced.length, 1);
    assert.deepEqual(store.synced[0].orders, [order]);
    order.payment_ids.length = 0;
    addLine({payment_status: "waitingCard"});
    await store._onBeforeDeleteOrder(order);
    assert.equal(
      dialogs.at(-1).props.confirm,
      undefined,
      "sin ofrecer guardar mientras el datáfono trabaja"
    );
  });

  it("QA2-02 (BLOQUEANTE) no se puede validar un pedido con una línea Redsys pendiente (force_done/unknown/en curso): el core la BORRARÍA", async () => {
    const ctx = await fresh();
    const {m, pos, addLine, dialogs, order} = ctx;
    const make = () => new m.stubs.default({pos, order});
    // Línea dudosa + efectivo pagado: el core ya no la borra porque isOrderValid la rechaza antes
    const dudosa = addLine({
      redsys_state: "unknown",
      payment_status: "force_done",
      redsys_reference: "ODOO-VAL00001",
    });
    const cash = {
      uuid: "cash-1",
      payment_method_id: {use_payment_terminal: null},
      payment_status: "done",
      amount: 12.34,
    };
    order.payment_ids.push(cash);
    const val = make();
    assert.equal(await val.validateOrder(false), false);
    assert.deepEqual(order.payment_ids, [dudosa, cash], "ninguna línea eliminada");
    assert.match(dialogs.at(-1).props.body, /ODOO-VAL00001/);
    assert.match(dialogs.at(-1).props.body, /no se puede validar/i);
    // En curso y retry con estado unknown (QA-11) tampoco
    for (const vals of [
      {payment_status: "waitingCard"},
      {payment_status: "retry", redsys_state: "unknown"},
    ]) {
      order.payment_ids.length = 0;
      addLine(vals);
      order.payment_ids.push(cash);
      assert.equal(await make().validateOrder(false), false, JSON.stringify(vals));
      assert.equal(order.payment_ids.length, 2);
    }
    // Una línea confirmada a mano (done + unknown, va a conciliación) y una denegada limpia NO bloquean
    order.payment_ids.length = 0;
    const confirmada = addLine({redsys_state: "unknown", payment_status: "done"});
    const denegada = addLine({payment_status: "retry"});
    order.payment_ids.push(cash);
    assert.equal(await make().validateOrder(false), true);
    assert.deepEqual(
      order.payment_ids,
      [confirmada, cash],
      "el core elimina solo la denegada limpia"
    );
    void denegada;
  });

  it("QA2-11 (MEDIO) Web Locks también para init() y checkStatus(): otra pestaña no toca la DLL mientras una cobra", async () => {
    const held = new Set();
    const locks = {
      request(name, opts, cb) {
        if (held.has(name)) return Promise.resolve(cb(null));
        held.add(name);
        return Promise.resolve(cb({name})).finally(() => held.delete(name));
      },
    };
    const transport = new MockTransport({
      latency: {cardRead: 60, process: 10, init: 0, consult: 0},
      logger: () => {},
    });
    const mk = () => {
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: 0,
        locks,
      });
      s.configure({
        merchant: "777888991",
        terminal: "1",
        signKey: KEY,
        port: "COM9:,19200,N,8,1",
        version: "6.1",
        transport,
      });
      return s;
    };
    const [a, b] = [mk(), mk()];
    await a.init();
    const p = a.pay({amount: 5, reference: "ODOO-TABA0001"});
    await sleep(10);
    const before = transport.callLog.length;
    const rb = await b.init(); // Pestaña B arrancando / recargando en mitad del cobro de A
    assert.equal(rb.code, "BUSY");
    assert.equal(b.state, "uninitialized", "B no queda en FAILED por un cerrojo ajeno");
    await b.checkStatus();
    const touched = transport.callLog
      .slice(before)
      .filter(
        (c) => /initFnDll|fnDllCheckStatus/.test(c.cmd) && !/:response/.test(c.cmd)
      );
    await p;
    assert.equal(
      touched.length,
      0,
      `la pestaña B llamó a la DLL durante el cobro de A: ${touched.map((c) => c.cmd)}`
    );
  });

  it("QA2-12 (MEDIO) tras un timeout local de cobro el cerrojo se retiene mientras la DLL pueda seguir viva: otra pestaña no puede cobrar", async () => {
    const held = new Set();
    const locks = {
      request(name, opts, cb) {
        if (held.has(name)) return Promise.resolve(cb(null));
        held.add(name);
        return Promise.resolve(cb({name})).finally(() => held.delete(name));
      },
    };
    const transport = new FakeTransport();
    transport.queue("fnDllOperPinPad", {never: true}); // La DLL de A no contesta jamás
    const mk = (ms) => {
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: ms,
        locks,
      });
      s.configure({
        merchant: "777888991",
        terminal: "1",
        signKey: KEY,
        port: "COM9:,19200,N,8,1",
        version: "6.1",
        transport,
      });
      return s;
    };
    const [a, b] = [mk(20), mk(0)];
    await a.init();
    await b.init();
    const ra = await a.pay({amount: 5, reference: "ODOO-TABA0001"});
    assert.equal(ra.status, "unknown");
    assert.equal(a.isBusy(), true, "en A sigue ocupado (orphan)");
    await b.pay({amount: 5, reference: "ODOO-TABB0002"});
    assert.equal(
      transport.count("fnDllOperPinPad"),
      1,
      "B no debe haber enviado un 2º cobro mientras el 1º puede seguir vivo"
    );
  });

  it("QA2-13 (BAJO) recoverLine desde OTRA pestaña con el cerrojo ocupado es 'skipped', no marca 'unknown' la línea viva", async () => {
    const held = new Set(["redsys-777888991-1"]); // La pestaña A tiene el cerrojo
    const locks = {
      request(name, opts, cb) {
        if (held.has(name)) return Promise.resolve(cb(null));
        return Promise.resolve(cb({name}));
      },
    };
    const ctx = await fresh();
    const entry = (await ctx.svc.getEntry(ctx.method)).entry;
    entry.redsys.locks = locks;
    const line = ctx.addLine({
      redsys_reference: "ODOO-LIVE0001",
      payment_ref_no: "ODOO-LIVE0001",
    });
    line.setPaymentStatus("waitingCard");
    const out = await ctx.svc.recoverLine(line);
    assert.equal(out.outcome, "skipped");
    assert.notEqual(line.redsys_state, "unknown");
  });

  it("QA2-14 (BAJO) recoverOrder no restaura paymentTerminalInProgress=true si el cobro en curso terminó mientras recuperaba", async () => {
    const ctx = await fresh();
    const line = ctx.addLine({
      redsys_reference: "ODOO-SAVED001",
      payment_ref_no: "ODOO-SAVED001",
      redsys_state: "unknown",
    });
    line.setPaymentStatus("force_done");
    ctx.pos.paymentTerminalInProgress = true; // Cobro en curso (core)
    const p = ctx.svc.recoverOrder(ctx.order, {silent: true});
    ctx.pos.paymentTerminalInProgress = false; // El core lo apaga al terminar su cobro
    await p;
    assert.equal(ctx.pos.paymentTerminalInProgress, false);
  });

  it("QA2-15 (BAJO) las marcas redsys_start:* huérfanas se purgan por antigüedad (y las corruptas) al arrancar el servicio", async () => {
    const now = 1_800_000_000_000;
    const store = new Map([
      ["redsys_start:ODOO-OLD00001", String(now - 8 * 24 * 3600 * 1000)],
      ["redsys_start:ODOO-NEW00001", String(now - 3600 * 1000)],
      ["redsys_start:ODOO-BAD00001", "0"],
      ["otra_clave", "1"],
    ]);
    const storage = {
      get length() {
        return store.size;
      },
      key: (i) => [...store.keys()][i] ?? null,
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    const marks = makeStartMarks(storage);
    assert.equal(marks.purge(7 * 24 * 3600 * 1000, now), 2);
    assert.deepEqual([...store.keys()].sort(), [
      "otra_clave",
      "redsys_start:ODOO-NEW00001",
    ]);
    // El servicio real la invoca al arrancar (storage inyectado antes de crearlo)
    await makePos();
    globalThis.window.localStorage = storage;
    store.set("redsys_start:ODOO-OLD00002", "1500000000000");
    try {
      await fresh();
      assert.ok(!store.has("redsys_start:ODOO-OLD00002"), "purga al arrancar");
    } finally {
      delete globalThis.window.localStorage;
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe("ronda 2: higiene de canales entre pestañas", () => {
  it("no hay BroadcastChannel, sessionStorage, IndexedDB propios ni cookies: el único almacenamiento es localStorage redsys_start:*", () => {
    for (const [file, text] of productionSources()) {
      assert.ok(
        !/BroadcastChannel|sessionStorage|indexedDB|document\.cookie|postMessage/.test(
          text
        ),
        file
      );
    }
    const withLocal = productionSources()
      .filter(([, t]) => /localStorage/.test(t))
      .map(([f]) => f);
    assert.deepEqual(withLocal.sort(), ["app/services/redsys_tpvpc_service.js"]);
  });
});

// ------------------------------------------------------------------------------------------------
describe("ronda 3: liberar una línea unknown ya sincronizada (QA2-04, cliente)", () => {
  it("línea con id de servidor: la liberación pasa por el RPC redsys_release_unknown, queda not_charged y el POS la elimina", async () => {
    const ctx = await fresh();
    const removed = [];
    ctx.order.removePaymentline = (l) => removed.push(l);
    const line = ctx.addLine({
      id: 77,
      redsys_state: "unknown",
      redsys_reference: "ODOO-REL00001",
      payment_ref_no: "ODOO-REL00001",
    });
    line.setPaymentStatus("force_done");
    assert.equal(await ctx.svc.releaseLine(line), true);
    const call = ctx.rpc.find((c) => c.fn === "redsys_release_unknown");
    assert.deepEqual(call.args, [[77]]);
    assert.equal(call.model, "pos.payment");
    assert.equal(
      line.redsys_state,
      "not_charged",
      "coincide con el servidor: el sync no intentará unknown -> False"
    );
    assert.deepEqual(removed, [line]);
  });

  it("si el servidor rechaza la liberación la línea sigue bloqueada (unknown/force_done) y se avisa", async () => {
    const ctx = await fresh();
    ctx.orm.call = async () => {
      throw new Error("denegado");
    };
    // El servicio guarda su propio orm: se reemplaza vía un servicio nuevo con el mismo pos
    const svc = ctx.m.service.redsysTpvpcService.start(ctx.pos.env, {
      pos: ctx.pos,
      orm: ctx.orm,
    });
    const line = ctx.addLine({id: 78, redsys_state: "unknown"});
    line.setPaymentStatus("force_done");
    assert.equal(await svc.releaseLine(line), false);
    assert.equal(line.redsys_state, "unknown");
    assert.equal(line.payment_status, "force_done");
    assert.match(ctx.dialogs.at(-1).props.title, /no se pudo liberar/i);
  });

  it("línea solo local (sin id de servidor): se libera como antes, sin RPC", async () => {
    const ctx = await fresh();
    const line = ctx.addLine({redsys_state: "unknown"});
    line.setPaymentStatus("force_done");
    assert.equal(await ctx.svc.releaseLine(line), true);
    assert.equal(ctx.rpc.filter((c) => c.fn === "redsys_release_unknown").length, 0);
    assert.equal(line.payment_status, "retry");
    assert.ok(!line.redsys_state);
  });
});
