from odoo import _, api, fields, models
from odoo.exceptions import UserError


class PosOrderRedsysCancel(models.TransientModel):
    _name = "pos.order.redsys.cancel"
    _description = "Cancel an abandoned order with Redsys payments"

    order_id = fields.Many2one("pos.order", required=True, readonly=True)
    payment_info = fields.Text(compute="_compute_payment_info")
    refund_reference = fields.Char(
        required=True,
        help="Reference of the refund made in the Redsys portal or on the terminal (or why none is needed).",
    )
    note = fields.Text(required=True)

    @api.depends("order_id")
    def _compute_payment_info(self):
        for wiz in self:
            pays = wiz.order_id.sudo().payment_ids.filtered("redsys_state")
            wiz.payment_info = "\n".join(f"{p.redsys_reference or '-'}: {p.amount} ({p.redsys_state})" for p in pays)

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        if "order_id" in fields_list and self.env.context.get("active_model") == "pos.order":
            res["order_id"] = self.env.context.get("active_id")
        return res

    def action_cancel_order(self):
        self.ensure_one()
        if not self.order_id:
            raise UserError(_("No order selected."))
        self.order_id.redsys_manager_cancel(self.refund_reference, self.note)
        return {"type": "ir.actions.act_window_close"}
