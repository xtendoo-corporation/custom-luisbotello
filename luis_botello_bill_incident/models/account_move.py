from odoo import fields, models


class AccountMove(models.Model):
    _inherit = 'account.move'

    incidencias = fields.Text(
        string='Incidencias',
        copy=False,
        tracking=True,
        help='Si se rellena, al abrir la factura se mostrará un aviso con '
             'este texto.',
    )
