/** @odoo-module */
// Lógica PURA de la integración POS (sin Odoo, sin OWL): decide qué datos se
// escriben en la línea de pago según el resultado de RedsysService, qué
// devoluciones se ofrecen, textos del recibo y estado del indicador.
// Se prueba con `node --test tests_js/pos/`.

export const REDSYS_METHOD = "redsys_tpvpc";
export const POLL_INTERVAL_MS = 45000; // 30-60 s (plan Fase 4)
export const RECOVERY_WINDOW_MS = 10 * 60 * 1000;
/**
 * QA-01: tras una recarga, una consulta vacía NO prueba "no cobrado" mientras el datáfono pueda seguir
 * esperando tarjeta/PIN. No se concluye antes de esta gracia desde el inicio del cobro (>= timeout de la DLL, ~40 s).
 */
export const RECOVERY_GRACE_MS = 2 * 60 * 1000;

/** Estados de pos.payment.payment_status que indican operación a medias. */
export const IN_FLIGHT_STATUSES = ["waiting", "waitingCard", "waitingCancel"];

const money = (n) => Math.round(Number(n) * 100);

/** ¿La línea (o su método) es Redsys TPV-PC? */
export function isRedsysMethod(method) {
    return !!method && method.use_payment_terminal === REDSYS_METHOD;
}

// ---------------------------------------------------------------- resultado

function cardVals(result) {
    const vals = {};
    if (result.cardBrand) {
        vals.card_brand = result.cardBrand;
        vals.card_type = result.cardBrand;
    }
    if (result.last4) {
        vals.card_no = result.last4;
    }
    if (result.authCode) {
        vals.payment_method_authcode = result.authCode;
    }
    return vals;
}

/** Valores a escribir en la línea cuando Redsys ha autorizado (cobro o devolución). */
export function authorizedVals(result, { isRefund = false, originalPedido = null } = {}) {
    return {
        ...(isRefund && originalPedido ? { redsys_original_pedido: String(originalPedido) } : {}),
        transaction_id: result.pedido || "",
        payment_ref_no: result.reference || "",
        redsys_reference: result.reference || "",
        redsys_rts: result.rts || "",
        redsys_xml: result.rawXml || "",
        redsys_state: isRefund ? "refund" : "authorized",
        ...cardVals(result),
    };
}

/** Texto para el ticket (línea.setReceiptInfo): marca, últimos 4, autorización, pedido, fecha. */
export function receiptText(result, { isRefund = false } = {}) {
    const rows = [];
    rows.push(isRefund ? "DEVOLUCION TARJETA" : "PAGO TARJETA");
    const brand = result.cardBrand || "Tarjeta";
    rows.push(result.last4 ? `${brand} ****${result.last4}` : brand);
    if (result.authCode) {
        rows.push(`Autorizacion: ${result.authCode}`);
    }
    if (result.pedido) {
        rows.push(`Pedido: ${result.pedido}`);
    }
    if (result.date) {
        rows.push(`Fecha: ${result.date}`); // formato de Redsys sin normalizar (S7 pendiente)
    }
    return rows.join("\n") + "\n";
}

/**
 * Traduce un PayResult de RedsysService a la decisión del POS.
 * outcome: 'done' (return true) | 'retry' (return false) | 'unknown' (false + force_done manual)
 */
export function interpretPayResult(result, { isRefund = false, originalPedido = null } = {}) {
    const r = result || {};
    const reference = r.reference || null;
    if (r.status === "authorized" && !r.warning) {
        return {
            outcome: "done",
            vals: authorizedVals(r, { isRefund, originalPedido }),
            receipt: receiptText(r, { isRefund }),
            message: r.userMessage || null,
            notify: r.recovered ? r.userMessage : null,
        };
    }
    if (r.status === "authorized") {
        // Importe distinto o varias autorizadas: no se da por buena sin revisión humana.
        return {
            outcome: "unknown",
            vals: { ...authorizedVals(r, { isRefund, originalPedido }), redsys_state: "unknown" },
            receipt: null,
            message:
                r.warning === "AMOUNT_MISMATCH"
                    ? "Redsys ha autorizado un importe distinto del solicitado. Revise la operación en el portal de Redsys antes de continuar."
                    : "Redsys muestra varias operaciones autorizadas con la misma referencia. Revise el portal de Redsys antes de continuar.",
        };
    }
    if (r.status === "unknown") {
        return {
            outcome: "unknown",
            vals: {
                redsys_state: "unknown",
                redsys_reference: reference,
                payment_ref_no: reference,
                ...(isRefund && originalPedido ? { redsys_original_pedido: String(originalPedido) } : {}),
            },
            receipt: null,
            message:
                "No se ha podido confirmar el resultado del cobro. NO repita el cobro: " +
                "puede haberse realizado. Verifique la operación (referencia " +
                `${reference || "?"}) en el portal de Redsys o espere la consulta automática.`,
        };
    }
    // denied / error: nada cobrado, se puede reintentar
    return {
        outcome: "retry",
        vals: {},
        receipt: null,
        message: r.userMessage || "No se ha podido completar la operación.",
        errorCode: r.errorCode || null,
    };
}

