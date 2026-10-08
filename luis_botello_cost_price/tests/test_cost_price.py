from odoo.tests import Form, tagged
from odoo.addons.base.tests.common import BaseCommon


@tagged('post_install', '-at_install')
class TestPurchaseCostPrice(BaseCommon):

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

    def test_cost_price_instead_of_vendor_price(self):
        line = self._new_line()
        self.assertEqual(line.price_unit, 12.0)
        self.assertEqual(line.discount, 0.0)

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
