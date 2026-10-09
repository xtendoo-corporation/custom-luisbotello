/** @odoo-module */
/**
 * MockTransport: simulador de `TpvpcImplantado` (tpvpc-impl.js) para desarrollar y
 * probar sin datáfono. Misma forma que las otras implementaciones de transporte:
 *   initFnDll(args[comercio, terminal, clave, puerto, version], cb({Response, Result}))
 *   execFnDll(command, args, cb({Response, Result}))
 *   subscribeEvent('pinpadImplantadoEvent_1..7', cb)
 *   EnableLog() / DisableLog()
 *
 * Reglas de seguridad: la clave de firma se usa solo para comprobar que no está vacía
 * y se descarta (no se guarda, ni se registra). Los XML solo contienen PAN enmascarado.
 *
 * Supuestos no verificados con hardware (ver DECISIONS.md, [SUPUESTO-HW] S8..S10):
 *  - orden/payload de eventos, el evento 3 se emite justo antes del callback final;
 *  - Response de errores de negocio de devolución (-3 + XML <Error>);
 *  - timeout que provoca -2, respuesta de consulta vacía y paginación.
 */
import {
  BRANDS,
  DEFAULT_DENIAL_CODE,
  DEFAULT_LATENCY,
  DENIAL_CODES,
  INIT_ERROR_CODES,
  SCENARIOS,
  VALID_VERSIONS,
  buildErrorXml,
  buildPayXml,
  buildQueryXml,
  buildRefundXml,
  buildRts,
  formatCents,
  malformXml,
  normalizeScenario,
  parseAmountToCents,
  parseQueryDate,
  truncateXml,
} from "./scenarios.js";

const EVENT_PREFIX = "pinpadImplantadoEvent_";
const PAGE_SIZE = 25;
const LOG_LIMIT = 300;

// ---------------------------------------------------------------------------
// Relojes
// ---------------------------------------------------------------------------
export const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

/** Reloj falso para tests: el tiempo solo avanza con advance()/runAll(). */
export class FakeClock {
  constructor(start = new Date(2026, 9, 7, 10, 0, 0).getTime()) {
    this._now = start;
    this._timers = [];
    this._seq = 0;
    this.now = () => this._now;
    this.setTimeout = (fn, ms = 0) => {
      const t = {id: ++this._seq, at: this._now + Math.max(0, ms), fn};
      this._timers.push(t);
      return t.id;
    };
    this.clearTimeout = (id) => {
      this._timers = this._timers.filter((t) => t.id !== id);
    };
  }

  get pending() {
    return this._timers.length;
  }

  /** Avanza `ms` ejecutando los temporizadores vencidos en orden (también los creados al vuelo). */
  advance(ms) {
    const target = this._now + ms;
    for (;;) {
      const due = this._timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) {
        break;
      }
      this._timers = this._timers.filter((t) => t !== due);
      this._now = Math.max(this._now, due.at);
      due.fn();
    }
    this._now = target;
  }

  /** Ejecuta todo lo pendiente (con un tope por seguridad). */
  runAll(limit = 10000) {
    let n = 0;
    while (this._timers.length && n++ < limit) {
      const next = this._timers.reduce((a, b) => (b.at < a.at ? b : a));
      this.advance(Math.max(0, next.at - this._now));
    }
  }
}

// ---------------------------------------------------------------------------
// Almacén de operaciones simuladas
// ---------------------------------------------------------------------------
export class OperationStore {
  constructor({firstPedido = 10549} = {}) {
    this._firstPedido = firstPedido;
    this.clear();
  }

  clear() {
    this.ops = [];
    this._seq = 0;
    this._pedido = this._firstPedido;
  }

  nextSeq() {
    return ++this._seq;
  }

  nextPedido() {
    return String(this._pedido++);
  }

  add(op) {
    this.ops.push(op);
    return op;
  }

  findByPedido(pedido) {
    return this.ops.find((o) => o.pedido === String(pedido)) || null;
  }

