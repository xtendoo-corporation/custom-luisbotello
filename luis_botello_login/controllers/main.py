from odoo import http
from odoo.http import request
import logging


class LuisAttendanceController(http.Controller):
    @http.route('/luis_botello_login/check_show', type='jsonrpc', auth='user', methods=['POST'])
    def check_show(self):
        """Devuelve si hay que mostrar el wizard y lo elimina de la sesión para
        que solo se muestre una vez.
        """
        show = bool(request.session.pop('luis_show_attendance', False))
        _logger = logging.getLogger(__name__)
        _logger.info('luis_botello_login.check_show called, show=%s, uid=%s', show, request.session.uid)
        return {'show': show}

    @http.route('/luis_botello_login/check_show_simple', type='http', auth='user', methods=['GET'])
    def check_show_simple(self):
        """Versión HTTP simple para ser consultada con fetch/jQuery sin depender de web.rpc.
        Devuelve JSON con {'show': True/False} y borra la marca de sesión.
        """
        show = bool(request.session.pop('luis_show_attendance', False))
        import json
        import logging
        _logger = logging.getLogger(__name__)
        _logger.info('luis_botello_login.check_show_simple called, show=%s, uid=%s', show, request.session.uid)
        action = None
        if show:
            # Try to resolve the employee related to the current user
            employee = None
            try:
                user = request.env.user
                employee = getattr(user, 'employee_id', False) or request.env['hr.employee'].search([('user_id', '=', user.id)], limit=1)
            except Exception:
                employee = None

            # prepare context to inject default employee
            ctx = {}
            if employee:
                ctx['default_employee_id'] = employee.id

            # Create a transient wizard record prefilled and return an action opening that record.
            try:
                Wizard = request.env['luis.attendance.wizard'].sudo()
                wiz_vals = {}
                if employee:
                    wiz_vals['employee_id'] = employee.id
                wiz = Wizard.create(wiz_vals)
                view = request.env.ref('luis_botello_login.view_luis_attendance_wizard_form', raise_if_not_found=False)
                action = {
                    'type': 'ir.actions.act_window',
                    'res_model': 'luis.attendance.wizard',
                    'res_id': int(wiz.id),
                    'name': 'Entrada de asistencia',
                    'views': [[view.id if view else False, 'form']],
                    'view_id': view.id if view else False,
                    'target': 'new',
                    'context': ctx,
                }
            except Exception:
                # fallback: return minimal action dict
                action = {
                    'type': 'ir.actions.act_window',
                    'res_model': 'luis.attendance.wizard',
                    'views': [[False, 'form']],
                    'target': 'new',
                    'context': ctx,
                }

        return request.make_response(json.dumps({'show': show, 'action': action}), headers=[('Content-Type', 'application/json')])
