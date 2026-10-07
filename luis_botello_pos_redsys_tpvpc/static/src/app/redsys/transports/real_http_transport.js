/** @odoo-module */
// Transporte real alternativo: JSON contra el servicio local de Redsys
// (TpvpcPinPadImplantadoService, http://localhost:10305). Solo si tpvpc-impl.js
// no sirve (plan §4.8).
//
// Mensaje (documentado):  { "Type":"func", "PinpadId":"1", "Command":..., "Args":[...] }
// Respuesta (documentada): { "Type":"response", "Command":..., "Response":int, "Result":string }
// Response == -99 => reinicializar con fnDllIniTpvpcLatente (que crea el proceso del PinpadId).
// Un JSON no válido devuelve `{}`.
//
// [SUPUESTO-HW] S5: el manual NO documenta método HTTP, ruta, cabeceras ni CORS.
// Se asume POST application/json a la raíz; todo es configurable (url, method,
// headers). Tampoco documenta eventos asíncronos por HTTP: subscribeEvent solo
// registra el callback (S5) y emit() permite alimentarlo si se descubre un canal.
//
// Nunca se registra la clave ni el cuerpo de las peticiones.

import { RET_TRANSPORT_ERROR } from "../errors.js";

export class RealHttpTransport {
    /**
     * @param {Object} [options]
     * @param {string} [options.url="http://localhost:10305/"]
     * @param {string} [options.method="POST"]
     * @param {Object} [options.headers]
     * @param {string} [options.pinpadId="1"]
     * @param {Function} [options.fetchImpl=globalThis.fetch]
     * @param {number} [options.timeoutMs=0] 0 = sin límite (el servicio aplica el suyo)
     */
    constructor(options = {}) {
        this.url = options.url || "http://localhost:10305/";
        this.method = options.method || "POST";
        this.headers = options.headers || { "Content-Type": "application/json" };
        this.pinpadId = String(options.pinpadId || "1");
        this._fetch = options.fetchImpl || null;
        this.timeoutMs = options.timeoutMs || 0;
        this._handlers = {};
    }

    async _send(command, args) {
        const fetchFn = this._fetch || globalThis.fetch;
        if (typeof fetchFn !== "function") {
            return { Response: RET_TRANSPORT_ERROR, Result: null };
        }
        const body = JSON.stringify({
            Type: "func",
            PinpadId: this.pinpadId,
            Command: command,
            Args: args,
        });
        let controller = null;
        let timer = null;
        if (this.timeoutMs > 0 && typeof AbortController === "function") {
            controller = new AbortController();
            timer = setTimeout(() => controller.abort(), this.timeoutMs);
        }
        try {
            const res = await fetchFn(this.url, {
                method: this.method,
                headers: this.headers,
                body,
                signal: controller ? controller.signal : undefined,
            });
            const json = await res.json();
            if (!json || typeof json.Response === "undefined") {
                return { Response: RET_TRANSPORT_ERROR, Result: null }; // `{}` = JSON no válido
            }
            return {
                Response: Number(json.Response),
                Result: typeof json.Result === "string" ? json.Result : null,
            };
        } catch {
            return { Response: RET_TRANSPORT_ERROR, Result: null };
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    initFnDll(args, cb) {
        this._send("fnDllIniTpvpcLatente", args).then(cb);
    }

    execFnDll(command, args, cb) {
        this._send(command, args).then(cb);
    }

    subscribeEvent(name, cb) {
        (this._handlers[name] ||= []).push(cb);
    }

    /** Punto de enganche para eventos si se descubre un canal (S5). */
    emit(name, payload) {
        for (const cb of this._handlers[name] || []) {
            cb(payload);
        }
    }

    EnableLog() {}
    DisableLog() {}
}
