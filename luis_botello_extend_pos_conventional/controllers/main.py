# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

class PosSlugController(http.Controller):

    @http.route('/pos/web/<string:slug>', type='http', auth="user")
    def pos_slug_access(self, slug, **kwargs):
        # Guardamos el slug en la sesión del usuario para persistencia
        request.session['active_pos_slug'] = slug

        # Redirigimos al tablero de mandos del TPV (Kanban de cajas)
        # La acción estándar es point_of_sale.action_pos_config_kanban
        url = '/web#action=point_of_sale.action_pos_config_kanban'
        return request.redirect(url)

    @http.route('/pos/web/clear', type='http', auth="user")
    def pos_slug_clear(self, **kwargs):
        # Ruta opcional para limpiar el filtro y ver todas las cajas
        if 'active_pos_slug' in request.session:
            del request.session['active_pos_slug']
        return request.redirect('/web#action=point_of_sale.action_pos_config_kanban')

