from odoo.tests.common import HttpCase, TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestBillIncident(TransactionCase):

    def test_incident_field_on_vendor_bill(self):
        partner = self.env['res.partner'].create({'name': 'Proveedor test'})
        bill = self.env['account.move'].create({
            'move_type': 'in_invoice',
            'partner_id': partner.id,
            'incidencias': 'Mercancía dañada',
        })
        self.assertEqual(bill.incidencias, 'Mercancía dañada')

    def test_incident_not_copied(self):
        partner = self.env['res.partner'].create({'name': 'Proveedor test'})
        bill = self.env['account.move'].create({
            'move_type': 'in_invoice',
            'partner_id': partner.id,
            'incidencias': 'Falta un bulto',
        })
        self.assertFalse(bill.copy().incidencias)

    def test_field_in_vendor_bill_form(self):
        view = self.env['account.move'].get_view(
            self.env.ref('account.view_move_form').id, 'form')
        self.assertIn('incidencias', view['arch'])


@tagged('post_install', '-at_install')
class TestBillIncidentTour(HttpCase):

    def test_alert_shown_on_open(self):
        self.env['res.users'].create({
            'name': 'Tester incidencias',
            'login': 'incident_tester',
            'password': 'incident_tester',
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.env.ref('account.group_account_manager').id,
            ])],
        })
        partner = self.env['res.partner'].create({'name': 'Proveedor test'})
        bill = self.env['account.move'].create({
            'move_type': 'in_invoice',
            'partner_id': partner.id,
            'incidencias': 'Mercancía dañada',
        })
        self.start_tour(
            '/odoo/action-account.action_move_in_invoice_type/%s' % bill.id,
            'luis_botello_bill_incident_tour', login='incident_tester')
