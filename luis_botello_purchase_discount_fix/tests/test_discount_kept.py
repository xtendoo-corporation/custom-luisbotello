from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestDiscountKept(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': 'Proveedor test'})
        cls.product = cls.env['product.product'].create({
            'name': 'Producto test',
            'seller_ids': [(0, 0, {
                'partner_id': cls.partner.id, 'price': 4.55, 'discount1': 3.0})],
        })
        cls.order = cls.env['purchase.order'].create({
            'partner_id': cls.partner.id,
            'order_line': [(0, 0, {'product_id': cls.product.id, 'product_qty': 80})],
        })
        cls.line = cls.order.order_line

    def _onchange_line(self, vals):
        spec = {'order_line': {'fields': {
            'discount1': {}, 'discount2': {}, 'discount3': {}, 'discount': {},
            'product_qty': {}, 'product_id': {}}}}
        result = self.order.onchange(
            {'id': self.order.id, 'order_line': [(1, self.line.id, vals)]},
            ['order_line'], spec)
        changes = {}
        for command in result.get('value', {}).get('order_line', []):
            if command[0] == 1:
                changes.update(command[2])
        return changes

    def test_seller_discount_applied_on_creation(self):
        self.assertEqual(self.line.discount1, 3.0)

    def test_typed_discount_is_not_reset_by_onchange(self):
        changes = self._onchange_line({'discount1': 15.0})
        self.assertNotIn('discount1', changes)  # no lo devuelve a la tarifa

    def test_typed_discount_is_saved(self):
        self.order.write({'order_line': [(1, self.line.id, {'discount1': 15.0})]})
        self.assertEqual(self.line.discount1, 15.0)
        self.assertAlmostEqual(
            self.line.price_subtotal, 80 * self.line.price_unit * 0.85, 2)
