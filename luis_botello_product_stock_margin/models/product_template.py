from odoo import api, fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    margin_amount = fields.Monetary(
        string='Margen',
        compute='_compute_margin',
        currency_field='currency_id',
        help="Precio de venta menos coste.",
    )
    margin_percent = fields.Float(
        string='Margen (%)',
        compute='_compute_margin',
        digits=(16, 2),
        help="Margen sobre el precio de venta: (precio - coste) / precio.",
    )

    @api.depends('list_price', 'standard_price')
    @api.depends_context('company')
    def _compute_margin(self):
        for product in self:
            amount = product.list_price - product.standard_price
            product.margin_amount = amount
            product.margin_percent = (
                amount / product.list_price * 100.0 if product.list_price else 0.0
            )

    def action_view_stock_by_warehouse(self):
        """Stock disponible de las variantes, agrupado por almacén."""
        self.ensure_one()
        action = self.env['ir.actions.act_window']._for_xml_id(
            'luis_botello_product_stock_margin.action_stock_by_warehouse')
        action['domain'] = [
            ('product_tmpl_id', '=', self.id),
            ('location_id.usage', '=', 'internal'),
        ]
        return action
