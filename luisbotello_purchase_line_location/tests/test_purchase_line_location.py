from odoo.tests import tagged
from odoo.tests.common import TransactionCase


@tagged('post_install', '-at_install')
class TestPurchaseLineLocation(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.vendor = cls.env['res.partner'].create({'name': 'Vendor Test'})
        cls.product = cls.env['product.product'].create({
            'name': 'Producto Test',
            'is_storable': True,
        })
        cls.env['product.supplierinfo'].create([
            {'partner_id': cls.vendor.id, 'product_tmpl_id': cls.product.product_tmpl_id.id,
             'min_qty': 0, 'price': 100.0, 'discount': 0.0},
            {'partner_id': cls.vendor.id, 'product_tmpl_id': cls.product.product_tmpl_id.id,
             'min_qty': 15, 'price': 100.0, 'discount': 20.0},
        ])
        warehouse = cls.env['stock.warehouse'].search([('company_id', '=', cls.env.company.id)], limit=1)
        cls.loc_a = cls.env['stock.location'].create({
            'name': 'Zona A', 'usage': 'internal', 'location_id': warehouse.lot_stock_id.id})
        cls.loc_b = cls.env['stock.location'].create({
            'name': 'Zona B', 'usage': 'internal', 'location_id': warehouse.lot_stock_id.id})

    def _create_po(self, qtys):
        return self.env['purchase.order'].create({
            'partner_id': self.vendor.id,
            'order_line': [(0, 0, {
                'product_id': self.product.id,
                'product_qty': qty,
                'dest_location_id': loc.id,
            }) for qty, loc in qtys],
        })

    def test_discount_applies_on_total_quantity(self):
        po = self._create_po([(10, self.loc_a), (10, self.loc_b)])
        self.assertEqual(po.order_line.mapped('discount'), [20.0, 20.0])

    def test_no_discount_below_threshold(self):
        po = self._create_po([(5, self.loc_a), (5, self.loc_b)])
        self.assertEqual(po.order_line.mapped('discount'), [0.0, 0.0])

    def test_discount_recomputed_when_quantity_changes(self):
        po = self._create_po([(5, self.loc_a), (5, self.loc_b)])
        po.order_line[1].product_qty = 12
        self.assertEqual(po.order_line.mapped('discount'), [20.0, 20.0])

    def test_move_destination_per_line(self):
        po = self._create_po([(10, self.loc_a), (10, self.loc_b)])
        po.button_confirm()
        moves = po.picking_ids.move_ids
        self.assertEqual(
            {m.purchase_line_id.dest_location_id: m.location_dest_id for m in moves},
            {self.loc_a: self.loc_a, self.loc_b: self.loc_b},
        )
