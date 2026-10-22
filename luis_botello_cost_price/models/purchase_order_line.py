from odoo import api, fields, models
from odoo.tools import float_compare, formatLang


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
            # Reposición con tarifa de proveedor con precio: se deja el de la
            # tarifa que ya ha puesto el estándar.
            if line._is_replenishment_line() and line._keep_vendor_price(line.selected_seller_id.price):
                continue
            # Sin tarifa de proveedor el estándar ya usa el coste de la ficha;
            # con coste fijo hay que aplicarlo siempre.
            if line.selected_seller_id or line.product_id.fixed_cost:
                line._apply_product_cost_price()

    def _is_replenishment_line(self):
        """Línea generada por reposición (regla de stock o bajo pedido)."""
        self.ensure_one()
        return bool(self.orderpoint_id or self.move_dest_ids)

    def _keep_vendor_price(self, vendor_price):
        """En reposición, si el producto tiene coste fijo y la tarifa del
        proveedor tiene precio, se respeta el de la tarifa."""
        self.ensure_one()
        return bool(self.product_id.with_company(self.company_id).fixed_cost and vendor_price)

    def _apply_product_cost_price(self):
        """Sustituye el precio de la tarifa de proveedor por el coste fijo o,
        si no tiene, por el coste de la ficha."""
        self.ensure_one()
        self.discount = self.selected_seller_id.discount or 0.0
        self._reset_price_unit(self._get_product_cost_price(
            self.product_id,
            self.product_uom_id,
            self.product_id.supplier_taxes_id,
            self.tax_ids,
            self.company_id,
            self.currency_id,
            self.date_order or fields.Date.context_today(self),
        ))

    @api.model
    def _get_product_cost_price(self, product, uom, product_taxes, taxes, company, currency, date):
        """Coste fijo (o coste de la ficha) en la UdM y moneda de la línea,
        redondeado a los decimales de la moneda (el coste medio puede traer
        muchos más)."""
        product = product.with_company(company)
        cost = product.fixed_cost or product.standard_price
        price_unit = self.env['account.tax']._fix_tax_included_price_company(
            product.uom_id._compute_price(cost, uom or product.uom_id),
            product_taxes,
            taxes,
            company,
        )
        price_unit = product.cost_currency_id._convert(price_unit, currency, company, date, False)
        return currency.round(price_unit)

    @api.onchange('price_unit')
    def _onchange_price_unit_fixed_cost(self):
        """Aviso (notificación) si el precio introducido supera el coste fijo."""
        product = self.product_id.with_company(self.company_id)
        if not product.fixed_cost or self.display_type or not self.currency_id:
            return
        fixed_price = self._get_product_cost_price(
            product,
            self.product_uom_id,
            product.supplier_taxes_id._filter_taxes_by_company(self.company_id),
            self.tax_ids,
            self.company_id,
            self.currency_id,
            self.date_order or fields.Date.context_today(self),
        )
        if float_compare(self.price_unit, fixed_price, precision_rounding=self.currency_id.rounding) <= 0:
            return
        return {
            'warning': {
                'type': 'notification',
                'title': self.env._("Coste superior al coste fijo"),
                'message': self.env._(
                    "El coste de %(product)s (%(price)s) es superior a su coste fijo (%(fixed)s).",
                    product=product.display_name,
                    price=formatLang(self.env, self.price_unit, currency_obj=self.currency_id),
                    fixed=formatLang(self.env, fixed_price, currency_obj=self.currency_id),
                ),
            },
        }

    def _prepare_purchase_order_line_from_procurement(
            self, product_id, product_qty, product_uom, location_dest_id, name, origin,
            company_id, values, po):
        """Líneas creadas por el planificador: coste de la ficha, o coste fijo
        si la tarifa del proveedor no tiene precio."""
        res = super()._prepare_purchase_order_line_from_procurement(
            product_id, product_qty, product_uom, location_dest_id, name, origin,
            company_id, values, po)
        if self._procurement_uses_product_cost(product_id, company_id, values, res.get('price_unit')):
            uom = self.env['uom.uom'].browse(res['product_uom_id'])
            product_taxes = product_id.supplier_taxes_id.filtered_domain(
                self.env['account.tax']._check_company_domain(company_id))
            taxes = self.env['account.tax'].browse(res['tax_ids'][0][2]) if res.get('tax_ids') else product_taxes
            res['price_unit'] = self._get_product_cost_price(
                product_id, uom, product_taxes, taxes, company_id, po.currency_id,
                po.date_order or fields.Date.context_today(self))
        return res

    @api.model
    def _procurement_uses_product_cost(self, product, company, values, vendor_price):
        """En reposición: con coste fijo solo se usa si la tarifa del proveedor
        no tiene precio; sin coste fijo, el coste de la ficha sustituye al de
        la tarifa (si lo tiene)."""
        if not values.get('supplier'):
            return False
        if product.with_company(company).fixed_cost:
            return not vendor_price
        return bool(vendor_price)
