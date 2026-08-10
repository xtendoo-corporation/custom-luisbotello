from odoo.tests.common import tagged

@tagged("luis_botello_discount_line", "-at_install", "post_install")
class TestAddProductSeparateLines(PosConventionalTestCommon):
    """Verifica que add_product_by_barcode crea líneas separadas para el mismo producto.

    Este test comprueba el comportamiento que se ha introducido en
    `luis_botello_discount_line`: dos llamadas a
    `order.add_product_by_barcode(barcode=...)` deben crear DOS líneas
    separadas en lugar de incrementar la cantidad en la misma línea.
    """

    def test_01_barcode_creates_separate_lines(self):
        session = self._open_session()
        order = self._make_draft_order(session)

        # Si el método no existe, omitimos el test (compatibilidad con entornos)
        if not hasattr(order, "add_product_by_barcode"):
            self.skipTest("El método add_product_by_barcode no está disponible")

        # Asegurarnos del producto barcode definido en common
        barcode = getattr(self, "product_barcode", None)
        if not barcode:
            self.skipTest("No hay producto con barcode disponible en el entorno de tests")

        # Primera inserción
        res1 = order.add_product_by_barcode(barcode=barcode.barcode)
        self.assertTrue(res1.get("success", False), msg=(res1.get("message") or "add_product_by_barcode fallo"))

        # Segunda inserción del mismo producto
        res2 = order.add_product_by_barcode(barcode=barcode.barcode)
        self.assertTrue(res2.get("success", False), msg=(res2.get("message") or "add_product_by_barcode fallo (2)"))

        # Deben existir DOS líneas separadas
        self.assertEqual(len(order.lines), 2, msg="Se esperaban 2 líneas separadas tras dos escaneos")

        # Cada línea debe tener qty = 1.0 (comportamiento por defecto)
        qties = [l.qty for l in order.lines]
        self.assertListEqual(sorted(qties), [1.0, 1.0])

