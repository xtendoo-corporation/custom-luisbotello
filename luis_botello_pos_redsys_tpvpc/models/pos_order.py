from odoo import _, api, models
from odoo.exceptions import UserError

from .pos_payment import REDSYS_PROTECTED_STATES, redsys_bypass

# Estados que acreditan (o pueden acreditar) un cargo en tarjeta sin devolución: cancelar el pedido
# dejaría el cobro sin rastro. `not_charged` (conciliado: no hubo cargo) no impide cancelar.
REDSYS_CHARGE_STATES = ("authorized", "unknown", "refund")


class PosOrder(models.Model):
    _inherit = "pos.order"

    def _redsys_payments(self, states):
        return self.sudo().payment_ids.filtered(lambda p: p.redsys_state in states)

    def action_pos_order_cancel(self):
        """QA2-01 (servidor): cancelar un pedido borrador con cobros Redsys authorized/unknown/refund lo
        dejaría en `cancel` con la línea intacta y sin devolución (nadie se entera). También cubre el
        «Cancel Orders» del cierre de sesión por `open_order_ids` (el POS llama aquí aunque el pedido
        no esté cargado en el navegador)."""
        if not redsys_bypass(self.env):
            for order in self.filtered(lambda o: o.state == "draft"):
                pays = order._redsys_payments(REDSYS_CHARGE_STATES)
                if pays:
                    raise UserError(
                        _(
                            "Order %(order)s has card payments made through Redsys (%(refs)s) and cannot "
                            "be cancelled. Finish the order and refund the card payment from the terminal, "
                            "or ask a manager to reconcile it.",
                            order=order.display_name,
                            refs=", ".join(pays.mapped(lambda p: p.redsys_reference or "-")),
                        )
                    )
        return super().action_pos_order_cancel()

    @api.ondelete(at_uninstall=False)
    def _unlink_except_redsys_protected_payments(self):
        """QA2-10: `pos.payment.pos_order_id` es ondelete='cascade' y el cascade de BD no pasa por
        `pos.payment.unlink` (D10): un cajero con `unlink` sobre pos.order por RPC borraría el cobro. Se
        impide aquí, en el `unlink` del ORM del pedido (se ejecuta antes del borrado y de su cascada).
        Límite: un DELETE por SQL, borrar la sesión/BD o desinstalar el módulo saltan esta comprobación."""
        if redsys_bypass(self.env):
            return
        for order in self:
            pays = order._redsys_payments(REDSYS_PROTECTED_STATES)
            if pays:
                raise UserError(
                    _(
                        "Order %(order)s has card payments confirmed through Redsys (%(refs)s) and cannot "
                        "be deleted.",
                        order=order.display_name,
                        refs=", ".join(pays.mapped(lambda p: p.redsys_reference or "-")),
                    )
                )
