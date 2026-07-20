from odoo import models, fields, api

class PosOrderLine(models.Model):
    _inherit = 'pos.order.line'

    discount_line = fields.Float(string='Desc. Lin', default=0.0)

    @api.onchange('price_unit', 'tax_ids', 'qty', 'discount', 'product_id', 'discount_line')
    def _onchange_amount_line_all(self):
        for line in self:
            res = line._compute_amount_line_all()
            line.update(res)

    def _compute_amount_line_all(self):
        res = super()._compute_amount_line_all()
        if self.discount_line:
            sign = -1 if self.order_id.is_refund else 1
            fpos = self.order_id.fiscal_position_id
            tax_ids_after_fiscal_position = fpos.map_tax(self.tax_ids)
            # Recompute price considering both percentage discount and fixed discount_line
            price = self.price_unit * (1 - (self.discount or 0.0) / 100.0)
            price = price - (self.discount_line / self.qty if self.qty else 0.0)
            taxes = tax_ids_after_fiscal_position.compute_all(
                price, self.order_id.currency_id, self.qty * sign,
                product=self.product_id, partner=self.order_id.partner_id
            )
            res.update({
                'price_subtotal_incl': taxes['total_included'],
                'price_subtotal': taxes['total_excluded'],
            })
        return res
