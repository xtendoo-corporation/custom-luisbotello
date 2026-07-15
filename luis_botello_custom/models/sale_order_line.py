from odoo import models, fields

class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    discount_line = fields.Float(string='Desc. Lin', default=0.0)

    def _prepare_base_line_for_taxes_computation(self, **kwargs):
        res = super()._prepare_base_line_for_taxes_computation(**kwargs)
        if self.discount_line:
            res['price_unit'] = res['price_unit'] - (self.discount_line / self.product_uom_qty if self.product_uom_qty else 0.0)
        return res

    def _prepare_invoice_line(self, **optional_values):
        res = super(SaleOrderLine, self)._prepare_invoice_line(**optional_values)
        res.update({
            'discount_line': self.discount_line,
        })
        return res
