from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestInventoryHistory(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.warehouse = cls.env['stock.warehouse'].search(
            [('company_id', '=', cls.env.company.id)], limit=1)
        cls.location = cls.warehouse.lot_stock_id
        cls.Quant = cls.env['stock.quant'].with_context(inventory_mode=True)
        cls.product = cls._product('Pastillas dolor de cabeza')
        cls.product_ok = cls._product('Producto sin diferencia')

    @classmethod
    def _product(cls, name):
        return cls.env['product.product'].create({'name': name, 'is_storable': True})

    def _set_stock(self, product, qty):
        quant = self.Quant.create({
            'product_id': product.id, 'location_id': self.location.id,
            'inventory_quantity': qty})
        quant.action_apply_inventory()
        return quant

    def _history(self, product):
        return self.env['stock.inventory.history.line'].search(
            [('product_id', '=', product.id)], order='id desc')

    def test_count_stores_before_and_after(self):
        quant = self._set_stock(self.product, 4)
        quant.inventory_quantity = 2
        quant.action_apply_inventory()
        line = self._history(self.product)[0]
        self.assertEqual(line.theoretical_qty, 4)
        self.assertEqual(line.counted_qty, 2)
        self.assertEqual(line.difference_qty, -2)
        self.assertEqual(line.history_id.warehouse_id, self.warehouse)
        self.assertTrue(line.history_id.name.startswith(
            'INV/%s/' % self.warehouse.code))

    def test_line_without_difference_is_kept(self):
        quant = self._set_stock(self.product_ok, 5)
        quant.inventory_quantity = 5
        quant.action_apply_inventory()
        line = self._history(self.product_ok)[0]
        self.assertEqual(line.difference_qty, 0)
        self.assertEqual(line.history_id.diff_line_count, 0)

    def test_one_document_per_warehouse_per_apply(self):
        q1 = self._set_stock(self.product, 3)
        q2 = self._set_stock(self.product_ok, 3)
        q1.inventory_quantity = 1
        q2.inventory_quantity = 1
        (q1 | q2).action_apply_inventory()
        docs = self._history(self.product)[0].history_id
        self.assertEqual(docs, self._history(self.product_ok)[0].history_id)
        self.assertEqual(docs.line_count, 2)

    def test_stock_user_cannot_edit_history(self):
        user = self.env['res.users'].create({
            'name': 'Almacenero', 'login': 'almacenero_hist',
            'group_ids': [(6, 0, [self.env.ref('stock.group_stock_user').id])],
        })
        quant = self._set_stock(self.product, 1)
        doc = self._history(self.product)[0].history_id
        self.assertTrue(doc.with_user(user).read(['name']))
        from odoo.exceptions import AccessError
        with self.assertRaises(AccessError):
            doc.with_user(user).write({'name': 'x'})
        with self.assertRaises(AccessError):
            self.env['stock.inventory.history'].with_user(user).create({'name': 'x'})
        self.assertTrue(quant)
