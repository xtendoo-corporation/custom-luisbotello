from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase


class TestStockCountAdd(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Session = cls.env["stock.count.add.session"]
        cls.Quant = cls.env["stock.quant"]

        cls.warehouse = cls.env["stock.warehouse"].search([], limit=1)
        cls.loc_a = cls.env.ref("stock.stock_location_stock")
        cls.loc_b = cls.env["stock.location"].create(
            {
                "name": "Zona B (test)",
                "usage": "internal",
                "location_id": cls.loc_a.location_id.id,
            }
        )
        cls.product = cls.env["product.product"].create(
            {
                "name": "Producto conteo aditivo",
                "type": "consu",
                "is_storable": True,
                "barcode": "TEST-CNT-001",
            }
        )
        cls.product_lot = cls.env["product.product"].create(
            {
                "name": "Producto con lote",
                "type": "consu",
                "is_storable": True,
                "tracking": "lot",
            }
        )
        cls.lot = cls.env["stock.lot"].create(
            {"name": "LOT-A", "product_id": cls.product_lot.id}
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _add(self, session, product, location=None, qty=1.0, lot=None):
        session.write(
            {
                "location_id": (location or self.loc_a).id,
                "product_id": product.id,
                "lot_id": lot.id if lot else False,
                "qty": qty,
            }
        )
        session.action_confirm()

    def _counted(self, product, location, lot=None):
        quant = (
            self.Quant.with_context(inventory_mode=True)
            ._gather(product, location, lot_id=lot, strict=True)[:1]
        )
        return quant

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------
    def test_same_session_accumulates(self):
        """Dos entradas A/U de 10 en la misma sesión -> contado 20."""
        session = self.Session.create({"location_id": self.loc_a.id})
        self._add(session, self.product, qty=10.0)
        self._add(session, self.product, qty=10.0)
        quant = self._counted(self.product, self.loc_a)
        self.assertEqual(quant.inventory_quantity, 20.0)
        self.assertTrue(quant.inventory_quantity_set)

    def test_new_session_fixes_not_accumulate(self):
        """Una sesión nueva FIJA (no suma sobre conteos no aplicados previos)."""
        session1 = self.Session.create({"location_id": self.loc_a.id})
        self._add(session1, self.product, qty=10.0)
        self._add(session1, self.product, qty=10.0)
        quant = self._counted(self.product, self.loc_a)
        self.assertEqual(quant.inventory_quantity, 20.0)

        session2 = self.Session.create({"location_id": self.loc_a.id})
        self._add(session2, self.product, qty=5.0)
        quant = self._counted(self.product, self.loc_a)
        self.assertEqual(
            quant.inventory_quantity,
            5.0,
            "Una sesión nueva debe FIJAR, descartando el contado previo.",
        )

    def test_preexisting_set_line_is_fixed(self):
        """Línea contada y sin aplicar (set=True) preexistente -> primer toque FIJA."""
        seed = self.Quant.with_context(inventory_mode=True).create(
            {
                "product_id": self.product.id,
                "location_id": self.loc_a.id,
                "inventory_quantity": 99.0,
            }
        )
        self.assertTrue(seed.inventory_quantity_set)

        session = self.Session.create({"location_id": self.loc_a.id})
        self._add(session, self.product, qty=7.0)
        quant = self._counted(self.product, self.loc_a)
        self.assertEqual(
            quant.inventory_quantity,
            7.0,
            "El primer toque de una sesión nueva descarta el valor obsoleto.",
        )

    def test_lot_and_multi_location(self):
        """Respeta lotes y multiubicación: quants independientes por ubicación."""
        session = self.Session.create({"location_id": self.loc_a.id})
        self._add(session, self.product_lot, location=self.loc_a, qty=3.0,
                  lot=self.lot)
        self._add(session, self.product_lot, location=self.loc_a, qty=2.0,
                  lot=self.lot)
        self._add(session, self.product_lot, location=self.loc_b, qty=4.0,
                  lot=self.lot)

        quant_a = self._counted(self.product_lot, self.loc_a, lot=self.lot)
        quant_b = self._counted(self.product_lot, self.loc_b, lot=self.lot)
        self.assertEqual(quant_a.inventory_quantity, 5.0)
        self.assertEqual(quant_b.inventory_quantity, 4.0)

    def test_on_hand_not_changed_until_apply(self):
        """quantity (on-hand) NO cambia hasta que el usuario aplica."""
        session = self.Session.create({"location_id": self.loc_a.id})
        self._add(session, self.product, qty=15.0)
        quant = self._counted(self.product, self.loc_a)
        self.assertEqual(quant.quantity, 0.0)
        self.assertEqual(quant.inventory_quantity, 15.0)

        quant.with_context(inventory_mode=True).action_apply_inventory()
        self.assertEqual(quant.quantity, 15.0)
        self.assertFalse(quant.inventory_quantity_set)

    def test_barcode_resolves_product(self):
        """El onchange de barcode resuelve el producto y limpia el código."""
        session = self.Session.new({"location_id": self.loc_a.id})
        session.barcode = "TEST-CNT-001"
        session._onchange_barcode()
        self.assertEqual(session.product_id, self.product)
        self.assertFalse(session.barcode)

    def test_confirm_requires_product(self):
        """Confirmar sin producto lanza error controlado."""
        session = self.Session.create({"location_id": self.loc_a.id})
        with self.assertRaises(UserError):
            session.action_confirm()

    def test_lot_required_for_tracked_product(self):
        """Producto con lote exige lote al confirmar."""
        session = self.Session.create({"location_id": self.loc_a.id})
        session.write({"product_id": self.product_lot.id, "qty": 1.0})
        with self.assertRaises(UserError):
            session.action_confirm()

    def test_finish_uses_product_first_view(self):
        """Finalizar abre el inventario físico con la vista producto-primero."""
        session = self.Session.create({"location_id": self.loc_a.id})
        self._add(session, self.product, qty=1.0)
        action = session.action_finish()
        self.assertEqual(action["res_model"], "stock.quant")
        view = self.env.ref(
            "luis_botello_stock_count_add.view_stock_quant_tree_count_add"
        )
        self.assertEqual(action["views"], [(view.id, "list")])

    def test_summed_message_shows_total(self):
        """Al sumar, el aviso muestra existían + encontradas = total."""
        session = self.Session.create({"location_id": self.loc_a.id})
        self._add(session, self.product, qty=10.0)
        self.assertIn("FIJADA", session.last_message)
        self._add(session, self.product, qty=10.0)
        self.assertIn("SUMARON", session.last_message)
        self.assertIn("existían 10", session.last_message)
        self.assertIn("encontradas 10", session.last_message)
        self.assertIn("20", session.last_message)

    def test_confirm_reopens_and_clears_inputs(self):
        """Confirmar reabre el mismo registro y limpia solo los campos de entrada."""
        session = self.Session.create({"location_id": self.loc_a.id})
        self._add(session, self.product, qty=1.0)
        action = session._reopen_action()
        self.assertEqual(action["res_id"], session.id)
        self.assertFalse(session.product_id)
        self.assertEqual(session.qty, 1.0)
        self.assertEqual(session.location_id, self.loc_a)
        self.assertTrue(session.touched_quant_ids)
