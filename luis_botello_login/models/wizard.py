from odoo import models, fields, api
from odoo import fields as odoo_fields
from odoo.http import request
import logging


class LuisAttendanceWizard(models.TransientModel):
    _name = 'luis.attendance.wizard'
    _description = 'Wizard para entrada de asistencia'

    message = fields.Char(string='Mensaje', default='Realiza la entrada de asistencia')
    employee_id = fields.Many2one('hr.employee', string='Empleado', readonly=True)
    ts = fields.Datetime(string='Fecha y hora', default=odoo_fields.Datetime.now, readonly=True)

    @api.model
    def _get_employee_for_user(self, user):
        # Try common relations: user.employee_id or hr.employee with user_id
        employee = getattr(user, 'employee_id', False)
        if employee:
            return employee
        return self.env['hr.employee'].search([('user_id', '=', user.id)], limit=1)

    def action_confirm(self):
        """Create or close an attendance record for the current user.

        Behavior:
        - If the current user has an associated employee, search for an open attendance
          (check_out = False). If found, set check_out to now (sign out).
        - Otherwise, create a new attendance (sign in) with check_in = now.
        - Operations are performed with sudo() to avoid access rights issues for users
          that don't have HR attendance groups, but we only modify hr.attendance.
        - If no employee is found, display a notification (no attendance recorded).
        """
        _logger = logging.getLogger(__name__)
        user = self.env.user
        _logger.info('luis_botello_login.wizard action_confirm called by uid=%s, wizard_ids=%s', user.id, self.ids)
        # prefer employee set on wizard (via context), otherwise resolve from user
        employee = self.employee_id or self._get_employee_for_user(user)
        if not employee:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': 'No asociado a empleado',
                    'message': 'No se ha encontrado un empleado asociado al usuario. No se ha registrado asistencia.',
                    'sticky': False,
                }
            }

        Attendance = self.env['hr.attendance'].sudo()
        # try to collect request info (ip, browser) if available
        ip = None
        browser = None
        try:
            if request and request.httprequest:
                ip = request.httprequest.remote_addr
                browser = request.httprequest.user_agent.string
        except Exception:
            ip = None
            browser = None

        # buscar asistencia abierta
        open_att = Attendance.search([('employee_id', '=', employee.id), ('check_out', '=', False)], order='check_in desc', limit=1)
        if open_att:
            # registrar salida
            vals = {'check_out': odoo_fields.Datetime.now(), 'out_mode': 'manual'}
            if ip:
                vals['out_ip_address'] = str(ip)
            if browser:
                vals['out_browser'] = str(browser)
            open_att.sudo().write(vals)
            _logger.info('luis_botello_login.wizard action_confirm: closed attendance for employee %s, attendance id %s', employee.id, open_att.id)
            return {'type': 'ir.actions.act_window_close'}
        else:
            # crear entrada
            vals = {'employee_id': employee.id, 'check_in': odoo_fields.Datetime.now(), 'in_mode': 'manual'}
            if ip:
                vals['in_ip_address'] = str(ip)
            if browser:
                vals['in_browser'] = str(browser)
            att = Attendance.create(vals)
            _logger.info('luis_botello_login.wizard action_confirm: created attendance id %s for employee %s', att.id, employee.id)
            return {'type': 'ir.actions.act_window_close'}

