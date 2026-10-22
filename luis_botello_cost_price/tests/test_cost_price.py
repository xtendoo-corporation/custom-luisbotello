from odoo.tests import Form, tagged
from odoo.addons.base.tests.common import BaseCommon


class PurchaseCostPriceCommon(BaseCommon):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.vendor = cls.env['res.partner'].create({'name': 'Proveedor Test'})
        cls.product = cls.env['product.product'].create({
            'name': 'Producto Test',
            'standard_price': 12.0,
            'seller_ids': [(0, 0, {
                'partner_id': cls.vendor.id,
                'price': 20.0,
                'discount': 10.0,
            })],
        })

    def _new_line(self, product=None):
        po = Form(self.env['purchase.order'])
        po.partner_id = self.vendor
        with po.order_line.new() as line:
            line.product_id = product or self.product
        return po.save().order_line

    def _procure(self, seller_price):
        """Lanza una regla de reabastecimiento y devuelve la línea de compra."""
        self.product.write({'is_storable': True, 'standard_price': 8.123456})
        self.product.seller_ids.write({'price': seller_price})
        buy = self.env['stock.route'].search([('rule_ids.action', '=', 'buy')], limit=1)
        self.product.route_ids = [(4, buy.id)]
        warehouse = self.env['stock.warehouse'].search([('company_id', '=', self.env.company.id)], limit=1)
        orderpoint = self.env['stock.warehouse.orderpoint'].create({
            'product_id': self.product.id,
            'warehouse_id': warehouse.id,
            'location_id': warehouse.lot_stock_id.id,
            'product_min_qty': 5,
            'product_max_qty': 20,
            'trigger': 'auto',
        })
        orderpoint._procure_orderpoint_confirm()
        line = self.env['purchase.order.line'].search([('orderpoint_id', '=', orderpoint.id)])
        self.assertTrue(line)
        self.assertEqual(line.discount, 10.0)
        return line


@tagged('post_install', '-at_install')
class TestPurchaseCostPrice(PurchaseCostPriceCommon):

    def test_cost_price_instead_of_vendor_price(self):
        line = self._new_line()
        self.assertEqual(line.price_unit, 12.0)
        # el descuento sigue siendo el del tramo del proveedor
        self.assertEqual(line.discount, 10.0)

    def test_cost_price_rounded_to_currency(self):
        self.product.standard_price = 8.123456
        self.assertEqual(self._new_line().price_unit, 8.12)
        self.product.standard_price = 8.126
        self.assertEqual(self._new_line().price_unit, 8.13)

    def test_cost_price_follows_cost_change(self):
        self.product.standard_price = 15.0
        self.assertEqual(self._new_line().price_unit, 15.0)

    def test_manual_price_is_kept(self):
        po = Form(self.env['purchase.order'])
        po.partner_id = self.vendor
        with po.order_line.new() as line:
            line.product_id = self.product
            line.price_unit = 99.0
        line = po.save().order_line
        self.assertEqual(line.price_unit, 99.0)
        line.product_qty = 5
        self.assertEqual(line.price_unit, 99.0)

    def test_product_without_seller(self):
        product = self.env['product.product'].create({
            'name': 'Sin proveedor', 'standard_price': 7.0,
        })
        self.assertEqual(self._new_line(product).price_unit, 7.0)

    def test_procurement_line_uses_cost_price(self):
        """Las compras del planificador también usan el coste de la ficha."""
        self.assertEqual(self._procure(8.0).price_unit, 8.12)


@tagged('post_install', '-at_install')
class TestPurchaseFixedCost(PurchaseCostPriceCommon):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.product.fixed_cost = 10.0

    def test_fixed_cost_instead_of_cost_and_vendor_price(self):
        line = self._new_line()
        self.assertEqual(line.price_unit, 10.0)
        # el descuento sigue siendo el del tramo del proveedor
        self.assertEqual(line.discount, 10.0)
        line.product_qty = 5
        self.assertEqual(line.price_unit, 10.0)

    def test_fixed_cost_product_without_seller(self):
        product = self.env['product.product'].create({
            'name': 'Sin proveedor', 'standard_price': 7.0, 'fixed_cost': 6.5,
        })
        line = self._new_line(product)
        self.assertEqual(line.price_unit, 6.5)
        self.assertEqual(line.discount, 0.0)

    def test_without_fixed_cost_uses_product_cost(self):
        self.product.fixed_cost = 0.0
        self.assertEqual(self._new_line().price_unit, 12.0)

    def test_manual_price_is_kept_with_fixed_cost(self):
        po = Form(self.env['purchase.order'])
        po.partner_id = self.vendor
        with po.order_line.new() as line:
            line.product_id = self.product
            line.price_unit = 11.0
        line = po.save().order_line
        self.assertEqual(line.price_unit, 11.0)
        line.product_qty = 5
        self.assertEqual(line.price_unit, 11.0)

    def test_procurement_line_respects_vendor_price(self):
        """En reposición se respeta el precio de la tarifa del proveedor."""
        line = self._procure(8.0)
        self.assertEqual(line.price_unit, 8.0)
        line.product_qty += 1
        self.assertEqual(line.price_unit, 8.0)

    def test_procurement_line_uses_fixed_cost_seller_without_price(self):
        """Si la tarifa del proveedor no tiene precio, se usa el coste fijo."""
        line = self._procure(0.0)
        self.assertEqual(line.price_unit, 10.0)
        line.product_qty += 1
        self.assertEqual(line.price_unit, 10.0)

    def test_fixed_cost_per_variant(self):
        size = self.env['product.attribute'].create({
            'name': 'Talla',
            'value_ids': [(0, 0, {'name': 'S'}), (0, 0, {'name': 'L'})],
        })
        template = self.env['product.template'].create({
            'name': 'Con variantes',
            'standard_price': 12.0,
            'attribute_line_ids': [(0, 0, {
                'attribute_id': size.id,
                'value_ids': [(6, 0, size.value_ids.ids)],
            })],
        })
        small, large = template.product_variant_ids
        small.fixed_cost = 5.0
        large.fixed_cost = 7.0
        self.assertEqual(self._new_line(small).price_unit, 5.0)
        self.assertEqual(self._new_line(large).price_unit, 7.0)

    def test_fixed_cost_template_single_variant(self):
        template = self.env['product.template'].create({'name': 'Simple', 'fixed_cost': 4.0})
        self.assertEqual(template.product_variant_id.fixed_cost, 4.0)
        template.fixed_cost = 4.5
        self.assertEqual(template.product_variant_id.fixed_cost, 4.5)
        self.assertEqual(self._new_line(template.product_variant_id).price_unit, 4.5)

    def test_warning_when_price_above_fixed_cost(self):
        line = self._new_line()
        line.price_unit = 10.5
        warning = line._onchange_price_unit_fixed_cost()['warning']
        self.assertEqual(warning['type'], 'notification')
        self.assertIn(self.product.display_name, warning['message'])

    def test_no_warning_when_price_not_above_fixed_cost(self):
        line = self._new_line()
        self.assertFalse(line._onchange_price_unit_fixed_cost())
        line.price_unit = 9.0
        self.assertFalse(line._onchange_price_unit_fixed_cost())
        self.product.fixed_cost = 0.0
        line.price_unit = 50.0
        self.assertFalse(line._onchange_price_unit_fixed_cost())
