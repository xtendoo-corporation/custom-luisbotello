/** @odoo-module */
// QA2-01: borrar/cancelar un PEDIDO (botón "Cancelar pedido", pantalla de tickets, "Cancel Orders" del
// cierre de sesión) se llevaría por delante las líneas Redsys sin pasar por deletePaymentLine (QA-23).
// Core 19: PosStore.onDeleteOrder -> beforeDeleteOrder, y deleteOrders -> _onBeforeDeleteOrder por pedido.
// Se parchean los dos: el primero evita la pregunta "¿seguro?" inútil, el segundo cubre el cierre de sesión
// (closing_popup ignora el retorno de deleteOrders, pero el servidor no cierra con borradores abiertos).
import { PosStore } from "@point_of_sale/app/services/pos_store";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { patch } from "@web/core/utils/patch";
import {
    canSaveForReconciliation,
    deletionBlockedMessage,
    orderDeletionBlockers,
} from "../utils/redsys_pos_logic.js";

patch(PosStore.prototype, {
    /**
     * Devuelve true (y avisa) si el pedido tiene cobros Redsys que no se pueden perder.
     * Alternativa para el cajero: guardar el pedido en borrador en el servidor para conciliarlo.
     */
    _redsysBlocksDelete(order) {
        const blockers = orderDeletionBlockers(order);
        if (!blockers.length) {
            return false;
        }
        const title = "Redsys: el pedido tiene cobros con tarjeta";
        const body = deletionBlockedMessage(blockers);
        if (canSaveForReconciliation(blockers)) {
            this.dialog.add(ConfirmationDialog, {
                title,
                body,
                confirmLabel: "Guardar el pedido para conciliación",
                cancelLabel: "Volver",
                confirm: async () => {
                    try {
                        this.addPendingOrder([order.id]);
                        await this.syncAllOrders({ orders: [order], force: true });
                    } catch (error) {
                        this.dialog.add(AlertDialog, {
                            title: "Redsys: no se pudo guardar el pedido",
                            body:
                                "No se ha podido sincronizar el pedido con el servidor. NO lo borre: " +
                                `${(error && error.message) || "error desconocido"}`,
                        });
                    }
                },
                cancel: () => {},
            });
        } else {
            this.dialog.add(AlertDialog, { title, body });
        }
        return true;
    },

    async beforeDeleteOrder(order) {
        if (this._redsysBlocksDelete(order)) {
            return false;
        }
        return super.beforeDeleteOrder(...arguments);
    },

    async _onBeforeDeleteOrder(order) {
        if (this._redsysBlocksDelete(order)) {
            return false;
        }
        return super._onBeforeDeleteOrder(...arguments);
    },
});
