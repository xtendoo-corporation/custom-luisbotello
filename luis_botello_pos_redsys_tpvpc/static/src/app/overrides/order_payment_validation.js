/** @odoo-module */
// QA2-02: `validateOrder` del core elimina TODA línea de pago no `done` (`!line.isDone()`) justo después de
// `isOrderValid` y antes de sincronizar. Una línea Redsys unknown/force_done/en curso no cuenta como pagada
// (amountPaid solo suma las done), de modo que pagar el resto en efectivo la BORRARÍA y el cargo quedaría
// sin registro. `isOrderValid` se ejecuta antes de esa limpieza (order_payment_validation.js, validateOrder),
// y también lo usan el pago rápido (validateOrderFast) y la validación forzada.
import OrderPaymentValidation from "@point_of_sale/app/utils/order_payment_validation";
import {AlertDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {patch} from "@web/core/utils/patch";
import {
  pendingRedsysLines,
  validationBlockedMessage,
} from "../utils/redsys_pos_logic.js";

patch(OrderPaymentValidation.prototype, {
  async isOrderValid(isForceValidate) {
    const pending = pendingRedsysLines(this.paymentLines);
    if (pending.length) {
      this.pos.dialog.add(AlertDialog, {
        title: "Redsys: cobros sin resolver",
        body: validationBlockedMessage(pending),
      });
      return false;
    }
    return super.isOrderValid(...arguments);
  },
});
