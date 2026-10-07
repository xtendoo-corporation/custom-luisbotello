from odoo import api, fields, models


class PosPaymentRedsysReconcile(models.TransientModel):
    _name = "pos.payment.redsys.reconcile"
    _description = "Reconcile unknown Redsys payments"

    payment_ids = fields.Many2many(
        "pos.payment",
        string="Payments",
        domain=[("redsys_state", "=", "unknown")],
        required=True,
    )
    resolution = fields.Selection(
        [
            ("charged", "Charged (confirmed in the Redsys portal)"),
            ("not_charged", "Not charged"),
        ],
        required=True,
    )
    note = fields.Text(
        string="Note",
        required=True,
        help="Evidence used (Redsys portal operation, date, who checked it).",
    )

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        if (
            "payment_ids" in fields_list
            and self.env.context.get("active_model") == "pos.payment"
        ):
            payments = self.env["pos.payment"].browse(
                self.env.context.get("active_ids", [])
            ).filtered(lambda p: p.redsys_state == "unknown")
            res["payment_ids"] = [(6, 0, payments.ids)]
        return res

    def action_reconcile(self):
        self.ensure_one()
        self.payment_ids.redsys_reconcile(self.resolution, self.note)
        return {"type": "ir.actions.act_window_close"}
