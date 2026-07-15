from odoo import models

class PosOrder(models.Model):
    _inherit = 'pos.order'

    def _get_invoice_lines_values(self, line_values, pos_line, move_type):
        res = super(PosOrder, self)._get_invoice_lines_values(line_values, pos_line, move_type)
        if pos_line and 'discount_line' in pos_line._fields:
            res.update({'discount_line': pos_line.discount_line})
        return res

