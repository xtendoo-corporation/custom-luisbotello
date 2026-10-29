from odoo.exceptions import UserError
from odoo.tests import tagged
from odoo.addons.point_of_sale.tests.common import TestPoSCommon


@tagged('post_install', '-at_install')
class TestPosAttendance(TestPoSCommon):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.config = cls.basic_config
        cls.cashier = cls.env['res.users'].sudo().create({
            'name': 'Cajero',
            'login': 'cajero_att',
            'company_id': cls.config.company_id.id,
            'company_ids': [(6, 0, cls.config.company_id.ids)],
            'group_ids': [(6, 0, [cls.env.ref('point_of_sale.group_pos_user').id])],
        })
        cls.employee = cls.env['hr.employee'].sudo().create({
            'name': 'Cajero', 'user_id': cls.cashier.id,
        })

    def _open(self):
        return self.config.with_user(self.cashier).open_ui()

    def test_blocked_without_attendance(self):
        with self.assertRaises(UserError):
            self.env['pos.session'].with_user(self.cashier).sudo().create({'config_id': self.config.id})

    def test_allowed_with_attendance(self):
        self.env['hr.attendance'].sudo().create({
            'employee_id': self.employee.id,
            'check_in': '2026-10-08 09:00:00',
        })
        session = self.env['pos.session'].with_user(self.cashier).sudo().create({'config_id': self.config.id})
        self.assertTrue(session)

    def test_allowed_if_not_required(self):
        self.cashier.require_attendance = False
        session = self.env['pos.session'].with_user(self.cashier).sudo().create({'config_id': self.config.id})
        self.assertTrue(session)
