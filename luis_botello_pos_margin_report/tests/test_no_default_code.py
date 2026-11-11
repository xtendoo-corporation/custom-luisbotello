from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestNoDefaultCode(TransactionCase):

    def test_actions_hide_default_code(self):
        for xmlid in (
            'point_of_sale.action_report_pos_order_all',
            'point_of_sale.action_report_pos_order_all_filtered',
            'luis_botello_pos_margin_report.action_luis_botello_pos_margin_report',
        ):
            action = self.env.ref(xmlid)
            self.assertIn('display_default_code', action.context, xmlid)

    def test_display_name_without_code(self):
        product = self.env['product.product'].create({
            'name': 'Producto test', 'default_code': 'REF01'})
        self.assertEqual(
            product.with_context(display_default_code=False).display_name,
            'Producto test')

    def test_read_group_by_product_without_code(self):
        product = self.env['product.product'].create({
            'name': 'Producto test', 'default_code': 'REF01'})
        Report = self.env['report.pos.order']
        for method in ('formatted_read_group', 'web_read_group'):
            Report.with_context(display_default_code=True)
            self.assertTrue(hasattr(Report, method))
        self.assertEqual(
            product.with_context(display_default_code=True).display_name,
            '[REF01] Producto test')
