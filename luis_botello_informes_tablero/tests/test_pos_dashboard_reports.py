from odoo.tests.common import TransactionCase, tagged
@tagged('luis_botello_informes_tablero', 'post_install', '-at_install')
class TestLuisBotelloPosDashboardReports(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.daily_action = cls.env.ref('luis_botello_informes_tablero.action_luis_botello_pos_daily_report')
        cls.hourly_action = cls.env.ref('luis_botello_informes_tablero.action_luis_botello_pos_hourly_report')
        cls.dashboard_menu = cls.env.ref('luis_botello_informes_tablero.menu_luis_botello_tableros_root')
        cls.dashboard_group = cls.env.ref('luis_botello_informes_tablero.spreadsheet_dashboard_group_luis_botello_pos')
        cls.daily_dashboard = cls.env.ref('luis_botello_informes_tablero.spreadsheet_dashboard_luis_botello_pos_daily')
        cls.hourly_dashboard = cls.env.ref('luis_botello_informes_tablero.spreadsheet_dashboard_luis_botello_pos_hourly')

    def test_01_actions_are_available(self):
        self.assertEqual(self.daily_action.res_model, 'luis.botello.pos.daily.report')
        self.assertEqual(self.hourly_action.res_model, 'luis.botello.pos.hourly.report')
        self.assertIn('pivot', self.daily_action.view_mode)
        self.assertIn('graph', self.hourly_action.view_mode)

    def test_02_reports_are_queryable(self):
        self.env['luis.botello.pos.daily.report'].search([], limit=1)
        self.env['luis.botello.pos.hourly.report'].search([], limit=1)
        self.assertTrue(self.dashboard_menu.exists())

    def test_03_spreadsheet_dashboards_are_published(self):
        self.assertEqual(self.dashboard_group.name, 'Punto de venta')
        self.assertTrue(self.daily_dashboard.is_published)
        self.assertTrue(self.hourly_dashboard.is_published)
        self.assertIn(self.daily_dashboard, self.dashboard_group.dashboard_ids)
        self.assertIn(self.hourly_dashboard, self.dashboard_group.dashboard_ids)

    def test_04_hourly_report_action_is_still_available(self):
        self.assertEqual(self.hourly_action.res_model, 'luis.botello.pos.hourly.report')