  findByRts(rts) {
    return this.ops.find((o) => o.rts === String(rts)) || null;
  }

  /** Céntimos ya devueltos (devoluciones autorizadas) sobre un pedido original. */
  refundedCents(pedido) {
    return this.ops
      .filter(
        (o) =>
          o.tipoOper === "Devolucion" &&
          o.pedidoBase === String(pedido) &&
          o.resultado === "Autorizada"
      )
      .reduce((sum, o) => sum + o.cents, 0);
  }

  /** Filtros de fnDllOperConsulta; más recientes primero (como en los ejemplos del manual). */
  query({pedido, rts, factura, fromMs, toMs, tipoOper, resultado} = {}) {
    let list = this.ops;
    if (rts) {
      list = list.filter((o) => o.rts === rts); // Con RTS se ignora el resto de filtros
    } else {
      if (pedido) {
        list = list.filter((o) => o.pedido === pedido);
      }
      if (factura) {
        list = list.filter((o) => o.factura === factura);
      }
      if (fromMs != null) {
        list = list.filter((o) => o.fechaMs >= fromMs);
      }
      if (toMs != null) {
        list = list.filter((o) => o.fechaMs <= toMs + 999); // Fin inclusivo del segundo
      }
      if (tipoOper) {
        list = list.filter((o) => o.tipoOper === tipoOper);
      }
      if (resultado) {
        list = list.filter((o) => o.resultado.toUpperCase() === resultado);
      }
    }
    return [...list].sort(
      (a, b) => b.fechaMs - a.fechaMs || Number(b.pedido) - Number(a.pedido)
    );
  }
}

// ---------------------------------------------------------------------------
// Transporte simulado
// ---------------------------------------------------------------------------
const nullish = (v) => v === null || v === undefined || v === "" || v === "NULL";

export class MockTransport {
  /**
   * @param {Object} [options]
   * @param {Object} [options.clock] {now, setTimeout, clearTimeout}; por defecto el real.
   * @param {number|Object} [options.latency] ms para todo (0 = instantáneo) u objeto con
   *        claves de DEFAULT_LATENCY.
   * @param {string|Object} [options.scenario] escenario por defecto (se aplica cuando no hay uno forzado).
   * @param {OperationStore} [options.store]
   * @param {String} [options.brand] clave de BRANDS (por defecto MASTERCARD, como el manual).
   * @param {String} [options.last4] últimos 4 dígitos del PAN simulado.
   * @param {Boolean} [options.keysUpdating] emite el evento 2 antes de la lectura.
   * @param {Function} [options.logger] recibe líneas de log sin secretos cuando EnableLog().
   */
  constructor(options = {}) {
    this.isMock = true;
    this.clock = options.clock || realClock;
    this.latency = {...DEFAULT_LATENCY};
    this.setLatency(options.latency);
    this.store = options.store || new OperationStore();
    this.defaultScenario = normalizeScenario(options.scenario || "authorized");
    this.brand = options.brand || "MASTERCARD";
    this.last4 = options.last4 || "0018";
    this.keysUpdating = Boolean(options.keysUpdating);
    this._logger = options.logger || ((line) => console.debug(line)); // eslint-disable-line no-console
    this._logEnabled = false;
    this.reset();
  }

  // ---- API TpvpcImplantado -------------------------------------------------

  EnableLog() {
    this._logEnabled = true;
  }

  DisableLog() {
    this._logEnabled = false;
  }

  subscribeEvent(name, cb) {
    (this._listeners[name] ||= []).push(cb);
  }

