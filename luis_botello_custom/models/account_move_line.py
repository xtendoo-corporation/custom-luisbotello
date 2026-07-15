from odoo import models, fields

class AccountMoveLine(models.Model):
    _inherit = 'account.move.line'

    discount_line = fields.Float(string='Desc. Lin', default=0.0)

