from odoo.tests.common import TransactionCase

class TestStockAutomation(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super(TestStockAutomation, cls).setUpClass()
        cls.stock_location = cls.env.ref('stock.stock_location_stock')
        cls.customer_location = cls.env.ref('stock.stock_location_customers')
        cls.picking_type_internal = cls.env.ref('stock.picking_type_internal')

        cls.product = cls.env['product.product'].create({
            'name': 'Test Product',
            'type': 'consu',
        })

    def test_picking_automation_header(self):
        """Test que crea un albarán hijo basado en el tipo de operación de la cabecera."""
        picking = self.env['stock.picking'].create({
            'picking_type_id': self.picking_type_internal.id,
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'next_picking_type_id': self.picking_type_internal.id,
        })
        self.env['stock.move'].create({
            'product_id': self.product.id,
            'product_uom_qty': 10,
            'product_uom': self.product.uom_id.id,
            'picking_id': picking.id,
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
        })
        picking.action_confirm()
        picking.action_assign()
        picking.move_ids.quantity = 10
        picking.button_validate()

        # Verificar que se ha creado un nuevo albarán
        next_picking = self.env['stock.picking'].search([('origin', '=', picking.name)])
        self.assertTrue(next_picking, "Debería haberse creado un albarán hijo")
        self.assertEqual(next_picking.picking_type_id, self.picking_type_internal)
        self.assertEqual(next_picking.move_ids.product_id, self.product)
        self.assertEqual(next_picking.move_ids.product_uom_qty, 10)

    def test_picking_automation_line(self):
        """Test que crea un albarán hijo basado en el tipo de operación de la línea."""
        picking = self.env['stock.picking'].create({
            'picking_type_id': self.picking_type_internal.id,
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
        })
        self.env['stock.move'].create({
            'product_id': self.product.id,
            'product_uom_qty': 5,
            'product_uom': self.product.uom_id.id,
            'picking_id': picking.id,
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'next_picking_type_id': self.picking_type_internal.id,
        })
        picking.action_confirm()
        picking.action_assign()
        picking.move_ids.quantity = 5
        picking.button_validate()

        # Verificar que se ha creado un nuevo albarán
        next_picking = self.env['stock.picking'].search([('origin', '=', picking.name)])
        self.assertTrue(next_picking, "Debería haberse creado un albarán hijo")
        self.assertEqual(next_picking.move_ids.product_uom_qty, 5)

