from odoo import _, models
from odoo.exceptions import UserError


class PosSession(models.Model):
    _inherit = "pos.session"

    def _redsys_unknown_message(self):
        """QA2-03: texto con el listado de cobros Redsys `unknown` de la sesión (vacío si no hay)."""
        pays = self.env["pos.payment"].sudo().search([("session_id", "in", self.ids), ("redsys_state", "=", "unknown")])
        if not pays:
            return ""
        lines = [
            _(
                "- %(ref)s: %(amount)s in %(order)s",
                ref=p.redsys_reference or p.transaction_id or "-",
                amount=p.amount,
                order=p.pos_order_id.display_name,
            )
            for p in pays
        ]
        return _(
            "You cannot close the session while there are Redsys card payments with an unknown result "
            "(they may have been charged to the customer):\n%(lines)s\n\n"
            "A manager must reconcile them against the Redsys portal in Point of Sale > Orders > "
            "Redsys payments to reconcile, and then close the session.",
            lines="\n".join(lines),
        )

    def _cannot_close_session(self, bank_payment_method_diffs=None):
        if self.state != "closed":
            message = self._redsys_unknown_message()
            if message:
                return {
                    "successful": False,
                    "title": _("Redsys payments to reconcile"),
                    "message": message,
                    "redirect": True,  # al backend, donde está la conciliación
                }
        return super()._cannot_close_session(bank_payment_method_diffs)

    def action_pos_session_closing_control(self, *args, **kwargs):
        # Cierre desde el backend (no pasa por _cannot_close_session).
        for session in self.filtered(lambda s: s.state != "closed"):
            message = session._redsys_unknown_message()
            if message:
                raise UserError(message)
        return super().action_pos_session_closing_control(*args, **kwargs)

    def _validate_session(self, *args, **kwargs):
        """R3-03: `action_pos_session_validate`/`action_pos_session_close` son RPC públicos que llegan aquí
        sin pasar por `_cannot_close_session`: no se valida una sesión con cobros Redsys `unknown`."""
        for session in self.filtered(lambda s: s.state != "closed"):
            message = session._redsys_unknown_message()
            if message:
                raise UserError(message)
        return super()._validate_session(*args, **kwargs)
