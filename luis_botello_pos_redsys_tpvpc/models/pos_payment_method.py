from odoo import _, api, fields, models
from odoo.exceptions import AccessError, ValidationError


class PosPaymentMethod(models.Model):
    _inherit = "pos.payment.method"

    def _get_payment_terminal_selection(self):
        return super()._get_payment_terminal_selection() + [("redsys_tpvpc", "Redsys TPV-PC")]

    redsys_merchant_code = fields.Char(
        string="Redsys merchant code (FUC)",
        copy=False,
        help="Código de comercio (FUC), 9 dígitos.",
    )
    redsys_terminal_number = fields.Char(string="Redsys terminal", default="1", copy=False)
    # SECRETO. Nunca se incluye en _load_pos_data_fields (ver DECISIONS.md D7).
    redsys_signature_key = fields.Char(
        string="Redsys signature key",
        copy=False,
        groups="point_of_sale.group_pos_manager",
        help="Clave de firma del comercio. Solo legible por administradores del "
        "POS; el POS la recibe mediante redsys_get_signature_key (sudo), solo "
        "para el método de la caja con sesión abierta del usuario.",
    )
    redsys_com_port = fields.Char(string="Redsys COM port", default="COM9:,19200,N,8,1")
    redsys_protocol_version = fields.Selection(
        [("6.1", "6.1"), ("8.1", "8.1")],
        string="Redsys protocol version",
        default="8.1",
    )
    redsys_transport = fields.Selection(
        [("js", "JavaScript library"), ("http", "HTTP service")],
        string="Redsys transport",
        default="js",
    )
    redsys_simulation = fields.Boolean(
        string="Redsys simulation mode",
        copy=False,
        help="Usa el simulador en lugar del datáfono real. Solo para "
        "administradores del POS. No debe activarse en producción.",
    )

    @api.model
    def _load_pos_data_fields(self, config):
        params = super()._load_pos_data_fields(config)
        params += [
            "redsys_merchant_code",
            "redsys_terminal_number",
            "redsys_com_port",
            "redsys_protocol_version",
            "redsys_transport",
            "redsys_simulation",
        ]
        return params

    @api.model
    def redsys_get_signature_key(self, config_id):
        """Devuelve {payment_method_id: clave} de los métodos Redsys de la caja.

        Criterio de acceso (QA-17, DECISIONS D7): usuario del grupo POS user, y la
        config debe tener una sesión abierta (no cerrada) cuyo responsable sea el
        propio usuario. Los administradores (group_pos_manager) pueden pedirla
        para cualquier config con sesión abierta. Sin sesión abierta o de otro
        usuario: AccessError (sin revelar si la config existe).
        """
        user = self.env.user
        if not user.has_group("point_of_sale.group_pos_user"):
            raise AccessError(_("You are not allowed to use the Redsys terminal."))
        config = self.env["pos.config"].browse(config_id).exists()
        if not config:
            return {}
        config.check_access("read")
        session = config.current_session_id
        if not session or session.state == "closed":
            raise AccessError(_("The point of sale has no open session."))
        if session.user_id != user and not user.has_group("point_of_sale.group_pos_manager"):
            raise AccessError(_("This point of sale session was not opened by you."))
        methods = config.payment_method_ids.filtered(lambda m: m.use_payment_terminal == "redsys_tpvpc")
        return {m.id: m.sudo().redsys_signature_key or "" for m in methods}

    @api.constrains("redsys_merchant_code", "redsys_terminal_number")
    def _check_redsys_merchant_terminal(self):
        for method in self:
            if method.use_payment_terminal != "redsys_tpvpc" or not method.redsys_merchant_code:
                continue
            duplicate = (
                self.sudo()
                .with_context(active_test=False)
                .search(
                    [
                        ("id", "!=", method.id),
                        ("use_payment_terminal", "=", "redsys_tpvpc"),
                        ("redsys_merchant_code", "=", method.redsys_merchant_code),
                        (
                            "redsys_terminal_number",
                            "=",
                            method.redsys_terminal_number,
                        ),
                    ],
                    limit=1,
                )
            )
            if duplicate:
                raise ValidationError(
                    _(
                        "Merchant %(merchant)s / terminal %(terminal)s is already used by payment method %(method)s.",
                        merchant=method.redsys_merchant_code,
                        terminal=method.redsys_terminal_number,
                        method=duplicate.name,
                    )
                )

    @api.model_create_multi
    def create(self, vals_list):
        if any(v.get("redsys_simulation") for v in vals_list):
            self._redsys_check_simulation_right()
        return super().create(vals_list)

    def write(self, vals):
        if "redsys_simulation" in vals:
            self._redsys_check_simulation_right()
        return super().write(vals)

    def _redsys_check_simulation_right(self):
        if not self.env.su and not self.env.user.has_group("point_of_sale.group_pos_manager"):
            raise AccessError(_("Only Point of Sale administrators can change the simulation mode."))

    @api.onchange("use_payment_terminal")
    def _onchange_use_payment_terminal(self):
        res = super()._onchange_use_payment_terminal()
        if self.use_payment_terminal != "redsys_tpvpc":
            self.redsys_merchant_code = False
            self.redsys_signature_key = False
            self.redsys_simulation = False
        return res
