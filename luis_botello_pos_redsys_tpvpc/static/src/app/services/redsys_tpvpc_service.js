/** @odoo-module */
// Servicio OWL `redsys_tpvpc`: crea (perezosamente) un RedsysService por método
// de pago Redsys, con el transporte que dicte su configuración (js/http, o mock
// SOLO con redsys_simulation + flag de URL, SIM6). La clave de firma se pide con
// el RPC redsys_get_signature_key(config_id) y vive solo en memoria (D7).
// También gestiona: recuperación de líneas a medias, bloqueo de segundos cobros
// y el indicador periódico de checkStatus.

import { reactive } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { loadJS } from "@web/core/assets";
import { createRedsysEntry } from "../utils/redsys_factory.js";
import {
    POLL_INTERVAL_MS,
    RECOVERY_GRACE_MS,
    interpretQuery,
    makeStartMarks,
    isRedsysMethod,
    needsRecovery,
    recoveryWindow,
    statusFromCode,
    unresolvedLines,
} from "../utils/redsys_pos_logic.js";

export const TPVPC_LIB_URL = "/luis_botello_pos_redsys_tpvpc/static/lib/tpvpc/tpvpc-impl.js";

/**
 * Carga opcional de tpvpc-impl.js (static/lib, fuera del bundle de assets).
 * [SUPUESTO-HW] S4: no se conoce la forma real del fichero; se prueba como
 * módulo ESM y, si no expone la clase, como script clásico (globales).
 * Si el fichero no existe se lanza error y RealJsTransport responde -98.
 */
export async function loadTpvpcLibrary(url = TPVPC_LIB_URL) {
    try {
        const mod = await import(/* webpackIgnore: true */ url);
        const holder = mod && mod.default && mod.default.TpvpcImplantado ? mod.default : mod;
        if (holder && (typeof holder.TpvpcImplantado === "function" || typeof holder.initFnDll === "function")) {
            return holder;
        }
    } catch {
        // no es ESM válido o no existe: se prueba como script clásico
    }
    await loadJS(url);
    return null; // el transporte buscará window.tpvpcImpl / Tpvpc.TpvpcImplantado
}

