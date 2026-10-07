/** @odoo-module */
// Interfaz de pago del POS para el datáfono Verifone P400 vía Redsys TPV-PC.
// Reglas (plan §4.5/§7): nunca reintento ciego tras un resultado desconocido,
// una sola operación simultánea, devoluciones con pedido+RTS del cobro original.

import { PaymentInterface } from "@point_of_sale/app/utils/payment/payment_interface";
import { register_payment_method } from "@point_of_sale/app/services/pos_store";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { makeReference } from "../redsys/redsys_service.js";
import {
    canRefundRedsysLine,
    interpretPayResult,
    previousRefunds,
    refundInfoFromOriginal,
    unresolvedLines,
    validateRefund,
} from "../utils/redsys_pos_logic.js";

export class PaymentRedsysTpvpc extends PaymentInterface {
    setup() {
        super.setup(...arguments);
        this.supports_reversals = false; // las devoluciones se hacen en pedidos de devolución
        this._liveStatus = "waiting";
        this._inflight = new Map(); // line.uuid -> Promise de la operación en curso (QA-13)
    }

    get service() {
        return this.env.services.redsys_tpvpc;
    }

    /** Se envía al seleccionar el método (en pedidos de devolución el core ya lo evita). */
    get fastPayments() {
        return true;
    }

    _alert(title, body) {
        this.pos.dialog.add(AlertDialog, { title, body });
    }

    _getLine(uuid) {
        return this.pos.models["pos.payment"].getBy("uuid", uuid);
    }

    /** Datos de devolución de la línea: uiState y, si se perdió (recarga), buscando el original. */
    refundInfoFor(line) {
        const fromUi = line.uiState && line.uiState.redsysRefund;
        if (fromUi && fromUi.pedido) {
            return fromUi;
        }
        const order = line.pos_order_id;
        const refundedOrder = order && order.lines[0]?.refunded_orderline_id?.order_id;
        if (!refundedOrder) {
            return null;
        }
        const candidates = refundedOrder.payment_ids.filter((p) => canRefundRedsysLine(p).ok);
        // QA-24: se devuelve a la MISMA tarjeta/línea original que se eligió (pedido persistido en la línea).
        if (line.redsys_original_pedido) {
            const orig = candidates.find((p) => String(p.transaction_id) === String(line.redsys_original_pedido));
            return orig ? refundInfoFromOriginal(orig) : null;
        }
        // Sin elección persistida: solo es inequívoco si hay una única tarjeta Redsys válida.
        return candidates.length === 1 ? refundInfoFromOriginal(candidates[0]) : null;
    }

    /** Suma ya devuelta contra el mismo pedido original (excluye la propia línea). */
    _alreadyRefunded(info, line) {
        if (!info || !info.pedido) {
            return 0;
        }
        const orig = { transaction_id: info.pedido, payment_method_id: line.payment_method_id };
        const prev = previousRefunds(orig, this.pos.models["pos.payment"].getAll()).filter((p) => p !== line);
        return prev.reduce((s, p) => s + Math.abs(p.amount || 0), 0);
    }

    async sendPaymentRequest(uuid) {
        // QA-13: doble clic / reenvío mientras el cobro de ESTA línea sigue en curso: es idempotente, devuelve
        // la misma promesa y no toca el estado (si no, la línea quedaría en 'retry' con el cobro vivo).
        if (this._inflight.has(uuid)) {
            const dup = this._getLine(uuid);
            if (dup) {
                dup.setPaymentStatus(this._liveStatus);
            }
            return this._inflight.get(uuid);
        }
        const promise = this._sendPaymentRequest(uuid);
        this._inflight.set(uuid, promise);
        try {
            return await promise;
        } finally {
            this._inflight.delete(uuid);
        }
    }

    async _sendPaymentRequest(uuid) {
        await super.sendPaymentRequest(uuid);
        const line = this._getLine(uuid);
        if (!line) {
            return false;
        }
        try {
            return await this._run(line);
        } catch (error) {
            // Un fallo inesperado NO debe dejar la línea como "cobrable de nuevo" si pudo cobrarse.
            line.redsys_state = "unknown";
            line.redsys_reference = line.redsys_reference || line.payment_ref_no || null;
            this._alert(
                "Redsys: error inesperado",
                "No se ha podido confirmar la operación. NO repita el cobro: verifique la referencia " +
                    `${line.redsys_reference || "?"} en el portal de Redsys. (${error && error.message})`
            );
            return false;
        }
    }

