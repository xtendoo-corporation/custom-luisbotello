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

    def test_margin_restricted_to_margin_group(self):
        """El margen deja deducir el coste: solo para «Mostrar Márgenes y Costes»."""
        group = 'luis_botello_permisions.group_show_margin'
        fields_ = self.env['product.template']._fields
        self.assertEqual(fields_['margin_amount'].groups, group)
        self.assertEqual(fields_['margin_percent'].groups, group)
        view = self.env.ref(
            'luis_botello_product_stock_margin.product_template_form_view_margin')
        self.assertIn(group, view.arch_db)
