/** @odoo-module */
// RedsysService: lógica de cobro/devolución/consulta contra TPV-PC Implantado.
// Contrato: docs/service_contract.md. Puro JS: sin Odoo, transporte inyectado
// (RealJs, RealHttp o Mock con la misma interfaz).
//
// Reglas de oro (plan §4.5, §4.10):
//  - Retorno 0 != autorizado: autorizado <=> estado=="F" && resultado=="autorizada".
//  - Retorno -2 en un pago => resultado DESCONOCIDO: consultar +-10 min por
//    `reference`. Nunca reintentar el cobro a ciegas (doble cobro).
//  - init solo al arrancar o tras -1/-99, con UN reintento con backoff.
//    Nunca en bucle (riesgo de bloqueo de la cuenta del servicio).
//  - Una sola operación simultánea (isBusy).
//  - Nunca se registra la clave de firma ni XML con datos de tarjeta.

import {
    CODE_BAD_RESPONSE,
    CODE_BUSY,
    CODE_INVALID_PARAMS,
    CODE_LIB_EXPIRED,
    CODE_NOT_CHARGED,
    CODE_NOT_INITIALIZED,
    CODE_UNKNOWN_RESULT,
    RET_LIB_EXPIRED,
    RET_SERVICE_REINIT,
    RET_TRANSPORT_ERROR,
    SERVICE_MESSAGES,
    describeReturn,
    describeTpvpc,
    needsRecoveryQuery,
} from "./errors.js";
import { isAuthorized, parsePayXml, parseQueryXml } from "./xml_parser.js";

export const STATES = {
    UNINITIALIZED: "uninitialized",
    INITIALIZING: "initializing",
    READY: "ready",
    PAYING: "paying",
    REFUNDING: "refunding",
    RECOVERING: "recovering",
    FAILED: "failed", // init agotó su único reintento; solo init() explícito (con enfriamiento) lo reintenta
};

/** Eventos asíncronos del JS (§4.6) -> nombre del contrato. */
export const EVENTS = {
    1: "cardReading",
    2: "keysUpdating",
    3: "transactionEnd",
    4: "cardOk",
    5: "error",
    6: "dcc",
    7: "extraPayments",
};

const FN_INIT = "fnDllIniTpvpcLatente";
const FN_PAY = "fnDllOperPinPad";
const FN_REFUND = "fnDllOperComContable";
const FN_QUERY = "fnDllOperConsulta";
const FN_STATUS = "fnDllCheckStatus";
const FN_STOP = "fnDllParaTpvpcLatente";

const REFERENCE_RE = /^[A-Za-z0-9_\-.]{1,20}$/;
const MAX_QUERY_PAGES = 5;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pad = (n, len = 2) => String(n).padStart(len, "0");

