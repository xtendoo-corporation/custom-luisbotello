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
    isRedsysMethod,
    refundInfoFromOriginal,
    unresolvedLines,
    validateRefund,
} from "../utils/redsys_pos_logic.js";

export class PaymentRedsysTpvpc extends PaymentInterface {
    setup() {
        super.setup(...arguments);
        this.supports_reversals = false; // las devoluciones se hacen en pedidos de devolución
        this._liveStatus = "waiting";
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
        const orig = refundedOrder.payment_ids.find((p) => canRefundRedsysLine(p).ok);
        return orig ? refundInfoFromOriginal(orig) : null;
    }

    async sendPaymentRequest(uuid) {
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
            const check = validateRefund(info, amount);
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
        const redsys = ready.entry.redsys;
        this._liveStatus = "waiting";
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
        }
        const decision = interpretPayResult(result, { isRefund });
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
export { isRedsysMethod };
