from odoo.tests import Form, TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestDiscountKept(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': 'Proveedor test'})
        cls.product = cls.env['product.product'].create({
            'name': 'Producto test',
            'seller_ids': [
                (0, 0, {'partner_id': cls.partner.id, 'price': 4.55, 'discount1': 3.0}),
                (0, 0, {'partner_id': cls.partner.id, 'price': 4.0, 'min_qty': 50,
                        'discount1': 8.0}),
            ],
        })

    def _order(self, qty=5):
        return self.env['purchase.order'].create({
            'partner_id': self.partner.id,
            'order_line': [(0, 0, {'product_id': self.product.id, 'product_qty': qty})],
        })

    def test_seller_discount_applied_on_creation(self):
        self.assertEqual(self._order().order_line.discount1, 3.0)

    def test_typed_discount_survives_form_save(self):
        order = self._order()
        with Form(order) as form:
            with form.order_line.edit(0) as line:
                line.discount1 = 17.0
        self.assertEqual(order.order_line.discount1, 17.0)
        with Form(order) as form:  # otro guardado sin tocar el descuento
            with form.order_line.edit(0) as line:
                line.price_unit = 9.0
        self.assertEqual(order.order_line.discount1, 17.0)

    def test_typed_discount_survives_qty_change(self):
        order = self._order()
        order.order_line.discount1 = 17.0
        order.order_line.product_qty = 80
        self.assertEqual(order.order_line.discount1, 17.0)

    def test_typed_discount_on_new_line_in_form(self):
        form = Form(self.env['purchase.order'])
        form.partner_id = self.partner
        with form.order_line.new() as line:
            line.product_id = self.product
            line.product_qty = 5
            line.discount1 = 12.0
        order = form.save()
        self.assertEqual(order.order_line.discount1, 12.0)
