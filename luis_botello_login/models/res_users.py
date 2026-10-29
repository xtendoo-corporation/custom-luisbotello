from odoo import models, fields


class ResUsers(models.Model):
    _inherit = 'res.users'

    require_attendance = fields.Boolean(
        string='Requiere entrada de asistencia',
        help='Si está marcado, al iniciar sesión se requiere que el usuario haga la entrada de asistencia mediante el wizard. '
             'Además, no podrá abrir ni continuar una sesión de TPV sin tener la asistencia abierta.',
        default=True,
    )

    def _attendance_missing(self):
        """Devuelve True si el usuario debe fichar y no tiene una asistencia abierta."""
        self.ensure_one()
        if not self.require_attendance:
            return False
        employee = self.env['hr.employee'].sudo().search([('user_id', '=', self.id)], limit=1)
        if not employee:
            return False
        return not self.env['hr.attendance'].sudo().search_count([
            ('employee_id', '=', employee.id),
            ('check_out', '=', False),
        ])
