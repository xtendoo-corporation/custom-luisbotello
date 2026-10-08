from odoo import api, fields, models


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    @api.depends('product_qty', 'product_uom_id', 'company_id', 'order_id.partner_id')
    def _compute_price_unit_and_date_planned_and_name(self):
        # Mismas condiciones que el estándar para recalcular el precio: así no
        # se pisan precios introducidos a mano ni líneas ya facturadas.
        to_cost = self.filtered(
            lambda line: line.product_id
            and not line.invoice_lines
            and line.company_id
            and not self.env.context.get('skip_uom_conversion')
            and line.technical_price_unit == line.price_unit
        )
        super()._compute_price_unit_and_date_planned_and_name()
        for line in to_cost:
            if line.selected_seller_id:
                line._apply_product_cost_price()

    def _apply_product_cost_price(self):
        """Sustituye el precio de la tarifa de proveedor por el coste de la ficha."""
        self.ensure_one()
        product = self.product_id
        po_line_uom = self.product_uom_id or product.uom_id
        price_unit = self.env['account.tax']._fix_tax_included_price_company(
            product.uom_id._compute_price(product.standard_price, po_line_uom),
            product.supplier_taxes_id,
            self.tax_ids,
            self.company_id,
        )
        self.discount = 0.0
        self._reset_price_unit(
            product.cost_currency_id._convert(
                price_unit,
                self.currency_id,
                self.company_id,
                self.date_order or fields.Date.context_today(self),
                False,
            )
        )