export const redsysTpvpcService = {
    dependencies: ["pos", "orm"],
    start(env, { pos, orm }) {
        const entries = new Map(); // method.id -> entry
        const entryPromises = new Map();
        let keysPromise = null; // {method_id: clave}; SOLO memoria
        let pollTimer = null;
        const recovering = new Map(); // line.uuid -> Promise
        const activeLines = new Set(); // líneas con un cobro EN CURSO en esta pestaña (QA-15)
        const retryTimers = new Map(); // line.uuid -> {timer, n}: reconsultas durante la gracia (QA-01)
        const config = { graceMs: RECOVERY_GRACE_MS, maxRetries: 8 };
        let blockCount = 0; // QA-14: bloqueos solapados de paymentTerminalInProgress
        let blockSaved = false;
        const marks = makeStartMarks(
            (() => {
                try {
                    return window.localStorage || null;
                } catch {
                    return null;
                }
            })()
        );
        const state = reactive({ statuses: {}, recoveringCount: 0 });

        const alert = (title, body) => pos.dialog.add(AlertDialog, { title, body });

        function redsysMethods() {
            return (pos.config.payment_method_ids || []).filter(isRedsysMethod);
        }

        function setStatus(method, info) {
            state.statuses[method.id] = { ...info, at: Date.now() };
        }

        async function fetchKeys() {
            if (!keysPromise) {
                keysPromise = orm.call("pos.payment.method", "redsys_get_signature_key", [pos.config.id]);
                keysPromise.catch(() => {
                    keysPromise = null; // permitir reintento
                });
            }
            return keysPromise;
        }

        /** Entrada {redsys, transport, kind, destroy} del método, creándola si hace falta. */
        async function getEntry(method) {
            if (entries.has(method.id)) {
                return { entry: entries.get(method.id) };
            }
            if (!entryPromises.has(method.id)) {
                entryPromises.set(
                    method.id,
                    (async () => {
                        let keys;
                        try {
                            keys = await fetchKeys();
                        } catch {
                            return { error: "No se pudo obtener la clave de firma de Redsys del servidor." };
                        }
                        const made = createRedsysEntry({
                            method,
                            signKey: keys && keys[method.id],
                            search: (window.location.search || "") + (window.location.hash || ""),
                            loader: loadTpvpcLibrary,
                            document: window.document,
                        });
                        if (made.error) {
                            return { error: made.error };
                        }
                        entries.set(method.id, made);
                        return { entry: made };
                    })().finally(() => entryPromises.delete(method.id))
                );
            }
            return entryPromises.get(method.id);
        }

        /** @returns {Promise<{ok:boolean, message?:string, entry?:Object}>} */
        async function ensureReady(method) {
            const got = await getEntry(method);
            if (got.error) {
                setStatus(method, { level: "error", text: got.error });
                return { ok: false, message: got.error };
            }
            const r = await got.entry.redsys.init();
            if (!r.ok) {
                setStatus(method, { level: "error", text: r.message });
                return { ok: false, message: r.message, entry: got.entry };
            }
            if (!state.statuses[method.id] || state.statuses[method.id].level !== "ok") {
                setStatus(method, statusFromCode(0));
            }
            return { ok: true, entry: got.entry };
        }

        async function checkNow(method, { reinit = false } = {}) {
            const entry = entries.get(method.id);
            if (!entry) {
                if (reinit) {
                    await ensureReady(method);
                }
                return;
            }
            const redsys = entry.redsys;
            if (redsys.isBusy() || pos.paymentTerminalInProgress) {
                return; // nunca durante un cobro
            }
            if (reinit && !redsys.isReady()) {
                await ensureReady(method);
            }
            const r = await redsys.checkStatus();
            setStatus(method, statusFromCode(r.code, { busy: !!r.busy, initialized: redsys.isReady() }));
        }

        function startPolling() {
            if (pollTimer || !redsysMethods().length) {
                return;
            }
            pollTimer = setInterval(() => {
                for (const method of redsysMethods()) {
                    checkNow(method).catch(() => {});
                }
            }, POLL_INTERVAL_MS);
        }

        // ------------------------------------------------------- recuperación

        function lineMethod(line) {
            return line.payment_method_id;
        }

        /**
         * Consulta a Redsys una línea a medias por su referencia y la resuelve.
         * Una consulta vacía NO prueba "no cobrado" (QA-01): hace falta que pase la gracia desde el inicio
         * del cobro y que el datáfono esté sano, y el paso a 'retry' lo confirma el cajero (releaseLine),
         * salvo denegación registrada por Redsys.
         * @returns {Promise<{outcome:'authorized'|'not_charged'|'unknown'|'skipped', message?:string, needsConfirmation?:boolean}>}
         */
        function recoverLine(line) {
            if (recovering.has(line.uuid)) {
                return recovering.get(line.uuid);
            }
            const p = (async () => {
                if (!needsRecovery(line)) {
                    return { outcome: "skipped" };
                }
                // QA-15: una línea con cobro en curso en esta pestaña NO es una huérfana: no se toca.
                if (activeLines.has(line.uuid)) {
                    return { outcome: "skipped", message: "Operación en curso." };
                }
                const method = lineMethod(line);
                const known = entries.get(method.id);
                if (known && known.redsys.isBusy()) {
                    return { outcome: "skipped", message: "El datáfono está ocupado." };
                }
                const reference = line.redsys_reference || line.payment_ref_no;
                const isRefund = line.getAmount() < 0;
                const ready = await ensureReady(method);
                let outcome;
                if (!ready.ok) {
                    outcome = { outcome: "unknown", message: ready.message };
                } else {
                    const redsys = ready.entry.redsys;
                    const { from, to } = recoveryWindow(line.payment_date);
                    const q = await redsys.query({
                        reference,
                        from,
                        to,
                        type: isRefund ? "DEVOLUCION" : "PAGO",
                    });
                    const opts = {
                        reference,
                        amount: line.getAmount(),
                        isRefund,
                        startedAt: marks.getOrStart(reference),
                        now: Date.now(),
                        graceMs: config.graceMs,
                    };
                    outcome = interpretQuery(q, opts);
                    if (outcome.outcome === "not_charged" && !outcome.certain) {
                        // "El datáfono ya no está procesando": checkStatus sano (QA-01).
                        let deviceFree = false;
                        try {
                            deviceFree = (await redsys.checkStatus()).code === 0;
                        } catch {
                            deviceFree = false;
                        }
                        outcome = interpretQuery(q, { ...opts, deviceFree });
                    }
                }
                return applyRecovery(line, outcome);
            })().finally(() => recovering.delete(line.uuid));
            recovering.set(line.uuid, p);
            return p;
        }

        function scheduleRetry(line, outcome) {
            const cur = retryTimers.get(line.uuid) || { timer: null, n: 0 };
            if (cur.timer) {
                clearTimeout(cur.timer);
            }
            if (cur.n >= config.maxRetries) {
                return;
            }
            cur.n += 1;
            cur.timer = setTimeout(() => {
                recoverLine(line).catch(() => {});
            }, outcome.retryInMs || 30000);
            if (cur.timer && cur.timer.unref) {
                cur.timer.unref();
            }
            retryTimers.set(line.uuid, cur);
        }

        function applyRecovery(line, outcome) {
            const reference = line.redsys_reference || line.payment_ref_no;
            if (outcome.outcome === "authorized") {
                Object.assign(line, outcome.vals);
                line.setReceiptInfo(outcome.receipt);
                line.setPaymentStatus("done");
                marks.clear(reference);
                return { outcome: "authorized", message: outcome.message };
            }
            if (outcome.outcome === "not_charged" && outcome.certain) {
                line.redsys_state = false;
                line.setPaymentStatus("retry");
                marks.clear(reference);
                return { outcome: "not_charged", message: outcome.message, certain: true };
            }
            // Resto (incluido "no consta cobro" sin confirmar): la línea queda bloqueada hasta que alguien decida.
            if (outcome.result) {
                Object.assign(line, {
                    transaction_id: outcome.result.pedido || "",
                    redsys_rts: outcome.result.rts || "",
                });
            }
            line.redsys_state = "unknown";
            line.setPaymentStatus("force_done");
            if (outcome.waiting) {
                scheduleRetry(line, outcome);
            }
            if (outcome.outcome === "not_charged") {
                return { outcome: "not_charged", message: outcome.message, needsConfirmation: true };
            }
            return { outcome: outcome.outcome, message: outcome.message };
        }

        /**
         * Tras la CONFIRMACIÓN explícita del cajero de que no hay cobro (diálogo de Forzar): libera la línea
         * para reintentar. Solo si no hay operación en curso con ella.
         */
        function releaseLine(line) {
            if (activeLines.has(line.uuid)) {
                return false;
            }
            line.redsys_state = false;
            line.setPaymentStatus("retry");
            marks.clear(line.redsys_reference || line.payment_ref_no);
            return true;
        }

        /** Resuelve todas las líneas a medias de un pedido (o de todos si no se indica). */
        async function recoverOrder(order, { silent = false } = {}) {
            const orders = order ? [order] : pos.models["pos.order"].filter((o) => !o.finalized);
            const lines = orders.flatMap((o) => o.payment_ids.filter(needsRecovery));
            if (!lines.length) {
                return [];
            }
            state.recoveringCount += lines.length;
            if (blockCount++ === 0) {
                blockSaved = pos.paymentTerminalInProgress; // QA-14: un único dueño del valor previo
            }
            pos.paymentTerminalInProgress = true; // nada de cobros hasta saber qué pasó
            const results = [];
            try {
                for (const line of lines) {
                    results.push({ line, outcome: await recoverLine(line) });
                }
            } finally {
                state.recoveringCount -= lines.length;
                if (--blockCount === 0) {
                    pos.paymentTerminalInProgress = blockSaved;
                }
            }
            if (!silent) {
                const msgs = results
                    .filter((r) => r.outcome.outcome !== "skipped")
                    .map((r) => `${r.line.redsys_reference || r.line.payment_ref_no}: ${r.outcome.message}`);
                if (msgs.length) {
                    alert("Redsys: operaciones recuperadas", msgs.join("\n"));
                }
            }
            return results;
        }

        function unresolved(order, exceptUuid = null) {
            return unresolvedLines(order.payment_ids, exceptUuid);
        }

        // ------------------------------------------------------------ arranque

        async function boot() {
            const methods = redsysMethods();
            if (!methods.length) {
                return;
            }
            for (const method of methods) {
                await ensureReady(method); // init solo al arrancar (J4)
            }
            await recoverOrder(null);
            for (const method of methods) {
                await checkNow(method);
            }
            startPolling();
        }
        setTimeout(() => boot().catch(() => {}), 0);
        window.addEventListener("beforeunload", () => {
            clearInterval(pollTimer);
        });

        return {
            state,
            redsysMethods,
            ensureReady,
            getEntry,
            checkNow,
            recoverLine,
            releaseLine,
            recoverOrder,
            config,
            markStart: (reference) => marks.set(reference),
            clearStart: (reference) => marks.clear(reference),
            beginLine: (uuid) => activeLines.add(uuid),
            endLine: (uuid) => activeLines.delete(uuid),
            isLineActive: (uuid) => activeLines.has(uuid),
            unresolved,
            isOperationActive(method) {
                const entry = entries.get(method.id);
                return !!entry && entry.redsys.isBusy();
            },
            alert,
        };
    },
};

registry.category("services").add("redsys_tpvpc", redsysTpvpcService);