  initFnDll(args, cb) {
    const [comercio, terminal, clave, puerto, version] = args || [];
    // Nunca se registra ni se guarda la clave.
    this._record("initFnDll", [comercio, terminal, "***", puerto, version]);
    const spec = this._pick("init");
    let code = 0;
    if (spec?.name === "init_error") {
      code = spec.code ?? -16;
    } else if (nullish(comercio)) {
      code = -3;
    } else if (nullish(terminal)) {
      code = -4;
    } else if (nullish(clave)) {
      code = -5;
    } else if (!nullish(version) && !VALID_VERSIONS.includes(String(version))) {
      code = -21;
    }
    this._later(this._lat("init", spec), () => {
      if (code === 0) {
        this._cfg = {
          comercio: String(comercio),
          terminal: String(Number(terminal) || terminal),
          version,
          puerto,
        };
        this._initialized = true;
        this._notInitCode = -1;
      } else {
        this._initialized = false;
      }
      this._deliver(cb, "initFnDll", {Response: code, Result: null});
    });
  }

  execFnDll(command, args, cb) {
    this._record(command, args);
    switch (command) {
      case "fnDllOperPinPad":
        return this._pay(args || [], cb);
      case "fnDllOperComContable":
        return this._refund(args || [], cb);
      case "fnDllOperConsulta":
        return this._consult(args || [], cb);
      case "fnDllCheckStatus":
        return this._check(cb);
      case "fnDllParaTpvpcLatente":
        return this._later(this._lat("instant"), () => {
          this._initialized = false;
          this._deliver(cb, command, {Response: 0, Result: null});
        });
      default:
        return this._later(this._lat("instant"), () =>
          this._deliver(cb, command, {Response: -13, Result: null})
        );
    }
  }

  // ---- API de simulación (tests y consola) -----------------------------------

  /** Latencia: número (todas) u objeto parcial. */
  setLatency(latency) {
    if (typeof latency === "number") {
      Object.keys(DEFAULT_LATENCY).forEach((k) => (this.latency[k] = latency));
    } else if (latency && typeof latency === "object") {
      Object.assign(this.latency, latency);
    }
  }

  /** Encola un resultado para la siguiente llamada que lo admita (una sola vez). */
  forceNext(spec) {
    const s = normalizeScenario(spec);
    this._queue.push(s);
    return s;
  }

  setDefaultScenario(spec) {
    this.defaultScenario = normalizeScenario(spec);
  }

  get queue() {
    return this._queue.map((s) => ({...s}));
  }

  clearForced() {
    this._queue = [];
  }

  /** Siembra una operación ya existente (p. ej. cobrada antes de arrancar el test). */
  seedOperation(partial = {}) {
    const now = this.clock.now();
    return this._createOp({
      tipoOper: "Autorizacion",
      cents: partial.cents ?? 100,
      factura: partial.factura ?? "SEED",
      fechaMs: now,
      ...partial,
    });
  }

  /** Cancela temporizadores y restablece estado interno (no vacía el almacén). */
  reset() {
    (this._timers || []).forEach((h) => this.clock.clearTimeout(h));
    this._timers = [];
    this._listeners = {};
    this._queue = [];
    this._initialized = false;
    this._notInitCode = -1;
    this._cfg = null;
    this._busy = false;
    this._failConsults = 0;
    this.callLog = [];
    this.eventLog = [];
    this.busyViolations = 0;
  }

  get initialized() {
    return this._initialized;
  }

  get busy() {
    return this._busy;
  }

  get operations() {
    return this.store.ops;
  }

  // ---- Operaciones --------------------------------------------------------

