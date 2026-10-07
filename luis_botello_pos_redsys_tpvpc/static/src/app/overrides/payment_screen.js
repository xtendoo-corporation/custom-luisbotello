/** @odoo-module */
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { patch } from "@web/core/utils/patch";
import { onMounted } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import {
    canRefundRedsysLine,
    isRedsysMethod,
    refundableAmount,
    refundInfoFromOriginal,
    unresolvedLines,
} from "../utils/redsys_pos_logic.js";

patch(PaymentScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.redsys = useService("redsys_tpvpc");
        // Recuperación tras recarga: antes de permitir nada, consultar por referencia.
        onMounted(() => {
            this.redsys.recoverOrder(this.currentOrder).catch(() => {});
        });
    },

    _redsysAlert(title, body) {
        this.dialog.add(AlertDialog, { title, body });
    },

    async addNewPaymentLine(paymentMethod) {
        if (!isRedsysMethod(paymentMethod)) {
            return super.addNewPaymentLine(...arguments);
        }
        // No iniciar otro cobro si hay uno sin resolver (anti doble cobro).
        if (unresolvedLines(this.paymentLines).length) {
            this._redsysAlert(
                "Redsys: operación pendiente",
                "Hay un cobro Redsys sin resolver en este pedido. Resuélvalo antes de añadir otro pago con el datáfono."
            );
            return false;
        }
        if (!this.isRefundOrder) {
            return super.addNewPaymentLine(...arguments);
        }
        // Pedido de devolución: enlazar con el cobro Redsys original (pedido + RTS).
        const refundedOrder = this.currentOrder.lines[0]?.refunded_orderline_id?.order_id;
        const candidates = (refundedOrder?.payment_ids || []).filter(
            (p) => isRedsysMethod(p.payment_method_id) && p.amount > 0
        );
        if (!candidates.length) {
            this._redsysAlert(
                "Redsys: devolución no disponible",
                "El pedido original no se cobró con el datáfono Redsys; use el método de pago original."
            );
            return false;
        }
        const usedUuids = this.paymentLines
            .map((l) => l.uiState?.redsysRefund?.paymentUuid)
            .filter(Boolean);
        let chosen = null;
        let lastReason = null;
        for (const orig of candidates) {
            const check = canRefundRedsysLine(orig);
            if (!check.ok) {
                lastReason = check.reason;
                continue;
            }
            if (usedUuids.includes(orig.uuid)) {
                continue;
            }
            // [PETICION-ORQUESTADOR] sin campo que enlace la devolución con la original no se
            // acumulan devoluciones previas: lo impone Redsys (TPV-PC0100).
            const room = refundableAmount(orig, []);
            if (room > 0) {
                chosen = { orig, room };
                break;
            }
        }
        if (!chosen) {
            this._redsysAlert(
                "Redsys: devolución no disponible",
                lastReason || "No queda importe devolvible en los cobros Redsys del pedido original."
            );
            return false;
        }
        const due = Math.abs(this.currentOrder.remainingDue);
        if (!due) {
            return false;
        }
        const res = await super.addNewPaymentLine(...arguments);
        if (res) {
            const line = this.paymentLines.at(-1);
            line.setAmount(-Math.min(due, chosen.room));
            line.uiState.redsysRefund = refundInfoFromOriginal(chosen.orig);
            this.numberBuffer.set(String(line.amount));
        }
        return res;
    },

    async sendForceDone(line) {
        if (!isRedsysMethod(line.payment_method_id)) {
            return super.sendForceDone(...arguments);
        }
        const service = this.redsys;
        if (service.isOperationActive(line.payment_method_id)) {
            this._redsysAlert(
                "Redsys: operación en curso",
                "El datáfono está trabajando. No se puede forzar el pago hasta conocer el resultado."
            );
            return;
        }
        // Primero intentar resolverlo consultando a Redsys por la referencia.
        let outcome = { outcome: "skipped" };
        try {
            outcome = await service.recoverLine(line);
        } catch {
            // se cae al flujo manual
        }
        if (outcome.outcome === "authorized") {
            this._redsysAlert("Redsys", outcome.message);
            return super.sendForceDone(line);
        }
        if (outcome.outcome === "not_charged") {
            this._redsysAlert("Redsys", outcome.message);
            return;
        }
        const reference = line.redsys_reference || line.payment_ref_no || "?";
        this.dialog.add(ConfirmationDialog, {
            title: "Redsys: confirmar cobro manualmente",
            body:
                `${outcome.message ? outcome.message + "\n\n" : ""}` +
                `Solo confirme si ha comprobado en el portal de Redsys (o en el datáfono) que la operación ` +
                `${reference} figura como AUTORIZADA por ${Math.abs(line.getAmount())}. ` +
                "Si no está seguro, no confirme.",
            confirmLabel: "Está autorizada",
            cancelLabel: "No confirmar",
            confirm: () => {
                if (line.redsys_state !== "authorized" && line.redsys_state !== "refund") {
                    line.redsys_state = "unknown"; // queda marcada para conciliación
                }
                return super.sendForceDone(line);
            },
            cancel: () => {},
        });
    },
});
