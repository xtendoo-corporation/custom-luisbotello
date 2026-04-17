# -*- coding: utf-8 -*-
from odoo import models, fields


class AccountPayment(models.Model):
    """
    Extensión de account.payment para enlazar el pago con la salida de caja
    generada en la sesión de TPV al pagar una factura de proveedor en efectivo.
    """
    _inherit = 'account.payment'

    pos_cash_out_id = fields.Many2one(
        comodel_name='account.bank.statement.line',
        string='Salida de caja POS',
        readonly=True,
        copy=False,
        help=(
            'Línea de extracto bancario (salida de caja) generada en la sesión '
            'de TPV activa al registrar este pago en efectivo de factura de proveedor.'
        ),
    )

    def action_view_pos_cash_out(self):
        """Apertura del smart button en el pago → salida de caja POS."""
        self.ensure_one()
        return self.pos_cash_out_id.action_open_pos_cash_outs('Salida de caja POS')
