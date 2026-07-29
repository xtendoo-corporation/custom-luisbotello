import logging

from odoo import http
from odoo.http import request
import odoo.addons.web.controllers.home as web_home

_logger = logging.getLogger(__name__)


class Home(web_home.Home):
    @http.route()
    def web_login(self, redirect=None, **kw):
        """Extiende el comportamiento de /web/login para marcar en la sesión
        que, tras un inicio de sesión correcto, debe mostrarse el wizard.
        """
        response = super().web_login(redirect=redirect, **kw)
        try:
            if request.httprequest.method == 'POST' and request.session.uid and request.params.get('login_success'):
                # Marcar la sesión para que el webclient muestre el wizard una sola vez
                request.session['luis_show_attendance'] = True
        except Exception:
            _logger.exception('Error marcando la sesión para mostrar el wizard')
        return response

