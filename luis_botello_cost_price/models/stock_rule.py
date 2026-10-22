from odoo import fields, models


class StockRule(models.Model):
    _inherit = 'stock.rule'

    def _update_purchase_order_line(self, product_id, product_qty, product_uom, company_id, values, line):
        """Al fusionar una necesidad en una línea existente se aplica el mismo
        criterio de precio que al crearla."""
        res = super()._update_purchase_order_line(
            product_id, product_qty, product_uom, company_id, values, line)
        if line._procurement_uses_product_cost(product_id, company_id, values, res.get('price_unit')):
            product_taxes = product_id.supplier_taxes_id.filtered_domain(
                self.env['account.tax']._check_company_domain(company_id))
            res['price_unit'] = line._get_product_cost_price(
                product_id, line.product_uom_id, product_taxes, line.sudo().tax_ids,
                company_id, line.order_id.currency_id, line.order_id.date_order or fields.Date.today())
        return res
