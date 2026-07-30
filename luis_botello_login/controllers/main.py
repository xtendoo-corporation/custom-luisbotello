from odoo import http
from odoo.http import request
import logging


class LuisAttendanceController(http.Controller):
    @http.route('/luis_botello_login/check_show', type='jsonrpc', auth='user', methods=['POST'])
    def check_show(self):
        """Devuelve si hay que mostrar el wizard.

        Cambiado: ahora la decisión se basa en si el usuario tiene una asistencia
        abierta (check_out = False). Si NO tiene asistencia abierta, devolverá
        {'show': True} para que el frontend pueda abrir el wizard. No modificamos
        la sesión aquí: la comprobación se realiza cada vez que el frontend la
        solicita, de forma que el wizard seguirá apareciendo hasta que el usuario
        confirme y se cree/cierre la asistencia.
        """
        _logger = logging.getLogger(__name__)
        employee = None
        try:
            user = request.env.user
            employee = getattr(user, 'employee_id', False) or request.env['hr.employee'].sudo().search([('user_id', '=', user.id)], limit=1)
            # Respect the user's preference: if they don't require attendance, don't show
            if getattr(user, 'require_attendance', True) is False:
                show = False
            else:
                show = True
                if employee:
                    # buscar asistencia abierta
                    open_att = request.env['hr.attendance'].sudo().search([('employee_id', '=', employee.id), ('check_out', '=', False)], limit=1)
                    show = not bool(open_att)
        except Exception:
            show = False
        _logger.info('luis_botello_login.check_show called, show=%s, uid=%s', show, request.session.uid)
        return {'show': show}

    @http.route('/luis_botello_login/check_show_simple', type='http', auth='user', methods=['GET'])
    def check_show_simple(self):
        """Versión HTTP simple para ser consultada con fetch/jQuery sin depender de web.rpc.
        Devuelve JSON con {'show': True/False} y borra la marca de sesión.
        """
        # Versión simple: decidir si mostrar el wizard en función de la existencia
        # de una asistencia abierta para el usuario actual.
        import json
        _logger = logging.getLogger(__name__)
        action = None
        employee = None
        try:
            user = request.env.user
            employee = getattr(user, 'employee_id', False) or request.env['hr.employee'].sudo().search([('user_id', '=', user.id)], limit=1)
            # Respect the user's preference: if they don't require attendance, don't show
            if getattr(user, 'require_attendance', True) is False:
                show = False
            else:
                show = True
                if employee:
                    open_att = request.env['hr.attendance'].sudo().search([('employee_id', '=', employee.id), ('check_out', '=', False)], limit=1)
                    show = not bool(open_att)
        except Exception:
            show = False

        _logger.info('luis_botello_login.check_show_simple called, show=%s, uid=%s', show, request.session.uid)

        if show:
            # prepare context to inject default employee
            ctx = {}
            if employee:
                ctx['default_employee_id'] = employee.id
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
                action = {
                    'type': 'ir.actions.act_window',
                    'res_model': 'luis.attendance.wizard',
                    'views': [[False, 'form']],
                    'target': 'new',
                    'context': ctx,
                }

        return request.make_response(json.dumps({'show': show, 'action': action}), headers=[('Content-Type', 'application/json')])
