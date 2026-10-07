from odoo import _, fields, models
from odoo.exceptions import UserError

REDSYS_PROTECTED_STATES = ("authorized", "unknown", "refund")
# Campos que no pueden cambiar una vez la línea tiene estado Redsys.
REDSYS_LOCKED_FIELDS = {
    "amount",
    "payment_method_id",
    "pos_order_id",
    "transaction_id",
    "payment_ref_no",
    "redsys_rts",
    "redsys_xml",
    "redsys_reference",
    "redsys_original_pedido",
}


class PosPayment(models.Model):
    _inherit = "pos.payment"

    redsys_rts = fields.Char(string="Redsys RTS identifier", copy=False)
    redsys_xml = fields.Text(string="Redsys raw XML", copy=False)
    redsys_state = fields.Selection(
        [("authorized", "Authorized"), ("unknown", "Unknown"), ("refund", "Refund")],
        string="Redsys state",
        copy=False,
        index="btree_not_null",
    )
    redsys_reference = fields.Char(string="Redsys reference", copy=False, index=True)
    redsys_original_pedido = fields.Char(
        string="Redsys original order",
        copy=False,
        index="btree_not_null",
        help="Redsys order number (pedido) of the original charge this refund "
        "belongs to. Lets the POS add up previous refunds against one charge.",
    )

    def unlink(self):
        if not self.env.context.get("redsys_force_unlink"):
            locked = self.filtered(lambda p: p.redsys_state in REDSYS_PROTECTED_STATES)
            if locked:
                raise UserError(
                    _(
                        "Card payments confirmed through Redsys cannot be deleted "
                        "(reference: %s). Refund them from the terminal instead.",
                        ", ".join(locked.mapped(lambda p: p.redsys_reference or "-")),
                    )
                )
        return super().unlink()

    def write(self, vals):
        if not self.env.context.get("redsys_force_unlink"):
            locked = self.filtered(lambda p: p.redsys_state in REDSYS_PROTECTED_STATES)
            if locked:
                forbidden = REDSYS_LOCKED_FIELDS & vals.keys()
                new_state = vals.get("redsys_state", False)
                if "redsys_state" in vals:
                    # única transición permitida: unknown -> authorized/refund
                    if any(
                        p.redsys_state != "unknown" and new_state != p.redsys_state
                        for p in locked
                    ):
                        forbidden.add("redsys_state")
                if forbidden:
                    raise UserError(
                        _(
                            "Payments confirmed through Redsys cannot be modified "
                            "(%s).",
                            ", ".join(sorted(forbidden)),
                        )
                    )
        return super().write(vals)
