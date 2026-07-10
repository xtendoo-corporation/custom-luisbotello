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
            'groups_id': [(6, 0, [self.env.ref('sales_team.group_sale_salesman').id,
                                 self.env.ref('base.group_user').id])]
        })

        # Crear un usuario con el grupo de márgenes
        self.user_with_margin = self.env['res.users'].create({
            'name': 'Manager With Margin',
            'login': 'user_with_margin',
            'email': 'user_with_margin@test.com',
            'groups_id': [(6, 0, [self.env.ref('sales_team.group_sale_manager').id,
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

        # Verificar en lista de pos.order
        view = self.env.ref('luis_botello_permisions.view_pos_order_tree_groups')
        self.assertIn('luis_botello_permisions.group_show_margin', view.arch)
