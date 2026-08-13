# -*- coding: utf-8 -*-
from odoo.tests.common import TransactionCase
from odoo.exceptions import AccessError

class TestLuisBotelloPermissions(TransactionCase):

    def setUp(self):
        super(TestLuisBotelloPermissions, self).setUp()
        self.group_show_margin = self.env.ref('luis_botello_permisions.group_show_margin')

        # Crear un usuario de ventas sin el grupo de márgenes
        self.user_no_margin = self.env['res.users'].create({
            'name': 'Sales User No Margin',
            'login': 'user_no_margin',
            'email': 'user_no_margin@test.com',
            'group_ids': [(6, 0, [self.env.ref('sales_team.group_sale_salesman').id,
                                 self.env.ref('base.group_user').id])]
        })

        # Crear un usuario con el grupo de márgenes
        self.user_with_margin = self.env['res.users'].create({
            'name': 'Manager With Margin',
            'login': 'user_with_margin',
            'email': 'user_with_margin@test.com',
            'group_ids': [(6, 0, [self.env.ref('sales_team.group_sale_manager').id,
                                 self.env.ref('base.group_user').id,
                                 self.group_show_margin.id])]
        })

    def test_01_group_assignment(self):
        """Test que el grupo existe y se asigna correctamente"""
        self.assertTrue(self.user_with_margin.has_group('luis_botello_permisions.group_show_margin'))
        self.assertFalse(self.user_no_margin.has_group('luis_botello_permisions.group_show_margin'))

    def test_02_view_fields_visibility_logic(self):
        """
        Verifica que los campos sensibles están asociados al grupo en las vistas.
        Nota: Este test verifica la definición en la base de datos de las vistas heredadas.
        """
        # Verificar en sale.order
        view = self.env.ref('luis_botello_permisions.sale_margin_sale_order_groups')
        self.assertIn('luis_botello_permisions.group_show_margin', view.arch)

        # Verificar en product.template
        view = self.env.ref('luis_botello_permisions.product_template_form_view_groups')
        self.assertIn('luis_botello_permisions.group_show_margin', view.arch)

        # Verificar en account.move
        view = self.env.ref('luis_botello_permisions.invoice_margin_form_tree_groups')
        self.assertIn('luis_botello_permisions.group_show_margin', view.arch)

        # Verificar en pos.order
        view = self.env.ref('luis_botello_permisions.view_pos_pos_form_groups')
        self.assertIn('luis_botello_permisions.group_show_margin', view.arch)
        # Verificar que el margen monetario está presente en la cabecera
        self.assertIn('name="margin"', view.arch)

        # Verificar en lista de pos.order
        view = self.env.ref('luis_botello_permisions.view_pos_order_tree_groups')
        self.assertIn('luis_botello_permisions.group_show_margin', view.arch)


class TestWarehouseTransferPermissions(TransactionCase):

    def setUp(self):
        super().setUp()
        self.group_transfer = self.env.ref(
            'luis_botello_permisions.group_warehouse_transfer')
        self.group_transfer_receiver = self.env.ref(
            'luis_botello_permisions.group_warehouse_transfer_receiver')
        self.pt_internal = self.env.ref('stock.picking_type_internal')
        self.pt_in = self.env.ref('stock.picking_type_in')
        self.loc_stock = self.env.ref('stock.stock_location_stock')
        self.loc_suppliers = self.env.ref('stock.stock_location_suppliers')

        # Usuario de inventario SIN permiso de traspasos.
        self.user_stock = self.env['res.users'].create({
            'name': 'Stock User Sin Traspasos',
            'login': 'stock_user_no_transfer',
            'email': 'stock_no_transfer@test.com',
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.env.ref('stock.group_stock_user').id,
            ])],
        })

        # Usuario CON permiso de traspasos entre almacenes.
        self.user_transfer = self.env['res.users'].create({
            'name': 'Stock User Con Traspasos',
            'login': 'stock_user_transfer',
            'email': 'stock_transfer@test.com',
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.group_transfer.id,
            ])],
        })

        # Usuario que puede validar la recepción, pero no crear traspasos.
        self.user_transfer_receiver = self.env['res.users'].create({
            'name': 'Stock User Transfer Receiver',
            'login': 'stock_user_transfer_receiver',
            'email': 'stock_transfer_receiver@test.com',
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.group_transfer_receiver.id,
            ])],
        })

    def _internal_vals(self):
        return {
            'picking_type_id': self.pt_internal.id,
            'location_id': self.loc_stock.id,
            'location_dest_id': self.loc_stock.id,
        }

    def _incoming_vals(self):
        return {
            'picking_type_id': self.pt_in.id,
            'location_id': self.loc_suppliers.id,
            'location_dest_id': self.loc_stock.id,
        }

    def test_10_transfer_group_implies_stock_user(self):
        """El grupo de traspasos implica ser usuario de inventario."""
        self.assertTrue(
            self.user_transfer.has_group('stock.group_stock_user'))
        self.assertTrue(self.user_transfer.has_group(
            'luis_botello_permisions.group_warehouse_transfer'))
        self.assertFalse(self.user_stock.has_group(
            'luis_botello_permisions.group_warehouse_transfer'))

    def test_11_user_without_permission_cannot_create_internal(self):
        """Sin permiso no se puede crear un traspaso interno."""
        with self.assertRaises(AccessError):
            self.env['stock.picking'].with_user(self.user_stock).create(
                self._internal_vals())

    def test_12_user_without_permission_can_create_incoming(self):
        """Sin permiso sí se puede recepcionar (picking de entrada)."""
        picking = self.env['stock.picking'].with_user(self.user_stock).create(
            self._incoming_vals())
        self.assertTrue(picking.exists())
        self.assertEqual(picking.picking_type_id.code, 'incoming')

    def test_13_user_with_permission_can_create_internal(self):
        """Con permiso sí se puede crear un traspaso interno."""
        picking = self.env['stock.picking'].with_user(
            self.user_transfer).create(self._internal_vals())
        self.assertTrue(picking.exists())
        self.assertEqual(picking.picking_type_id.code, 'internal')

    def test_14_user_without_permission_cannot_write_internal(self):
        """Sin permiso no se puede validar/editar un traspaso interno."""
        picking = self.env['stock.picking'].create(self._internal_vals())
        with self.assertRaises(AccessError):
            picking.with_user(self.user_stock).write(
                {'origin': 'bloqueado'})

    def test_15_receiver_can_write_internal_but_cannot_create_it(self):
        """El grupo de recepción valida existentes sin poder crear traspasos."""
        self.assertTrue(self.user_transfer_receiver.has_group(
            'stock.group_stock_user'))
        self.assertTrue(self.user_transfer_receiver.has_group(
            'luis_botello_permisions.group_warehouse_transfer_receiver'))
        self.assertFalse(self.user_transfer_receiver.has_group(
            'luis_botello_permisions.group_warehouse_transfer'))

        with self.assertRaises(AccessError):
            self.env['stock.picking'].with_user(
                self.user_transfer_receiver).create(self._internal_vals())

        picking = self.env['stock.picking'].create(self._internal_vals())
        picking.with_user(self.user_transfer_receiver).write(
            {'origin': 'recepcionado por usuario autorizado'})
        self.assertEqual(
            picking.with_user(self.user_transfer_receiver).origin,
            'recepcionado por usuario autorizado')
