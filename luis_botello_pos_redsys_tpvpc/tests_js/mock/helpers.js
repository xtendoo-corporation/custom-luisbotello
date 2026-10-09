import {
  FakeClock,
  MockTransport,
} from "../../static/src/app/redsys/mock/mock_transport.js";

export const KEY = "SECRETKEY-1234567890";
export const INIT_ARGS = ["777888991", "1", KEY, "COM9:,19200,N,8,1", "6.1"];

export function tag(xml, name) {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? m[1] : null;
}

export function tags(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, "g"))].map(
    (m) => m[1]
  );
}

/** Lista de nombres de etiqueta de apertura en orden de aparición. */
export function tagOrder(xml) {
  return [...xml.matchAll(/<([A-Za-z][\w.]*)[ >]/g)].map((m) => m[1]);
}

/** Comprobador mínimo de balanceo de etiquetas. */
export function isWellFormed(xml) {
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w.]*)([^<>]*?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(xml))) {
    if (
      xml.slice(last, m.index).includes("<") ||
      xml.slice(last, m.index).includes(">")
    ) {
      return false;
    }
    last = re.lastIndex;
    if (m[4]) {
      continue;
    }
    if (m[1]) {
      if (stack.pop() !== m[2]) {
        return false;
      }
    } else {
      stack.push(m[2]);
    }
  }
  return stack.length === 0 && last === xml.length;
}

/** Entorno con reloj falso: init(), exec() y avance de tiempo síncronos. */
export function setup(options = {}) {
  const clock = new FakeClock();
  const t = new MockTransport({clock, ...options});
  const events = [];
  for (let i = 1; i <= 7; i++) {
    t.subscribeEvent(`pinpadImplantadoEvent_${i}`, () =>
      events.push({n: i, at: clock.now()})
    );
  }
  const init = (args = INIT_ARGS) => {
    let r;
    t.initFnDll(args, (x) => (r = x));
    clock.advance(2000);
    return r;
  };
  /** Ejecuta y avanza `ms` (por defecto lo suficiente para cualquier escenario). */
  const exec = (cmd, args, ms = 120000) => {
    let r;
    t.execFnDll(cmd, args, (x) => (r = x));
    clock.advance(ms);
    return r;
  };
  const pay = (amount = "12.34", ref = "ODOO-ABCD1234", ms) =>
    exec("fnDllOperPinPad", [amount, ref, "PAGO"], ms);
  const refund = (pedido, rts, amount, ref = "REF-1") =>
    exec("fnDllOperComContable", [pedido, rts, amount, ref, "DEVOLUCION"]);
  const consult = (o = {}) =>
    exec("fnDllOperConsulta", [
      o.pedido ?? null,
      o.rts ?? null,
      o.factura ?? null,
      o.from ?? null,
      o.to ?? null,
      o.tipo ?? null,
      o.resultado ?? null,
      o.page ?? "0",
    ]);
  return {clock, t, events, init, exec, pay, refund, consult};
}