/** Fecha de consulta Redsys "YYYYMMdd HHmmss" (hora local del equipo; [SUPUESTO-HW] S4). */
export function formatRedsysDate(date) {
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())} ` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

/** Importe "12.34": punto, 2 decimales, sin miles. Devuelve null si no es válido. */
export function formatAmount(amount) {
    const n = typeof amount === "string" ? Number(amount.replace(",", ".")) : amount;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
        return null;
    }
    const cents = Math.round(n * 100);
    return `${Math.floor(cents / 100)}.${pad(cents % 100)}`;
}

/** Referencia estable derivada del uuid de la línea POS: "ODOO-<8 hex>" (<= 20 car.). */
export function makeReference(uuid) {
    const hex = String(uuid || "")
        .replace(/[^0-9a-fA-F]/g, "")
        .slice(0, 8)
        .toUpperCase();
    return hex.length === 8 ? `ODOO-${hex}` : null;
}

const nz = (value) => (value === undefined || value === null || value === "" ? null : String(value));

export class RedsysService {
    /**
     * @param {Object} [options] inyectables para tests
     * @param {() => Date} [options.now]
     * @param {(ms:number) => Promise<void>} [options.sleep]
     * @param {number} [options.initBackoffMs=2000] espera antes del único reintento de init
     * @param {number} [options.initCooldownMs=5000] mínimo entre secuencias de init fallidas
     * @param {number} [options.callTimeoutMs=180000] 0 = sin límite; vencido => resultado DESCONOCIDO (-98, nunca "no cobrado")
     * @param {number} [options.orphanMs=300000] ocupado tras un timeout local de cobro/devolución (QA-02)
     * @param {Object} [options.locks] navigator.locks o equivalente: exclusión entre pestañas (QA-22)
     * @param {number} [options.recoveryWindowMs=600000] +-10 min (Anexo IX)
     * @param {boolean} [options.preflight=false] CheckStatus antes de cobrar (S4: validar con hardware)
     * @param {(msg:string, data?:Object)=>void} [options.logger] solo recibe op/códigos, jamás clave/XML
     */
    constructor(options = {}) {
        this.now = options.now || (() => new Date());
        this.sleep = options.sleep || defaultSleep;
        this.initBackoffMs = options.initBackoffMs ?? 2000;
        this.initCooldownMs = options.initCooldownMs ?? 5000;
        this.callTimeoutMs = options.callTimeoutMs ?? 180000;
        this.recoveryWindowMs = options.recoveryWindowMs ?? 600000;
        // QA-02: tras un timeout local de un cobro/devolución la DLL puede seguir esperando la tarjeta:
        // el servicio sigue "ocupado" hasta que llegue su retorno tardío o pase esta ventana.
        this.orphanMs = options.orphanMs ?? 300000;
        this._orphan = null; // { until:number } mientras una llamada de cobro agotada pueda seguir viva
        // QA-22: exclusión entre pestañas. `locks` = API compatible con navigator.locks (request/ifAvailable).
        // Sin ella (navegador antiguo, tests) se degrada al guardián del propio datáfono (-3).
        this.locks = options.locks || null;
        this.preflight = options.preflight ?? false;
        this.logger = options.logger || null;
        this.config = null;
        this.transport = null;
        this.state = STATES.UNINITIALIZED;
        this._initPromise = null;
        this._initialized = false; // sesión válida con la librería (independiente de la fase `state`)
        this._lastInitFailure = null; // { at:number, result }
        this._lastStatus = -1;
        this._listeners = {};
        this._subscribed = new WeakSet();
    }

    // ------------------------------------------------------------------ config

    configure({ merchant, terminal, signKey, port, version, transport }) {
        if (this.isBusy()) {
            throw new Error("RedsysService.configure no se puede llamar con una operación en curso");
        }
        this.config = { merchant, terminal, signKey, port, version };
        this.transport = transport || null;
        this._initialized = false;
        this._setState(STATES.UNINITIALIZED);
        this._lastInitFailure = null;
        this._subscribeEvents();
        return this;
    }

    /** Evita que la clave aparezca en console.log/JSON.stringify del servicio. */
    toJSON() {
        return { state: this.state, merchant: this.config?.merchant, terminal: this.config?.terminal };
    }

    on(event, cb) {
        (this._listeners[event] ||= new Set()).add(cb);
        return () => this._listeners[event].delete(cb);
    }

    _emit(event, payload) {
        for (const cb of this._listeners[event] || []) {
            try {
                cb(payload);
            } catch (e) {
                this._log("listener_error", { event });
            }
        }
    }

    _subscribeEvents() {
        const t = this.transport;
        if (!t || typeof t.subscribeEvent !== "function" || this._subscribed.has(t)) {
            return;
        }
        this._subscribed.add(t);
        for (const [n, name] of Object.entries(EVENTS)) {
            t.subscribeEvent(`pinpadImplantadoEvent_${n}`, (payload) => this._emit(name, payload));
        }
    }

    _log(msg, data) {
        if (this.logger) {
            try {
                this.logger(msg, data);
            } catch {
                // el logger nunca debe romper una operación
            }
        }
    }

    _setState(state) {
        if (this.state !== state) {
            this.state = state;
            this._emit("state", state);
        }
    }

    isBusy() {
        return (
            this.state === STATES.INITIALIZING ||
            this.state === STATES.PAYING ||
            this.state === STATES.REFUNDING ||
            this.state === STATES.RECOVERING ||
            this._orphanActive()
        );
    }

    /** QA-02: una llamada de cobro agotada por el temporizador local puede seguir viva en el datáfono. */
    _orphanActive() {
        if (!this._orphan) {
            return false;
        }
        if (this.now().getTime() >= this._orphan.until) {
            this._orphan = null;
            return false;
        }
        return true;
    }

    /** QA-22: toma el cerrojo del comercio/terminal sin esperar. @returns {Promise<null|(()=>void)>} null = otra pestaña lo tiene */
    async _acquireLock() {
        const locks = this.locks;
        if (!locks || typeof locks.request !== "function") {
            return () => {};
        }
        const name = `redsys-${this.config?.merchant}-${this.config?.terminal}`;
        try {
            return await new Promise((resolve, reject) => {
                locks
                    .request(name, { ifAvailable: true }, (lock) => {
                        if (!lock) {
                            resolve(null);
                            return undefined;
                        }
                        return new Promise((release) => resolve(() => release()));
                    })
                    .catch(reject);
            });
        } catch {
            return () => {}; // degradación segura: sin Web Locks se confía en el guardián del datáfono
        }
    }

    _lockedResult(ctx) {
        return this._error(ctx, CODE_BUSY, {
            userMessage:
                "Otra ventana o pestaña del POS está usando el datáfono. Espere a que termine antes de iniciar otra operación.",
        });
    }

    isReady() {
        return this.state === STATES.READY;
    }

    // --------------------------------------------------------------- transporte

    /** Llama a execFnDll y normaliza: nunca lanza ni se queda colgado más de callTimeoutMs. */
    _exec(command, args) {
        return new Promise((resolve) => {
            let done = false;
            let timedOut = false;
            let timer = null;
            const track = command === FN_PAY || command === FN_REFUND;
            const finish = (ret) => {
                if (done) {
                    if (timedOut && track) {
                        this._orphan = null; // retorno tardío de la DLL: ya no hay nada vivo
                    }
                    return;
                }
                done = true;
                if (timer) {
                    clearTimeout(timer);
                }
                resolve(ret);
            };
            if (this.callTimeoutMs > 0) {
                timer = setTimeout(() => {
                    timedOut = true;
                    if (track) {
                        this._orphan = { until: this.now().getTime() + this.orphanMs };
                    }
                    finish({ Response: RET_TRANSPORT_ERROR, Result: null, timedOut: true });
                }, this.callTimeoutMs);
            }
            try {
                this.transport.execFnDll(command, args, (ret) => finish(this._normalizeRet(ret)));
            } catch {
                finish({ Response: RET_TRANSPORT_ERROR, Result: null });
            }
        });
    }

    _initCall(args) {
        return new Promise((resolve) => {
            let done = false;
            const finish = (ret) => {
                if (!done) {
                    done = true;
                    resolve(ret);
                }
            };
            try {
                this.transport.initFnDll(args, (ret) => finish(this._normalizeRet(ret)));
            } catch {
                finish({ Response: RET_TRANSPORT_ERROR, Result: null });
            }
        });
    }

    _normalizeRet(ret) {
        const response = Number(ret && ret.Response);
        return {
            Response: Number.isFinite(response) ? response : RET_TRANSPORT_ERROR,
            Result: ret && typeof ret.Result === "string" ? ret.Result : null,
        };
    }

    // -------------------------------------------------------------------- init

    /**
     * Idempotente. Un único reintento con backoff ante -1/-99. -40 no se reintenta.
     * Tras un fallo definitivo, otra secuencia de init exige `initCooldownMs`
     * (protege la cuenta del servicio frente a bloqueos por reintentos).
     * @returns {Promise<{ok:boolean, code:number|string, message:string}>}
     */
    async init() {
        if (!this.transport || !this.config) {
            return { ok: false, code: CODE_NOT_INITIALIZED, message: "RedsysService sin configurar." };
        }
        if (this._initPromise) {
            return this._initPromise;
        }
        if (this._initialized && !this.isBusy()) {
            return { ok: true, code: 0, message: "Datáfono listo." };
        }
        if (this.isBusy()) {
            return { ok: false, code: CODE_BUSY, message: SERVICE_MESSAGES[CODE_BUSY] };
        }
        this._setState(STATES.INITIALIZING);
        this._initPromise = this._runInit()
            .then((result) => {
                this._setState(result.ok ? STATES.READY : STATES.FAILED);
                return result;
            })
            .finally(() => {
                this._initPromise = null;
            });
        return this._initPromise;
    }

    /** Secuencia de init (hasta 2 llamadas). No toca `state`; sí `_initialized`. */
    async _runInit() {
        const fail = this._lastInitFailure;
        if (fail && this.now().getTime() - fail.at < this.initCooldownMs) {
            return { ...fail.result, cooldown: true };
        }
        const { merchant, terminal, signKey, port, version } = this.config;
        // cConfPuerto y cVersion son opcionales pero deben darse juntos (§4.1).
        const args = port && version ? [merchant, terminal, signKey, port, version] : [merchant, terminal, signKey];
        let attempts = 0;
        let ret;
        for (;;) {
            attempts += 1;
            this._log("init", { attempt: attempts });
            ret = await this._initCall(args);
            const retryable = ret.Response === -1 || ret.Response === RET_SERVICE_REINIT;
            if (ret.Response === 0 || !retryable || attempts >= 2) {
                break;
            }
            await this.sleep(this.initBackoffMs);
        }
        if (ret.Response === 0) {
            this._lastInitFailure = null;
            this._initialized = true;
            return { ok: true, code: 0, message: "Datáfono listo." };
        }
        this._initialized = false;
        const result = {
            ok: false,
            code: ret.Response,
            message: describeReturn(FN_INIT, ret.Response),
        };
        if (ret.Response === RET_LIB_EXPIRED) {
            result.errorCode = CODE_LIB_EXPIRED;
        }
        this._lastInitFailure = { at: this.now().getTime(), result };
        return result;
    }

    // ------------------------------------------------------------- checkStatus

    /** @returns {Promise<{code:0|-1|-2|-3, busy?:boolean}>} */
    async checkStatus() {
        if (this.isBusy()) {
            // No se interrumpe una operación en curso; se devuelve el último valor conocido.
            return { code: this._lastStatus, busy: true };
        }
        if (!this.transport || !this._initialized) {
            return { code: -1 };
        }
        this._setState(STATES.RECOVERING); // ocupado mientras dura la llamada
        let code;
        try {
            const ret = await this._exec(FN_STATUS, []);
            code = ret.Response;
            if (code === RET_SERVICE_REINIT) {
                code = -1;
            } else if (![0, -1, -2, -3].includes(code)) {
                code = -2;
            }
            if (code === -1) {
                this._initialized = false;
            }
        } finally {
            this._endOperation();
        }
        this._lastStatus = code;
        return { code };
    }

    // --------------------------------------------------------------------- pay

    /**
     * @param {{amount:number|string, reference:string}} p
     * @returns {Promise<Object>} PayResult
     */
    async pay({ amount, reference } = {}) {
        const ctx = { reference, type: "PAGO" };
        const amountStr = formatAmount(amount);
        if (!amountStr || !REFERENCE_RE.test(reference || "")) {
            return this._error(ctx, CODE_INVALID_PARAMS);
        }
        if (this.isBusy()) {
            return this._error(ctx, CODE_BUSY);
        }
        if (!this.transport || !this.config) {
            return this._error(ctx, CODE_NOT_INITIALIZED);
        }
        this._setState(STATES.PAYING);
        let release = null;
        try {
            release = await this._acquireLock();
            if (!release) {
                return this._lockedResult(ctx);
            }
            const notReady = await this._ensureReady(ctx);
            if (notReady) {
                return notReady;
            }
            if (this.preflight) {
                const st = await this._exec(FN_STATUS, []);
                if (st.Response === -2 || st.Response === -3) {
                    // Comprobado ANTES de cobrar: seguro, no se ha tocado la tarjeta.
                    return this._error(ctx, CODE_NOT_CHARGED, {
                        retryable: true,
                        userMessage:
                            st.Response === -2
                                ? "El datáfono no responde. Compruebe que está encendido y conectado; no se ha cobrado nada."
                                : "Sin conexión con Redsys. Compruebe Internet; no se ha cobrado nada.",
                    });
                }
            }
            return await this._operate(ctx, FN_PAY, (ref) => [amountStr, ref, "PAGO"], amountStr);
        } finally {
            if (release) {
                release();
            }
            this._endOperation();
        }
    }

    // ------------------------------------------------------------------ refund

    /**
     * @param {{pedido:string, rts:string, amount:number|string, reference:string}} p
     * @returns {Promise<Object>} PayResult de la devolución
     */
    async refund({ pedido, rts, amount, reference } = {}) {
        const ctx = { reference, type: "DEVOLUCION" };
        const amountStr = formatAmount(amount);
        if (!amountStr || !pedido || !REFERENCE_RE.test(reference || "")) {
            return this._error(ctx, CODE_INVALID_PARAMS);
        }
        if (this.isBusy()) {
            return this._error(ctx, CODE_BUSY);
        }
        if (!this.transport || !this.config) {
            return this._error(ctx, CODE_NOT_INITIALIZED);
        }
        this._setState(STATES.REFUNDING);
        let release = null;
        try {
            release = await this._acquireLock();
            if (!release) {
                return this._lockedResult(ctx);
            }
            const notReady = await this._ensureReady(ctx);
            if (notReady) {
                return notReady;
            }
            return await this._operate(
                ctx,
                FN_REFUND,
                (ref) => [String(pedido), nz(rts), amountStr, ref, "DEVOLUCION"],
                amountStr
            );
        } finally {
            if (release) {
                release();
            }
            this._endOperation();
        }
    }

    /**
     * Ejecuta pago/devolución con la política de errores:
     *  -1  => no se ejecutó: reinit (ya limitado) y UN solo reintento de la operación.
     *  -99 => la sesión se perdió, pudo cobrarse: reinit + consulta, nunca reintento ciego.
     *  -2 / fallo de transporte / XML ilegible => consulta (recuperación).
     */
    async _operate(ctx, fn, buildArgs, amountStr) {
        const t0 = this.now(); // ANTES de la operación (§4.5)
        ctx.amountStr = amountStr;
        let retried = false;
        for (;;) {
            this._log("op_call", { fn, reference: ctx.reference });
            const ret = await this._exec(fn, buildArgs(ctx.reference));
            if (ret.Response === -1 && !retried) {
                retried = true;
                this._initialized = false;
                const notReady = await this._ensureReady(ctx);
                if (notReady) {
                    return notReady;
                }
                continue;
            }
            if (ret.Response === RET_SERVICE_REINIT) {
                this._initialized = false;
                await this._ensureReady(ctx); // si falla, _recover no podrá consultar => unknown
                return this._recover(ctx, t0);
            }
            return this._handleResponse(ctx, fn, ret, t0, amountStr);
        }
    }

    async _handleResponse(ctx, fn, ret, t0, amountStr) {
        const code = ret.Response;
        if (code === 0) {
            const parsed = parsePayXml(ret.Result);
            if (parsed.kind === "operation") {
                if (parsed.authorized) {
                    return this._authorized(ctx, parsed, ret.Result, amountStr);
                }
                const resultado = (parsed.resultado || "").toLowerCase();
                const estado = (parsed.estado || "").toUpperCase();
                if (estado === "G" || resultado.includes("deneg") || resultado.includes("rechaz")) {
                    return this._denied(ctx, parsed, ret.Result);
                }
                if (estado === "T") {
                    return this._error(ctx, "TECHNICAL_FAILURE", {
                        retryable: true,
                        rawXml: ret.Result,
                        userMessage: "Fallo técnico en la operación. No se ha realizado; puede reintentarla.",
                    });
                }
                return this._recover(ctx, t0); // estado P u otro: indeterminado
            }
            if (parsed.kind === "error") {
                const tcode = parsed.error.codigo;
                if (needsRecoveryQuery(tcode)) {
                    return this._recover(ctx, t0);
                }
                return this._error(ctx, tcode || CODE_BAD_RESPONSE, {
                    rawXml: ret.Result,
                    userMessage: describeTpvpc(tcode) || parsed.error.mensaje || SERVICE_MESSAGES[CODE_BAD_RESPONSE],
                });
            }
            return this._recover(ctx, t0); // retorno 0 pero XML ilegible: la DLL terminó, pudo haberse cobrado
        }
        if (code === -2) {
            // -2 de la DLL (su propio timeout): resultado desconocido, pero la DLL ha terminado.
            return this._recover(ctx, t0);
        }
        if (code === RET_TRANSPORT_ERROR) {
            // QA-02: sin respuesta de la DLL (timeout local, excepción, fetch fallido): NO es evidencia de
            // "no cobrado"; la DLL puede seguir esperando tarjeta/PIN. Solo se acepta lo que la consulta encuentre.
            return this._recover(ctx, t0, { strict: true });
        }
        if (code === RET_LIB_EXPIRED) {
            return this._error(ctx, CODE_LIB_EXPIRED);
        }
        if (code === -1) {
            this._initialized = false;
            return this._error(ctx, CODE_NOT_INITIALIZED, { retryable: true, userMessage: describeReturn(fn, -1) });
        }
        return this._error(ctx, code, { retryable: code === -3, userMessage: describeReturn(fn, code) });
    }

    /**
     * Recuperación tras resultado desconocido: consulta +-10 min por `reference`.
     * encontrada autorizada => authorized; no encontrada => error reintentable;
     * la consulta falla => unknown (jamás reintento ciego).
     */
    async _recover(ctx, t0, { strict = false } = {}) {
        this._setState(STATES.RECOVERING);
        if (!this._initialized) {
            return this._unknown(ctx, "No se pudo reinicializar el datáfono para verificar la operación.");
        }
        const win = this.recoveryWindowMs;
        const t1 = this.now();
        const q = await this._query({
            reference: ctx.reference,
            from: new Date(t0.getTime() - win),
            to: new Date(Math.max(t0.getTime(), t1.getTime()) + win),
            type: ctx.type,
        });
        if (q.error) {
            return this._unknown(ctx, q.error.message);
        }
        const verb = ctx.type === "DEVOLUCION" ? "devolución" : "cobro";
        const authorized = q.operations.filter((op) => isAuthorized(op));
        if (authorized.length) {
            const op = authorized[0];
            const result = {
                status: "authorized",
                pedido: op.pedido,
                rts: op.rts,
                reference: ctx.reference,
                authCode: op.codigoRespuesta,
                cardBrand: null, // la consulta no devuelve la marca
                maskedPan: op.maskedPan,
                last4: op.last4,
                date: op.fecha,
                rawXml: op.rawXml || null, // XML de la operación según la consulta (el servidor lo valida)
                recovered: true,
                userMessage: `La ${verb} se había realizado correctamente (recuperada por consulta).`,
            };
            if (authorized.length > 1) {
                result.warning = "MULTIPLE_AUTHORIZED";
            } else if (ctx.amountStr && !this._sameAmount(op.importe, ctx.amountStr)) {
                // QA-04: misma referencia pero otro importe (p. ej. reintento tras editar la línea).
                result.warning = "AMOUNT_MISMATCH";
            }
            return result;
        }
        const pending = q.operations.find((op) => (op.estado || "").toUpperCase() === "P");
        if (pending) {
            return this._unknown(ctx, `La ${verb} figura en proceso en Redsys.`);
        }
        const denied = q.operations.find(
            (op) => (op.resultado || "").toLowerCase().includes("deneg") || (op.estado || "").toUpperCase() === "G"
        );
        if (denied) {
            return this._denied(ctx, denied, null, true);
        }
        if (strict) {
            return this._unknown(
                ctx,
                `Redsys no muestra todavía la ${verb}, pero el datáfono pudo no haber terminado. No la repita: ` +
                    "espere unos minutos y verifique la referencia."
            );
        }
        return this._error(ctx, CODE_NOT_CHARGED, {
            retryable: true,
            userMessage: `La ${verb} no se realizó. Puede reintentarla.`,
        });
    }

    /** Compara el importe de una operación consultada con el pedido ("12.34"); ilegible => distinto. */
    _sameAmount(opImporte, amountStr) {
        if (opImporte === undefined || opImporte === null || opImporte === "") {
            return true; // la consulta no lo informa: no hay nada que cotejar
        }
        const n = Number(String(opImporte).replace(",", "."));
        return Number.isFinite(n) && Math.abs(n - Number(amountStr)) <= 0.001;
    }

    // ------------------------------------------------------------------- query

    /**
     * Consulta pública de operaciones. No se ejecuta durante otra operación.
     * @returns {Promise<{found:boolean, operations:Array, error?:Object}>}
     */
    async query({ reference, from, to, type } = {}) {
        if (this.isBusy()) {
            return { found: false, operations: [], error: { code: CODE_BUSY, message: SERVICE_MESSAGES[CODE_BUSY] } };
        }
        if (!this.transport || !this._initialized) {
            return {
                found: false,
                operations: [],
                error: { code: CODE_NOT_INITIALIZED, message: SERVICE_MESSAGES[CODE_NOT_INITIALIZED] },
            };
        }
        this._setState(STATES.RECOVERING);
        let release = null;
        try {
            release = await this._acquireLock();
            if (!release) {
                return {
                    found: false,
                    operations: [],
                    error: { code: CODE_BUSY, message: this._lockedResult({}).userMessage },
                };
            }
            return await this._query({ reference, from, to, type });
        } finally {
            if (release) {
                release();
            }
            this._endOperation();
        }
    }

    /** Consulta interna (sin comprobar busy). Recorre hasta MAX_QUERY_PAGES páginas. */
    async _query({ reference, from, to, type }) {
        const fromStr = typeof from === "string" ? from : formatRedsysDate(from);
        const toStr = typeof to === "string" ? to : formatRedsysDate(to);
        const operations = [];
        let page = 0;
        let blank = null; // [SUPUESTO-HW] S4: algunos servicios exigen "" en lugar de null
        for (;;) {
            this._log("query_call", { reference, page });
            const ret = await this._exec(FN_QUERY, [
                blank, // cNumPedido
                blank, // cRTS
                reference ?? blank, // cFactura
                fromStr,
                toStr,
                type || blank,
                blank, // cResultado
                String(page),
            ]);
            if (ret.Response === -3 && blank === null) {
                blank = ""; // un único reintento con cadenas vacías
                continue;
            }
            if (ret.Response === -1 || ret.Response === RET_SERVICE_REINIT) {
                this._initialized = false;
            }
            if (ret.Response !== 0) {
                return {
                    found: false,
                    operations,
                    error: { code: ret.Response, message: describeReturn(FN_QUERY, ret.Response) },
                };
            }
            const parsed = parseQueryXml(ret.Result);
            if (parsed.error) {
                const c = parsed.error.codigo;
                return {
                    found: false,
                    operations,
                    error: { code: c, message: describeTpvpc(c) || parsed.error.mensaje || "Error en la consulta." },
                };
            }
            // La consulta puede ignorar el filtro de factura: se vuelve a filtrar aquí.
            for (const op of parsed.operations) {
                if (!reference || op.factura === reference) {
                    operations.push(op);
                }
            }
            page += 1;
            if (page >= parsed.totalPages || page >= MAX_QUERY_PAGES) {
                break;
            }
        }
        return { found: operations.length > 0, operations };
    }

    // -------------------------------------------------------------------- stop

    async stop() {
        if (this.isBusy()) {
            return { ok: false, code: CODE_BUSY, message: SERVICE_MESSAGES[CODE_BUSY] };
        }
        if (this.transport && this._initialized) {
            this._setState(STATES.RECOVERING);
            try {
                await this._exec(FN_STOP, []);
            } finally {
                this._initialized = false;
                this._setState(STATES.UNINITIALIZED);
            }
        }
        this._lastInitFailure = null;
        return { ok: true };
    }

    // ---------------------------------------------------------------- internals

    _endOperation() {
        if (this.state === STATES.PAYING || this.state === STATES.REFUNDING || this.state === STATES.RECOVERING) {
            this._setState(this._initialized ? STATES.READY : STATES.UNINITIALIZED);
        }
    }

    /**
     * Garantiza sesión inicializada dentro de una operación. Devuelve un
     * resultado de error (nada se ha cobrado) o null si todo listo. Respeta
     * el único reintento y el enfriamiento de _runInit: nunca bucle.
     */
    async _ensureReady(ctx) {
        if (this._initialized) {
            return null;
        }
        const r = await this._runInit();
        if (r.ok) {
            return null;
        }
        return this._error(ctx, r.errorCode || r.code, {
            retryable: true,
            userMessage: r.message,
        });
    }

    _authorized(ctx, parsed, rawXml, amountStr) {
        const result = {
            status: "authorized",
            pedido: parsed.pedido,
            rts: parsed.rts,
            reference: ctx.reference,
            authCode: parsed.codigoRespuesta,
            cardBrand: parsed.cardBrand,
            maskedPan: parsed.maskedPan,
            last4: parsed.last4,
            date: parsed.fecha,
            rawXml,
            userMessage: ctx.type === "DEVOLUCION" ? "Devolución autorizada." : "Cobro autorizado.",
        };
        if (parsed.importe && Math.abs(Number(parsed.importe) - Number(amountStr)) > 0.001) {
            result.warning = "AMOUNT_MISMATCH";
        }
        return result;
    }

    _denied(ctx, parsed, rawXml, recovered = false) {
        const detail = parsed.codigoRespuesta ? ` (código ${parsed.codigoRespuesta})` : "";
        return {
            status: "denied",
            pedido: parsed.pedido ?? null,
            rts: parsed.rts ?? null,
            reference: ctx.reference,
            authCode: null,
            cardBrand: parsed.cardBrand ?? null,
            maskedPan: parsed.maskedPan ?? null,
            date: parsed.fecha ?? null,
            rawXml,
            errorCode: parsed.codigoRespuesta || "DENIED",
            recovered,
            userMessage: `Operación denegada${detail}. No se ha cobrado nada.`,
        };
    }

    _unknown(ctx, detail) {
        return {
            ...this._error(ctx, CODE_UNKNOWN_RESULT),
            status: "unknown",
            detail,
        };
    }

    _error(ctx, code, extra = {}) {
        return {
            status: "error",
            pedido: null,
            rts: null,
            reference: ctx.reference ?? null,
            authCode: null,
            cardBrand: null,
            maskedPan: null,
            date: null,
            rawXml: null,
            errorCode: code,
            userMessage: SERVICE_MESSAGES[code] || (typeof code === "number" ? describeReturn(FN_PAY, code) : String(code)),
            ...extra,
        };
    }
}
