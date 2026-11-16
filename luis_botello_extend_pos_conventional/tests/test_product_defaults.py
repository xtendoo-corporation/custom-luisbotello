from odoo.tests.common import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestProductDefaults(TransactionCase):
    def test_new_product_available_in_pos(self):
        product = self.env["product.template"].create({"name": "Test POS default"})
        self.assertTrue(product.available_in_pos)

    def test_explicit_not_available_in_pos_is_respected(self):
        product = self.env["product.template"].create(
            {"name": "Test no POS", "available_in_pos": False}
        )
        self.assertFalse(product.available_in_pos)

    def test_category_defaults_to_all(self):
        all_categ = self.env["product.category"].search(
            [("parent_id", "=", False)], order="id", limit=1
        )
        for vals in ({}, {"categ_id": False}):
            product = self.env["product.template"].create(
                dict(vals, name="Test categ default")
            )
            self.assertEqual(product.categ_id, all_categ)

    def test_explicit_category_is_respected(self):
        categ = self.env["product.category"].create({"name": "Test categ"})
        product = self.env["product.template"].create(
            {"name": "Test categ explicit", "categ_id": categ.id}
        )
        self.assertEqual(product.categ_id, categ)
