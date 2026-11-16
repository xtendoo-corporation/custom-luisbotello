import { patch } from "@web/core/utils/patch";
import { useEffect } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { AccountMoveFormController } from "@account/components/account_move_form/account_move_form";

const VENDOR_MOVE_TYPES = ["in_invoice", "in_refund", "in_receipt"];

patch(AccountMoveFormController.prototype, {
    setup() {
        super.setup(...arguments);
        this.incidentDialog = useService("dialog");
        // Se dispara al abrir una factura (o al cambiar de registro con el
        // paginador), no al guardar.
        useEffect(
            (resId) => {
                if (resId) {
                    this._showIncidentAlert();
                }
            },
            () => [this.model.root.resId]
        );
    },

    _showIncidentAlert() {
        const data = this.model.root.data;
        const incident = (data.incidencias || "").trim();
        if (incident && VENDOR_MOVE_TYPES.includes(data.move_type)) {
            this.incidentDialog.add(AlertDialog, {
                title: "Incidencias",
                body: incident,
                confirmLabel: "Entendido",
            });
        }
    },
});