/**
 * Interpreta la respuesta de `query` para una línea a medias.
 * @returns {{outcome:'authorized'|'not_charged'|'unknown', vals?:Object, message:string, result?:Object}}
 */
export function interpretQuery(
    queryResult,
    { reference, amount, isRefund = false, startedAt = null, now = Date.now(), graceMs = RECOVERY_GRACE_MS, deviceFree = true } = {}
) {
    if (!queryResult || queryResult.error) {
        return {
            outcome: "unknown",
            message: (queryResult && queryResult.error && queryResult.error.message) || "La consulta a Redsys ha fallado.",
        };
    }
    const ops = (queryResult.operations || []).filter((o) => !reference || o.factura === reference);
    const authorized = ops.filter(
        (o) => (o.estado || "").toUpperCase() === "F" && (o.resultado || "").toLowerCase() === "autorizada"
    );
    if (authorized.length) {
        const op = authorized[0];
        const result = {
            status: "authorized",
            pedido: op.pedido,
            rts: op.rts,
            reference,
            authCode: op.codigoRespuesta,
            cardBrand: null,
            last4: op.last4,
            date: op.fecha,
            rawXml: null,
            recovered: true,
        };
        const mismatch = op.importe && amount !== undefined && money(op.importe) !== money(Math.abs(amount));
        if (authorized.length > 1 || mismatch) {
            return {
                outcome: "unknown",
                result,
                message: mismatch
                    ? "Redsys tiene la operación autorizada por un importe distinto. Revísela en el portal."
                    : "Redsys tiene varias operaciones autorizadas con esta referencia. Revíselas en el portal.",
            };
        }
        return {
            outcome: "authorized",
            result,
            vals: authorizedVals(result, { isRefund }),
            receipt: receiptText(result, { isRefund }),
            message: "La operación estaba autorizada en Redsys y se ha recuperado.",
        };
    }
    if (ops.some((o) => (o.estado || "").toUpperCase() === "P")) {
        return { outcome: "unknown", message: "La operación figura en proceso en Redsys. Vuelva a consultar en unos segundos." };
    }
    // Denegación registrada por Redsys: evidencia cierta de "no cobrado".
    if (ops.some((o) => (o.resultado || "").toLowerCase().includes("deneg") || (o.estado || "").toUpperCase() === "G")) {
        return {
            outcome: "not_charged",
            certain: true,
            message: "Redsys registra la operación como denegada: no se cobró. Puede reintentar.",
        };
    }
    // Consulta vacía: solo prueba "no cobrado" si el datáfono ya no puede seguir procesándola (QA-01).
    const elapsed = startedAt === null || startedAt === undefined ? -1 : now - Number(startedAt);
    if (elapsed < graceMs) {
        const wait = elapsed < 0 ? graceMs : graceMs - elapsed;
        return {
            outcome: "unknown",
            waiting: true,
            retryInMs: Math.max(1000, wait + 1000),
            message:
                "Redsys aún no muestra esta operación, pero el cobro pudo seguir en el datáfono. NO lo repita: " +
                "espere un par de minutos a que el datáfono quede libre; se consultará de nuevo.",
        };
    }
    if (!deviceFree) {
        return {
            outcome: "unknown",
            waiting: true,
            retryInMs: 30000,
            message:
                "Redsys no muestra la operación pero el datáfono no responde con normalidad: no se puede descartar el cobro. " +
                "Verifique en el portal de Redsys.",
        };
    }
    return {
        outcome: "not_charged",
        message:
            "Redsys no tiene ningún cobro con esta referencia tras esperar a que el datáfono quedase libre: no consta cobro.",
    };
}

// ------------------------------------------------- marca de inicio del cobro (QA-01)

/**
 * Marca (no secreta) del instante en que se envió el cobro de una referencia: permite medir la gracia
 * tras una recarga. `storage` = localStorage (si falla o no existe, solo memoria: la gracia empieza
 * entonces en la primera recuperación de esta sesión, nunca antes).
 */