    async _run(line) {
        const service = this.service;
        const order = line.pos_order_id;
        // QA-11: una línea ya autorizada/devuelta no se vuelve a cobrar; una dudosa no se reenvía.
        if (line.redsys_state === "authorized" || line.redsys_state === "refund") {
            this.pos.notification.add("Esta operación ya figura como realizada en Redsys.", { type: "info" });
            return true;
        }
        if (line.redsys_state === "unknown") {
            this._alert(
                "Redsys: operación pendiente",
                "Esta línea tiene un cobro con resultado sin resolver (referencia " +
                    `${line.redsys_reference || line.payment_ref_no || "?"}). No se reenvía al datáfono: ` +
                    "resuélvala con Forzar tras verificar en el portal de Redsys."
            );
            return false;
        }
        const blocking = unresolvedLines(order.payment_ids, line.uuid);
        if (blocking.length) {
            this._alert(
                "Redsys: operación pendiente",
                "Hay un cobro Redsys con resultado sin resolver en este pedido. Resuélvalo (consulta/Forzar tras verificar " +
                    "en el portal) antes de iniciar otro cobro, para evitar un doble cargo."
            );
            return false;
        }
        const amount = line.getAmount();
        if (!amount) {
            this._alert("Redsys", "El importe debe ser distinto de cero.");
            return false;
        }
        const isRefund = amount < 0;
        let info = null;
        if (isRefund) {
            info = this.refundInfoFor(line);
            const check = validateRefund(
                info,
                amount,
                this._alreadyRefunded(info, line)
            );
            if (!check.ok) {
                this._alert("Redsys: devolución no disponible", check.reason);
                return false;
            }
        }
        const reference = makeReference(line.uuid);
        if (!reference) {
            this._alert("Redsys", "No se pudo generar la referencia de la operación.");
            return false;
        }
        const ready = await service.ensureReady(this.payment_method_id);
        if (!ready.ok) {
            this._alert("Redsys: datáfono no disponible", ready.message);
            return false;
        }
        // La referencia se persiste ANTES de cobrar: permite consultar tras una recarga.
        line.payment_ref_no = reference;
        line.redsys_reference = reference;
        if (isRefund && info.pedido) {
            line.redsys_original_pedido = info.pedido;
        }
        const redsys = ready.entry.redsys;
        this._liveStatus = "waiting";
        service.markStart(reference); // QA-01: inicio del cobro, base de la gracia tras una recarga
        service.beginLine(line.uuid); // QA-15: cobro en curso en esta pestaña
        const off = [
            redsys.on("cardReading", () => {
                this._liveStatus = "waitingCard";
                line.setPaymentStatus("waitingCard");
            }),
            redsys.on("cardOk", () => {
                // tarjeta leída: ya no se puede cancelar desde el POS
                this._liveStatus = "waiting";
                line.setPaymentStatus("waiting");
            }),
        ];
        let result;
        try {
            result = isRefund
                ? await redsys.refund({ pedido: info.pedido, rts: info.rts, amount: Math.abs(amount), reference })
                : await redsys.pay({ amount, reference });
        } finally {
            off.forEach((fn) => fn());
            service.endLine(line.uuid);
        }
        const decision = interpretPayResult(result, { isRefund, originalPedido: info && info.pedido });
        if (decision.outcome !== "unknown") {
            service.clearStart(reference); // resultado definitivo: ya no hace falta la gracia
        }
        Object.assign(line, decision.vals);
        if (decision.outcome === "done") {
            line.setReceiptInfo(decision.receipt);
            if (decision.notify) {
                this.pos.notification.add(decision.notify, { type: "info" });
            }
            return true;
        }
        this._alert(
            decision.outcome === "unknown" ? "Redsys: resultado desconocido" : "Redsys: operación no realizada",
            decision.message
        );
        // 'unknown' => PosPayment.handlePaymentResponse(false) deja la línea en force_done.
        return false;
    }

    /**
     * El datáfono no permite cancelar una operación en curso desde el POS: se
     * explica y se mantiene la línea. Fuera de operación (p. ej. timeout) se permite.
     */
    async sendPaymentCancel(order, uuid) {
        await super.sendPaymentCancel(order, uuid);
        const line = this._getLine(uuid);
        if (this.service.isOperationActive(this.payment_method_id)) {
            if (line) {
                line.setPaymentStatus(this._liveStatus);
            }
            this._alert(
                "Redsys: no se puede cancelar",
                "Hay una operación en curso en el datáfono. Cancélela en el propio datáfono o espere al resultado; " +
                    "cancelar desde el POS podría provocar un doble cobro."
            );
            return false;
        }
        if (line && (line.redsys_state === "unknown" || line.redsys_state === "authorized")) {
            this._alert("Redsys", "Esta operación puede haberse cobrado; no se puede cancelar. Verifique su resultado.");
            if (line) {
                line.setPaymentStatus("force_done");
            }
            return false;
        }
        return true;
    }
}

register_payment_method("redsys_tpvpc", PaymentRedsysTpvpc);
