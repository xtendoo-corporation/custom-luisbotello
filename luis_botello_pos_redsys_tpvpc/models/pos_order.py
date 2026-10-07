from odoo import _, api, models
from odoo.exceptions import AccessError, UserError

from .pos_payment import REDSYS_PROTECTED_STATES, redsys_bypass

# Estados que acreditan (o pueden acreditar) un cargo en tarjeta sin devolución: cancelar el pedido
# dejaría el cobro sin rastro. `not_charged` (conciliado: no hubo cargo) no impide cancelar.
REDSYS_CHARGE_STATES = ("authorized", "unknown", "refund")


class PosOrder(models.Model):
    _inherit = "pos.order"

    def _redsys_payments(self, states):
        return self.sudo().payment_ids.filtered(lambda p: p.redsys_state in states)

    def _redsys_check_cancel(self):
        """QA2-01 / R3-02 (servidor): cancelar un pedido borrador con cobros Redsys authorized/unknown/refund
        lo dejaría en `cancel` con la línea intacta y sin devolución (nadie se entera). La guarda vive en
        `write` (no solo en `action_pos_order_cancel`): también la usan `remove_from_ui`, el cierre de
        `pos_conventional_session_management` (`_cancel_empty_draft_orders`, wizard de cierre) y cualquier
        `write({'state': 'cancel'})` por RPC."""
        for order in self.filtered(lambda o: o.state == "draft"):
            pays = order._redsys_payments(REDSYS_CHARGE_STATES)
            if pays:
                raise UserError(
                    _(
                        "Order %(order)s has card payments made through Redsys (%(refs)s) and cannot "
                        "be cancelled. Finish the order and refund the card payment from the terminal, "
                        "or ask a manager to cancel it with the refund registered.",
                        order=order.display_name,
                        refs=", ".join(pays.mapped(lambda p: p.redsys_reference or "-")),
                    )
                )

    def write(self, vals):
        if vals.get("state") == "cancel" and not redsys_bypass(self.env):
            self._redsys_check_cancel()
        return super().write(vals)

    def redsys_manager_cancel(self, refund_reference, note):
        """R3-04: salida AUDITADA de un manager para un borrador abandonado con cobro Redsys `authorized`
        (p. ej. cobro parcial y el cliente se fue). La devolución se hace fuera (portal/datáfono) y aquí
        solo se anota: referencia obligatoria y nota; el pedido queda `cancel` con las líneas intactas
        (no se borra el rastro) y el mensaje en el chatter. No sirve con líneas `unknown` (concilie antes)."""
        if not self.env.user.has_group("point_of_sale.group_pos_manager"):
            raise AccessError(_("Only Point of Sale managers can cancel orders with Redsys payments."))
        refund_reference = (refund_reference or "").strip()
        note = (note or "").strip()
        if not refund_reference or not note:
            raise UserError(_("The refund reference and a note are required."))
        for order in self.sudo():
            if order.state != "draft":
                raise UserError(_("Only draft orders can be cancelled this way."))
            if order._redsys_payments(("unknown",)):
                raise UserError(
                    _(
                        "Order %s has Redsys payments with an unknown result: reconcile them first.",
                        order.display_name,
                    )
                )
            pays = order._redsys_payments(REDSYS_CHARGE_STATES)
            order.with_context(redsys_force_unlink=True).write({"state": "cancel"})
            order.message_post(
                body=_(
                    "Order cancelled by %(user)s with Redsys payments (%(refs)s). Refund reference: "
                    "%(refund)s. Note: %(note)s",
                    user=self.env.user.name,
                    refs=", ".join((pays.mapped(lambda p: p.redsys_reference or "-")) or ["-"]),
                    refund=refund_reference,
                    note=note,
                )
            )
        return True

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
                        "Order %(order)s has card payments confirmed through Redsys (%(refs)s) and cannot be deleted.",
                        order=order.display_name,
                        refs=", ".join(pays.mapped(lambda p: p.redsys_reference or "-")),
                    )
                )
