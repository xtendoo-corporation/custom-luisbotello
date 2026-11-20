from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestDefaultPrice(TransactionCase):

    def test_default_get_is_zero(self):
        res = self.env['product.template'].default_get(['list_price'])
        self.assertEqual(res['list_price'], 0.0)

    def test_context_default_respected(self):
        res = self.env['product.template'].with_context(
            default_list_price=5.0).default_get(['list_price'])
        self.assertEqual(res['list_price'], 5.0)

    def test_create_without_price(self):
        product = self.env['product.template'].create({'name': 'Nuevo'})
        self.assertEqual(product.list_price, 0.0)

    def test_create_with_price(self):
        product = self.env['product.template'].create(
            {'name': 'Con precio', 'list_price': 12.5})
        self.assertEqual(product.list_price, 12.5)
