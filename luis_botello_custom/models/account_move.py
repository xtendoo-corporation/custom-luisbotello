from odoo import models

class AccountMove(models.Model):
    _inherit = 'account.move'

    def _prepare_product_base_line_for_taxes_computation(self, product_line):
        res = super()._prepare_product_base_line_for_taxes_computation(product_line)
        if product_line.discount_line:
            res['price_unit'] = res['price_unit'] - (product_line.discount_line / product_line.quantity if product_line.quantity else 0.0)
        return res