  _pay(args, cb) {
    const [importe, factura, tipo] = args;
    const cmd = "fnDllOperPinPad";
    if (this._busy) {
      // La librería real no admite transacciones simultáneas.
      this.busyViolations++;
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: -3, Result: null})
      );
    }
    if (!this._initialized) {
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: this._notInitCode, Result: null})
      );
    }
    const cents = parseAmountToCents(importe);
    if (cents === null || cents === 0) {
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: -18, Result: null})
      );
    }
    if ((!nullish(tipo) && tipo !== "PAGO") || String(factura ?? "").length > 20) {
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: -13, Result: null})
      );
    }
    const spec = this._pick("pay");
    const base = {cents, factura: String(factura ?? "")};

    // Escenarios que cortan sin lectura de tarjeta.
    if (spec.name === "reinit_1" || spec.name === "reinit_99") {
      return this._failNotInitialized(cb, cmd, spec);
    }
    if (spec.name === "return_code") {
      return this._later(this._lat("instant", spec), () =>
        this._deliver(cb, cmd, {Response: spec.code ?? -3, Result: null})
      );
    }

    this._busy = true;
    const tCard = this._lat("cardRead", spec);
    const tProc = this._lat("process", spec);
    this._later(this._lat("instant", spec), () => {
      if (spec.keysUpdating ?? this.keysUpdating) {
        this._emit(2);
      }
      this._emit(1);
    });

    if (spec.name === "unknown_charged" || spec.name === "unknown_query_fails") {
      this._later(tCard, () => this._emit(4));
      this._later(tCard + tProc, () =>
        this._createOp({...base, tipoOper: "Autorizacion", spec})
      );
      if (spec.name === "unknown_query_fails") {
        this._failConsults = spec.failConsults ?? 1;
      }
      return this._timeoutEnd(cb, cmd, spec, tCard + tProc);
    }
    if (spec.name === "unknown_not_charged") {
      return this._timeoutEnd(cb, cmd, spec, 0);
    }

    // Authorized | denied | denied_g | malformed_xml | truncated_xml
    this._later(tCard, () => this._emit(4));
    this._later(tCard + tProc, () => {
      const denied = spec.name === "denied" || spec.name === "denied_g";
      const op = this._createOp({
        ...base,
        tipoOper: "Autorizacion",
        spec: denied ? {...spec, denied: true} : spec,
      });
      let xml = buildPayXml(op);
      if (spec.name === "malformed_xml") {
        xml = malformXml(xml);
      } else if (spec.name === "truncated_xml") {
        xml = truncateXml(xml);
      }
      this._busy = false;
      this._emit(3);
      this._deliver(cb, cmd, {Response: 0, Result: xml});
    });
  }

  _refund(args, cb) {
    const [pedido, rts, importe, factura, tipo] = args;
    const cmd = "fnDllOperComContable";
    if (this._busy) {
      this.busyViolations++;
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: -3, Result: null})
      );
    }
    if (!this._initialized) {
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: this._notInitCode, Result: null})
      );
    }
    const cents = parseAmountToCents(importe);
    if (
      nullish(pedido) ||
      cents === null ||
      cents === 0 ||
      (!nullish(tipo) && tipo !== "DEVOLUCION")
    ) {
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: -3, Result: null})
      );
    }
    const spec = this._pick("refund");
    if (spec.name === "reinit_1" || spec.name === "reinit_99") {
      return this._failNotInitialized(cb, cmd, spec);
    }
    if (spec.name === "return_code") {
      return this._later(this._lat("instant", spec), () =>
        this._deliver(cb, cmd, {Response: spec.code ?? -3, Result: null})
      );
    }

    // Reglas de negocio: solo existe devolución si hay pedido/RTS originales y importe <= original.
    const original = this.store.findByPedido(pedido);
    const businessError = this._refundBusinessError(
      original,
      nullish(rts) ? null : String(rts),
      cents
    );
    if (businessError) {
      return this._later(this._lat("refund", spec), () =>
        this._deliver(cb, cmd, {
          Response: -3, // [SUPUESTO-HW] S8: la DLL real podría devolver 0 con XML <Error>
          Result: buildErrorXml(businessError.codigo, businessError.mensaje, "mock"),
        })
      );
    }

    this._busy = true;
    const tProc = this._lat("refund", spec);
    const make = (extra = {}) =>
      this._createOp({
        tipoOper: "Devolucion",
        cents,
        factura: String(factura ?? ""),
        pedidoBase: original.pedido,
        last4: original.last4,
        marca: original.marca,
        spec: {...spec, ...extra},
      });

    if (spec.name === "unknown_charged") {
      this._later(tProc, () => make({denied: false}));
      return this._timeoutEnd(cb, cmd, spec, tProc);
    }
    if (spec.name === "unknown_not_charged") {
      return this._timeoutEnd(cb, cmd, spec, 0);
    }
    this._later(tProc, () => {
      const denied = spec.name === "denied";
      const op = make({denied});
      let xml = buildRefundXml(op);
      if (spec.name === "malformed_xml") {
        xml = malformXml(xml);
      } else if (spec.name === "truncated_xml") {
        xml = truncateXml(xml);
      }
      this._busy = false;
      this._deliver(cb, cmd, {Response: 0, Result: xml});
    });
  }

  _refundBusinessError(original, rts, cents) {
    if (
      !original ||
      original.tipoOper !== "Autorizacion" ||
      (rts && original.rts !== rts)
    ) {
      return {
        codigo: "TPV-PC0091",
        mensaje: "Se ha producido un error. La operación especificada no existe.",
      };
    }
    if (original.resultado !== "Autorizada") {
      return {
        codigo: "TPV-PC0123",
        mensaje:
          "No se puede realizar la acción requerida sobre una operación que resultó errónea o denegada.",
      };
    }
    if (cents > original.cents - this.store.refundedCents(original.pedido)) {
      return {
        codigo: "TPV-PC0100",
        mensaje:
          "No puede realizar una DEVOLUCION/CONFIRMACION sobre la operación especificada.",
      };
    }
    return null;
  }

  _consult(args, cb) {
    const cmd = "fnDllOperConsulta";
    const [pedido, rts, factura, fechaIni, fechaFin, tipo, resultado, pagina] = args;
    if (!this._initialized) {
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: this._notInitCode, Result: null})
      );
    }
    if (this._failConsults > 0) {
      this._failConsults--;
      return this._later(this._lat("consult"), () =>
        this._deliver(cb, cmd, {Response: -2, Result: null})
      );
    }
    const tipoMap = {PAGO: "Autorizacion", DEVOLUCION: "Devolucion"};
    const fromMs = nullish(fechaIni) ? null : parseQueryDate(fechaIni);
    const toMs = nullish(fechaFin) ? null : parseQueryDate(fechaFin);
    const bad =
      (!nullish(fechaIni) && fromMs === null) ||
      (!nullish(fechaFin) && toMs === null) ||
      (!nullish(tipo) && !tipoMap[tipo]) ||
      (!nullish(resultado) && !["AUTORIZADA", "DENEGADA"].includes(resultado));
    if (bad) {
      return this._later(this._lat("instant"), () =>
        this._deliver(cb, cmd, {Response: -3, Result: null})
      );
    }
    const found = this.store.query({
      pedido: nullish(pedido) ? null : String(pedido),
      rts: nullish(rts) ? null : String(rts),
      factura: nullish(factura) ? null : String(factura),
      fromMs,
      toMs,
      tipoOper: nullish(tipo) ? null : tipoMap[tipo],
      resultado: nullish(resultado) ? null : resultado,
    });
    const page = Math.max(0, parseInt(pagina, 10) || 0);
    const totalPages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    const slice = found.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    this._later(this._lat("consult"), () => {
      const xml = buildQueryXml(slice, {
        page,
        totalPages,
        total: found.length,
        comercio: this._cfg.comercio,
        nowMs: this.clock.now(),
      });
      this._deliver(cb, cmd, {Response: 0, Result: xml});
    });
  }

  _check(cb) {
    const spec = this._pick("check");
    let code = 0;
    if (!this._initialized) {
      code = -1;
    } else if (spec?.name === "check_terminal_fail") {
      code = -2;
    } else if (spec?.name === "check_server_fail") {
      code = -3;
    }
    this._later(this._lat("check", spec), () =>
      this._deliver(cb, "fnDllCheckStatus", {Response: code, Result: null})
    );
  }

  // ---- Internos -----------------------------------------------------------

  /** Extrae el primer escenario forzado aplicable a `op`; si no hay, el por defecto (si aplica). */
  _pick(op) {
    const i = this._queue.findIndex((s) => SCENARIOS[s.name].ops.includes(op));
    if (i >= 0) {
      return this._queue.splice(i, 1)[0];
    }
    if (SCENARIOS[this.defaultScenario.name].ops.includes(op)) {
      return this.defaultScenario;
    }
    return op === "init" || op === "check" ? null : {name: "authorized"};
  }

  _failNotInitialized(cb, cmd, spec) {
    this._later(this._lat("instant", spec), () => {
      this._initialized = false;
      this._notInitCode = spec.code;
      this._deliver(cb, cmd, {Response: spec.code, Result: null});
    });
  }

  /** -2: eventos 5 y 3 al agotar el tiempo y callback con Response -2. */
  _timeoutEnd(cb, cmd, spec, minMs) {
    const at = Math.max(this._lat("timeout", spec), minMs);
    this._later(at, () => {
      this._busy = false;
      this._emit(5);
      this._emit(3);
      this._deliver(cb, cmd, {Response: -2, Result: null});
    });
  }

  _createOp({
    tipoOper,
    cents,
    factura,
    spec = {},
    pedidoBase,
    last4,
    marca,
    fechaMs,
    ...rest
  }) {
    // Spec.charged === false: la respuesta se genera pero la operación no queda en el almacén.
    const seq = this.store.nextSeq();
    const now = fechaMs ?? this.clock.now();
    const denied = Boolean(spec.denied);
    const denialCode = String(spec.denialCode ?? DEFAULT_DENIAL_CODE);
    const op = {
      seq,
      tipoOper,
      cents,
      factura,
      pedido: this.store.nextPedido(),
      rts: buildRts(now, seq),
      fechaMs: now,
      comercio: this._cfg?.comercio ?? "000000000",
      terminal: this._cfg?.terminal ?? "1",
      last4: last4 ?? spec.last4 ?? this.last4,
      marca: marca ?? BRANDS[spec.brand ?? this.brand] ?? BRANDS.MASTERCARD,
      caducidad: "1230",
      estado: spec.name === "denied_g" ? "G" : "F",
      resultado: denied ? "Denegada" : "Autorizada",
      codigoRespuesta: denied ? denialCode : String(80922 + seq).padStart(6, "0"),
      authCode: String(80922 + seq).padStart(6, "0"),
      ...(pedidoBase ? {pedidoBase: String(pedidoBase)} : {}),
      ...rest,
    };
    if (spec.charged !== false) {
      this.store.add(op);
    }
    return op;
  }

  _lat(key, spec) {
    return spec?.latency?.[key] ?? this.latency[key];
  }

  _later(ms, fn) {
    const h = this.clock.setTimeout(() => {
      this._timers = this._timers.filter((x) => x !== h);
      fn();
    }, ms);
    this._timers.push(h);
    return h;
  }

  _emit(n) {
    const name = EVENT_PREFIX + n;
    this.eventLog.push(n);
    this._log(`event ${name}`);
    // [SUPUESTO-HW] S4: payload real desconocido (tpvpc-impl.js no disponible).
    (this._listeners[name] || []).forEach((cb) => {
      try {
        cb({Response: 0, Result: null});
      } catch (e) {
        this._log(`listener error ${name}: ${e && e.message}`);
      }
    });
  }

  _deliver(cb, cmd, ret) {
    this._record(`${cmd}:response`, [
      ret.Response,
      ret.Result == null ? null : `xml(${ret.Result.length})`,
    ]);
    if (typeof cb === "function") {
      cb(ret);
    }
  }

  _record(cmd, args) {
    // Los args de las operaciones no llevan secretos (importe, referencia, pedido, fechas).
    const entry = {
      at: this.clock.now(),
      cmd,
      args: Array.isArray(args) ? [...args] : args,
    };
    this.callLog.push(entry);
    if (this.callLog.length > LOG_LIMIT) {
      this.callLog.shift();
    }
    this._log(`${cmd} ${JSON.stringify(entry.args)}`);
  }

  _log(line) {
    if (this._logEnabled) {
      this._logger(`[MockTransport] ${line}`);
    }
  }
}

export {DENIAL_CODES, INIT_ERROR_CODES, SCENARIOS, formatCents};
