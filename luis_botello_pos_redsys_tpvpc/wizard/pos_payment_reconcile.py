from odoo import _, api, fields, models


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
        required=True,
        help="Evidence used (Redsys portal operation, date, who checked it).",
    )

    warning = fields.Text(compute="_compute_warning")

    @api.depends("resolution", "payment_ids")
    def _compute_warning(self):
        """QA2-05: una línea `not_charged` en un pedido YA pagado se queda en él y sigue contando como
        pagada (borrarla desbarataría el pedido y su contabilidad): avisar al manager."""
        for wiz in self:
            paid = wiz.payment_ids.filtered(lambda p: p.pos_order_id.state != "draft")
            if wiz.resolution == "not_charged" and paid:
                wiz.warning = _(
                    "The orders %s are already paid: the line stays in the order and keeps counting as "
                    "paid. Correct the order/accounting manually (this reconciliation only records that "
                    "no card charge exists).",
                    ", ".join(paid.pos_order_id.mapped("display_name")),
                )
            else:
                wiz.warning = False

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        if "payment_ids" in fields_list and self.env.context.get("active_model") == "pos.payment":
            payments = (
                self.env["pos.payment"]
                .browse(self.env.context.get("active_ids", []))
                .filtered(lambda p: p.redsys_state == "unknown")
            )
            res["payment_ids"] = [(6, 0, payments.ids)]
        return res

    def action_reconcile(self):
        self.ensure_one()
        self.payment_ids.redsys_reconcile(self.resolution, self.note)
        return {"type": "ir.actions.act_window_close"}