export function makeStartMarks(storage = null, prefix = "redsys_start:") {
    const mem = new Map();
    const safe = (fn, fallback = null) => {
        try {
            return storage ? fn(storage) : fallback;
        } catch {
            return fallback;
        }
    };
    return {
        set(reference, ms = Date.now()) {
            if (!reference) {
                return;
            }
            mem.set(reference, ms);
            safe((st) => st.setItem(prefix + reference, String(ms)));
        },
        get(reference) {
            if (!reference) {
                return null;
            }
            if (mem.has(reference)) {
                return mem.get(reference);
            }
            const raw = safe((st) => st.getItem(prefix + reference));
            const n = raw === null || raw === undefined ? NaN : Number(raw);
            return Number.isFinite(n) ? n : null;
        },
        /** Primera vez que vemos la línea sin marca: la gracia empieza ahora. */
        getOrStart(reference, ms = Date.now()) {
            const cur = this.get(reference);
            if (cur !== null) {
                return cur;
            }
            this.set(reference, ms);
            return ms;
        },
        clear(reference) {
            mem.delete(reference);
            safe((st) => st.removeItem(prefix + reference));
        },
    };
}

// -------------------------------------------------------------- borrado (QA-23)

/**
 * ¿Se puede borrar una línea de pago Redsys desde la UI? Una línea con resultado dudoso, autorizada,
 * de devolución, forzada o con operación en curso NO se borra (se perdería el control de un cobro
 * posiblemente realizado y el cajero cobraría de nuevo).
 * @param {Object} line
 * @param {{operationActive?:boolean, inFlight?:boolean}} [ctx]
 * @returns {{ok:boolean, reason?:string}}
 */
export function canDeleteRedsysLine(line, { operationActive = false, inFlight = false } = {}) {
    if (!line || !isRedsysMethod(line.payment_method_id)) {
        return { ok: true };
    }
    const state = line.redsys_state;
    const status = line.payment_status;
    if (state === "unknown" || state === "authorized" || state === "refund") {
        return {
            ok: false,
            reason:
                "Esta línea corresponde a un cobro con el datáfono que puede haberse realizado " +
                `(referencia ${line.redsys_reference || line.payment_ref_no || "?"}). No se puede eliminar: resuélvala ` +
                "(Forzar tras verificar en el portal de Redsys) o concílíela con administración.",
        };
    }
    if (status === "force_done") {
        return {
            ok: false,
            reason: "Esta línea está pendiente de confirmación manual de un cobro con el datáfono; no se puede eliminar.",
        };
    }
    if (operationActive || inFlight || IN_FLIGHT_STATUSES.includes(status)) {
        return {
            ok: false,
            reason: "Hay una operación en curso en el datáfono para esta línea; espere a su resultado antes de eliminarla.",
        };
    }
    return { ok: true };
}

// --------------------------------------------------------------- devoluciones

/**
 * ¿Se puede devolver por Redsys esta línea original? Exige pedido y RTS (§7).
 * @returns {{ok:boolean, reason?:string}}
 */
export function canRefundRedsysLine(orig) {
    if (!orig || !isRedsysMethod(orig.payment_method_id)) {
        return { ok: false, reason: "La línea original no es un cobro Redsys." };
    }
    if (orig.redsys_state !== "authorized") {
        return { ok: false, reason: "El cobro original no figura como autorizado por Redsys." };
    }
    if (!orig.transaction_id || !orig.redsys_rts) {
        return {
            ok: false,
            reason:
                "El cobro original no tiene número de pedido o identificador RTS de Redsys, " +
                "por lo que no se puede devolver por el datáfono. Use otro método de pago o la devolución manual en el portal.",
        };
    }
    return { ok: true };
}

/**
 * Importe aún devolvible de una línea original: original menos las devoluciones
 * ya conocidas (líneas `refund` con el mismo pedido original en `knownRefunds`).
 * El servidor de Redsys impone el límite real (TPV-PC0100).
 */
export function refundableAmount(orig, knownRefunds = []) {
    const origCents = money(orig.amount || 0);
    const used = knownRefunds.reduce((sum, l) => sum + Math.abs(money(l.amount || 0)), 0);
    return Math.max(0, origCents - used) / 100;
}

/**
 * Devoluciones previas contra un cobro original: líneas `refund` (o `unknown`
 * con importe negativo, que pudieron cobrarse) cuyo `redsys_original_pedido`
 * coincide con el pedido del original y, si ambos lo indican, mismo método.
 * `payments` = todas las pos.payment cargadas (pedidos del POS).
 */
export function previousRefunds(orig, payments = []) {
    const pedido = orig && orig.transaction_id;
    if (!pedido) {
        return [];
    }
    const methodId = orig.payment_method_id && orig.payment_method_id.id;
    return payments.filter((p) => {
        if (!p || p === orig || p.redsys_original_pedido !== String(pedido)) {
            return false;
        }
        if (p.redsys_state !== "refund" && p.redsys_state !== "unknown") {
            return false;
        }
        if (!(Number(p.amount) < 0)) {
            return false;
        }
        const pm = p.payment_method_id && p.payment_method_id.id;
        return !(methodId && pm && methodId !== pm);
    });
}

