/** @odoo-module */
import { PosPayment } from "@point_of_sale/app/models/pos_payment";
import { patch } from "@web/core/utils/patch";
import {
    canRefundRedsysLine,
    isRedsysMethod,
    refundInfoFromOriginal,
} from "../utils/redsys_pos_logic.js";

patch(PosPayment.prototype, {
    setup(vals) {
        super.setup(vals);
        this.uiState = { ...(this.uiState || {}), redsysRefund: null };
    },

    /** D5: copia pedido/RTS del cobro original (patrón razorpay/stripe). */
    updateRefundPaymentLine(refundedPaymentLine) {
        super.updateRefundPaymentLine(refundedPaymentLine);
        if (isRedsysMethod(this.payment_method_id) && canRefundRedsysLine(refundedPaymentLine).ok) {
            this.uiState.redsysRefund = refundInfoFromOriginal(refundedPaymentLine);
        } else if (isRedsysMethod(this.payment_method_id)) {
            this.uiState.redsysRefund = null;
        }
    },

    /** Resultado desconocido: no se ofrece "reintentar" sino confirmación manual. */
    handlePaymentResponse(isPaymentSuccessful) {
        const res = super.handlePaymentResponse(isPaymentSuccessful);
        if (
            !isPaymentSuccessful &&
            isRedsysMethod(this.payment_method_id) &&
            this.redsys_state === "unknown"
        ) {
            this.setPaymentStatus("force_done");
        }
        return res;
    },
});
