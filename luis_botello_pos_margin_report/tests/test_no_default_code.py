import io
import json

from odoo import http
from odoo.tests import HttpCase, TransactionCase, tagged


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


@tagged('post_install', '-at_install')
class TestUnitCost(TransactionCase):

    def test_unit_cost_field(self):
        field = self.env['report.pos.order']._fields['unit_cost']
        self.assertEqual(field.aggregator, 'avg')
        self.assertEqual(field.string, 'Coste unidad')

    def test_unit_cost_query(self):
        Report = self.env['report.pos.order']
        self.assertIn('unit_cost', Report._select())
        Report.search([], limit=5).read(['unit_cost', 'total_cost', 'product_qty'])


@tagged('post_install', '-at_install')
class TestProductDefaultCode(TransactionCase):

    def test_code_field_and_query(self):
        Report = self.env['report.pos.order']
        self.assertEqual(Report._fields['product_default_code'].string, 'Código de producto')
        self.assertIn('product_default_code', Report._select())
        Report.search([], limit=5).read(['product_default_code', 'product_id'])

    def test_code_column_before_product_in_list(self):
        view = self.env['report.pos.order'].get_view(
            self.env.ref('point_of_sale.report_pos_order_view_tree').id, 'list')
        arch = view['arch']
        self.assertLess(arch.index('product_default_code'), arch.index('"product_id"'))

    def test_analysis_has_list_and_pivot_rows(self):
        action = self.env.ref('point_of_sale.action_report_pos_order_all')
        self.assertIn('list', action.view_mode)
        arch = self.env['report.pos.order'].get_view(
            self.env.ref('point_of_sale.view_report_pos_order_pivot').id, 'pivot')['arch']
        self.assertIn('"product_id"', arch)
        self.assertNotIn('product_default_code', arch)


@tagged('post_install', '-at_install')
class TestPivotExportCode(TransactionCase):

    def _jdata(self, rows, group_bys):
        return {
            'model': 'report.pos.order', 'title': 'T', 'measure_count': 1,
            'row_group_bys': group_bys,
            'col_group_headers': [[{'title': 'Total', 'width': 1, 'height': 1}]],
            'measure_headers': [{'title': 'Coste', 'is_bold': False}],
            'rows': rows,
        }

    def test_code_in_column_a_name_in_b(self):
        from odoo.addons.luis_botello_pos_margin_report.controllers.pivot import (
            add_product_code_column)
        rows = [
            {'title': 'Total', 'indent': 0, 'values': [{'value': 9}]},
            {'title': 'Ibuprofeno', 'indent': 1, 'field': 'product_id',
             'res_id': 7, 'values': [{'value': 5}]},
            {'title': 'REF7', 'indent': 2, 'field': 'product_default_code',
             'res_id': 'REF7', 'values': [{'value': 5}]},
        ]
        res = add_product_code_column(
            self._jdata(rows, ['product_id', 'product_default_code']), {7: 'REF7'})
        self.assertEqual(len(res['rows']), 2)
        self.assertEqual(res['rows'][1]['title'], 'REF7')
        self.assertEqual(res['rows'][1]['values'][0]['value'], '     Ibuprofeno')
        self.assertEqual(res['rows'][1]['values'][1]['value'], 5)
        self.assertEqual(res['rows'][0]['title'], '')
        self.assertEqual(res['measure_headers'][0]['title'], 'Producto')
        self.assertEqual(len(res['col_group_headers'][0]), 2)

    def test_no_product_rows_unchanged(self):
        from odoo.addons.luis_botello_pos_margin_report.controllers.pivot import (
            add_product_code_column)
        jdata = self._jdata(
            [{'title': 'Total', 'indent': 0, 'values': [{'value': 1}]}], [])
        self.assertEqual(add_product_code_column(jdata, {}), jdata)


@tagged('post_install', '-at_install')
class TestPivotExportHttp(HttpCase):

    def test_export_xlsx_columns(self):
        import openpyxl
        self.env['res.users'].create({
            'name': 'Export tester', 'login': 'export_tester',
            'password': 'export_tester_pwd!1',
            'group_ids': [(6, 0, [self.env.ref('base.group_user').id])],
        })
        self.authenticate('export_tester', 'export_tester_pwd!1')
        jdata = {
            'model': 'report.pos.order', 'title': 'Beneficio', 'measure_count': 1,
            'row_group_bys': ['product_id'],
            'col_group_headers': [[{'title': 'Total', 'width': 1, 'height': 1}]],
            'measure_headers': [{'title': 'Coste', 'is_bold': False}],
            'rows': [],
        }
        product = self.env['product.product'].create(
            {'name': 'Prod export', 'default_code': 'EXP01'})
        jdata['rows'] = [
            {'title': 'Total', 'indent': 0, 'values': [{'value': 3}]},
            {'title': 'Prod export', 'indent': 1, 'field': 'product_id',
             'res_id': product.id, 'values': [{'value': 3}]},
        ]
        resp = self.url_open(
            '/web/pivot/export_xlsx', data={'data': json.dumps(jdata), 'csrf_token': http.Request.csrf_token(self)},
            allow_redirects=False)
        self.assertEqual(resp.status_code, 200)
        ws = openpyxl.load_workbook(io.BytesIO(resp.content)).active
        values = [[c.value for c in row] for row in ws.iter_rows()]
        self.assertIn(['EXP01', '     Prod export', 3], [r[:3] for r in values])
        self.assertIn(['Código de producto', 'Producto'], [r[:2] for r in values])


@tagged('post_install', '-at_install')
class TestCodeNotGroupable(TransactionCase):

    def test_code_not_offered_for_grouping(self):
        info = self.env['report.pos.order'].fields_get(['product_default_code'])
        self.assertFalse(info['product_default_code']['groupable'])
        self.assertTrue(self.env['report.pos.order'].fields_get(
            ['product_id'])['product_id']['groupable'])

    def test_no_code_group_filter_in_search(self):
        for xmlid in (
            'point_of_sale.view_report_pos_order_search',
            'luis_botello_pos_margin_report.view_luis_botello_report_pos_order_margin_search',
        ):
            arch = self.env['report.pos.order'].get_view(
                self.env.ref(xmlid).id, 'search')['arch']
            self.assertNotIn("'group_by': 'product_default_code'", arch)
            self.assertNotIn('"group_by": "product_default_code"', arch)