/** Datos de devolución guardados en la línea de reembolso (uiState). */
export function refundInfoFromOriginal(orig) {
    return {
        pedido: orig.transaction_id || null,
        rts: orig.redsys_rts || null,
        amount: orig.amount || 0,
        paymentUuid: orig.uuid || null,
    };
}

/** Valida una devolución concreta frente a la información del original. */
export function validateRefund(info, amount, alreadyRefunded = 0) {
    if (!info || !info.pedido || !info.rts) {
        return { ok: false, reason: "Esta devolución no está enlazada a un cobro Redsys con pedido y RTS." };
    }
    if (!(Math.abs(amount) > 0)) {
        return { ok: false, reason: "El importe de la devolución debe ser distinto de cero." };
    }
    if (money(Math.abs(amount)) > money(info.amount)) {
        return { ok: false, reason: "No se puede devolver más de lo cobrado en la operación original." };
    }
    if (money(Math.abs(amount)) + Math.abs(money(alreadyRefunded)) > money(info.amount)) {
        return {
            ok: false,
            reason: "Con las devoluciones ya realizadas sobre este cobro no queda importe suficiente para devolver.",
        };
    }
    return { ok: true };
}

// ---------------------------------------------------------------- recuperación

/** ¿Hay que consultar a Redsys esta línea antes de permitir nada? */
export function needsRecovery(line) {
    if (!line || !isRedsysMethod(line.payment_method_id)) {
        return false;
    }
    const status = line.payment_status;
    const hasRef = !!(line.redsys_reference || line.payment_ref_no);
    if (!status || status === "done" || status === "reversed" || status === "pending" || !hasRef) {
        return false;
    }
    if (IN_FLIGHT_STATUSES.includes(status)) {
        return true;
    }
    return line.redsys_state === "unknown"; // force_done / retry con resultado desconocido
}

/** Líneas Redsys sin resolver que bloquean un segundo cobro. */
export function unresolvedLines(lines, exceptUuid = null) {
    return lines.filter(
        (l) =>
            l.uuid !== exceptUuid &&
            isRedsysMethod(l.payment_method_id) &&
            (l.redsys_state === "unknown" ||
                IN_FLIGHT_STATUSES.includes(l.payment_status) ||
                l.payment_status === "force_done")
    );
}

/** Ventana de consulta [desde, hasta] alrededor de la fecha de la línea. */
export function recoveryWindow(paymentDate, now = new Date()) {
    let base = null;
    if (paymentDate) {
        const d = typeof paymentDate.toJSDate === "function" ? paymentDate.toJSDate() : new Date(paymentDate);
        base = Number.isNaN(d.getTime()) ? null : d;
    }
    const start = base || new Date(now.getTime() - 24 * 3600 * 1000);
    return {
        from: new Date(Math.min(start.getTime(), now.getTime()) - RECOVERY_WINDOW_MS),
        to: new Date(now.getTime() + RECOVERY_WINDOW_MS),
    };
}

// ------------------------------------------------------------- transporte/config

/** Mock SOLO con redsys_simulation del método Y flag de URL (SIM6). */
export function chooseTransportKind({ transport, simulation, search = "", flagCheck } = {}) {
    if (simulation === true && flagCheck && flagCheck(search)) {
        return "mock";
    }
    return transport === "http" ? "http" : "js";
}

export function validateMethodConfig(method, signKey) {
    if (!method.redsys_merchant_code) {
        return "Falta el código de comercio (FUC) del método de pago Redsys.";
    }
    if (!method.redsys_terminal_number) {
        return "Falta el número de terminal del método de pago Redsys.";
    }
    if (!signKey) {
        return "No se ha podido obtener la clave de firma del método de pago Redsys (revise su configuración y permisos).";
    }
    return null;
}

// ------------------------------------------------------------------ indicador

/** Estado del indicador a partir del código de checkStatus (0, -1, -2, -3). */
export function statusFromCode(code, { busy = false, initialized = true } = {}) {
    if (busy) {
        return { level: "busy", text: "Datáfono ocupado" };
    }
    switch (code) {
        case 0:
            return { level: "ok", text: "Datáfono y Redsys correctos" };
        case -2:
            return { level: "error", text: "El datáfono no responde" };
        case -3:
            return { level: "warn", text: "Sin conexión con Redsys" };
        case -1:
            return {
                level: initialized ? "warn" : "idle",
                text: "Datáfono sin inicializar (pulse para reintentar)",
            };
        default:
            return { level: "idle", text: "Estado del datáfono desconocido" };
    }
}
