from odoo.tests import tagged
from odoo.tests.common import TransactionCase


@tagged('post_install', '-at_install')
class TestOrderpointRounding(TransactionCase):

    def _wizard(self):
        warehouse = self.env['stock.warehouse'].search([('company_id', '=', self.env.company.id)], limit=1)
        return self.env['stock.orderpoint.seasonality.wizard'].new({
            'warehouse_id': warehouse.id, 'max_margin_pct': 50.0,
        })

    def test_rounds_up_to_integers(self):
        self.assertEqual(self._wizard()._compute_suggested_qtys(6, 10.0), (7.0, 10.0))

    def test_exact_values_are_kept(self):
        self.assertEqual(self._wizard()._compute_suggested_qtys(10, 0.0), (10.0, 15.0))

    def test_max_never_below_min(self):
        wiz = self._wizard()
        wiz.max_margin_pct = 0.0
        self.assertEqual(wiz._compute_suggested_qtys(6, 10.0), (7.0, 7.0))

    def test_zero_demand_lines_are_hidden(self):
        warehouse = self.env['stock.warehouse'].search([('company_id', '=', self.env.company.id)], limit=1)
        product = self.env['product.product'].create({'name': 'Sin ventas', 'is_storable': True})
        wizard = self.env['stock.orderpoint.seasonality.wizard'].create({
            'warehouse_id': warehouse.id, 'product_ids': [(6, 0, product.ids)],
            'year_reference': 2020, 'target_year': 2021,
        })
        from odoo.exceptions import UserError
        with self.assertRaises(UserError):
            wizard.action_compute_preview()
        wizard.hide_zero_demand = False
        wizard.action_compute_preview()
        self.assertEqual(len(wizard.line_ids), 12)
