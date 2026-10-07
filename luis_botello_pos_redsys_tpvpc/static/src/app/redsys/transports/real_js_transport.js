/** @odoo-module */
// Transporte real: envuelve tpvpc-impl.js (librería de Redsys, cargada como
// asset aparte; NO se modifica ni se importa desde aquí).
//
// [SUPUESTO-HW] S4: el fichero tpvpc-impl.js todavía no se ha leído. Este
// transporte usa solo la API documentada (Integración TpvpcImplantado con
// JavaScript v1.0 y plan §4.7): initFnDll(args, cb), execFnDll(name, args, cb),
// subscribeEvent(name, cb), EnableLog(), DisableLog(), con cb({Response, Result}).
// Cómo se obtiene la instancia (global `window.tpvpcImpl`, `new
// Tpvpc.TpvpcImplantado()` o import dinámico) se decide al ver el fichero real.
//
// Seguridad: nunca se registra la clave (args[2] de init) ni XML con tarjeta.
// El log propio de la librería puede volcar argumentos: se deja DESACTIVADO
// (DisableLog al conectar) y solo se activa con enableLog() explícito.

import {RET_TRANSPORT_ERROR} from "../errors.js";

export class RealJsTransport {
  /**
   * @param {Object} [options]
   * @param {Object} [options.impl] instancia ya creada de TpvpcImplantado
   * @param {() => (Object|Promise<Object>)} [options.loader] devuelve la instancia (o el módulo con TpvpcImplantado)
   * @param {Object} [options.globalObject=globalThis]
   */
  constructor(options = {}) {
    this._impl = options.impl || null;
    this._loader = options.loader || null;
    this._global = options.globalObject || globalThis;
    this._implPromise = null;
    this._subs = [];
    this._logWanted = false;
  }

  async _ensureImpl() {
    if (this._impl) {
      return this._impl;
    }
    if (!this._implPromise) {
      this._implPromise = (async () => {
        let found = this._loader ? await this._loader() : null;
        if (found && typeof found.TpvpcImplantado === "function") {
          found = new found.TpvpcImplantado();
        }
        found = found || this._global.tpvpcImpl;
        if (
          !found &&
          this._global.Tpvpc &&
          typeof this._global.Tpvpc.TpvpcImplantado === "function"
        ) {
          found = new this._global.Tpvpc.TpvpcImplantado();
        }
        if (!found) {
          throw new Error("tpvpc-impl.js no está cargado");
        }
        this._impl = found;
        this._applyLog(found);
        for (const [name, cb] of this._subs) {
          found.subscribeEvent(name, cb);
        }
        return found;
      })();
      // Si falla la carga, permitir un reintento posterior
      this._implPromise.catch(() => {
        this._implPromise = null;
      });
    }
    return this._implPromise;
  }

  _applyLog(impl) {
    try {
      if (this._logWanted) {
        impl.EnableLog();
      } else {
        impl.DisableLog();
      }
    } catch {
      // La librería puede no exponerlos (S4)
    }
  }

  _wrap(cb) {
    let done = false;
    return (ret) => {
      if (done) {
        return;
      }
      done = true;
      const response = Number(ret && ret.Response);
      cb({
        Response: Number.isFinite(response) ? response : RET_TRANSPORT_ERROR,
        Result: ret && typeof ret.Result === "string" ? ret.Result : null,
      });
    };
  }

  initFnDll(args, cb) {
    const done = this._wrap(cb);
    this._ensureImpl()
      .then((impl) => impl.initFnDll(args, done))
      .catch(() => done({Response: RET_TRANSPORT_ERROR, Result: null}));
  }

  execFnDll(command, args, cb) {
    const done = this._wrap(cb);
    this._ensureImpl()
      .then((impl) => impl.execFnDll(command, args, done))
      .catch(() => done({Response: RET_TRANSPORT_ERROR, Result: null}));
  }

  subscribeEvent(name, cb) {
    this._subs.push([name, cb]);
    if (this._impl) {
      this._impl.subscribeEvent(name, cb);
    }
  }

  EnableLog() {
    this._logWanted = true;
    if (this._impl) {
      this._applyLog(this._impl);
    }
  }

  DisableLog() {
    this._logWanted = false;
    if (this._impl) {
      this._applyLog(this._impl);
    }
  }
}
