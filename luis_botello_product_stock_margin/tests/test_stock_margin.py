from odoo.tests import tagged
from odoo.addons.base.tests.common import BaseCommon


@tagged('post_install', '-at_install')
class TestStockMargin(BaseCommon):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.product = cls.env['product.product'].create({
            'name': 'Producto margen',
            'is_storable': True,
            'list_price': 20.0,
            'standard_price': 15.0,
        })

    def test_margin(self):
        tmpl = self.product.product_tmpl_id
        self.assertAlmostEqual(tmpl.margin_amount, 5.0)
        self.assertAlmostEqual(tmpl.margin_percent, 25.0)
        tmpl.list_price = 0.0
        self.assertEqual(tmpl.margin_percent, 0.0)

    def test_stock_by_warehouse_action(self):
        wh = self.env['stock.warehouse'].search([], limit=1)
        self.env['stock.quant'].with_context(inventory_mode=True).create({
            'product_id': self.product.id,
            'location_id': wh.lot_stock_id.id,
            'inventory_quantity': 7.0,
        }).action_apply_inventory()
        action = self.product.product_tmpl_id.action_view_stock_by_warehouse()
        quants = self.env['stock.quant'].search(action['domain'])
        self.assertEqual(sum(quants.mapped('quantity')), 7.0)
        self.assertEqual(quants.warehouse_id, wh)
