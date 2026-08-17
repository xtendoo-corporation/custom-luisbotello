# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

class PosSlugController(http.Controller):

    @staticmethod
    def _get_pos_ui_url(pos_config):
        return f'/pos/ui/{pos_config.id}'

    @http.route('/pos/web/<string:slug>', type='http', auth="user")
    def pos_slug_access(self, slug, **kwargs):
        # Validamos que exista una pos.config con este slug
        pos_config = request.env['pos.config'].sudo().search(
            [('access_slug', '=', slug)], limit=1
        )
        
        if not pos_config:
            # Si no existe el slug, mostramos un error amigable
            return self._render_error(
                f"Punto de venta no encontrado",
                f"No existe ningún punto de venta con el identificador '{slug}'"
            )
        
        # Verificamos que el usuario tenga acceso a esta POS
        if not request.env.user._can_access_pos_config(pos_config):
            return self._render_error(
                "Acceso denegado",
                f"No tienes permiso para acceder al punto de venta '{pos_config.name}'"
            )
        
        # Guardamos el slug en la sesión del usuario para persistencia
        request.session['active_pos_slug'] = slug

        # Abrimos la UI estándar con la configuración exacta. Redirigir al
        # kanban deja que Odoo escoja la primera caja autorizada.
        url = self._get_pos_ui_url(pos_config)
        return request.redirect(url)
    
    def _render_error(self, title, message):
        """Renderiza una página de error amigable"""
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Error - POS</title>
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    background: #f5f5f5;
                }}
                .error-container {{
                    background: white;
                    padding: 40px;
                    border-radius: 8px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    max-width: 500px;
                    text-align: center;
                }}
                .error-icon {{
                    font-size: 48px;
                    margin-bottom: 20px;
                }}
                h1 {{
                    color: #d32f2f;
                    margin: 0 0 10px 0;
                    font-size: 24px;
                }}
                p {{
                    color: #666;
                    margin: 0 0 20px 0;
                    line-height: 1.5;
                }}
                a {{
                    display: inline-block;
                    padding: 10px 20px;
                    background: #0066cc;
                    color: white;
                    text-decoration: none;
                    border-radius: 4px;
                    transition: background 0.3s;
                }}
                a:hover {{
                    background: #0052a3;
                }}
            </style>
        </head>
        <body>
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <h1>{title}</h1>
                <p>{message}</p>
                <a href="/web#action=point_of_sale.action_pos_config_kanban">Volver a POS</a>
            </div>
        </body>
        </html>
        """
        return request.make_response(html, headers=[('Content-Type', 'text/html; charset=utf-8')])

    @http.route('/pos/web/clear', type='http', auth="user")
    def pos_slug_clear(self, **kwargs):
        # Ruta opcional para limpiar el filtro y ver todas las cajas
        if 'active_pos_slug' in request.session:
            del request.session['active_pos_slug']
        return request.redirect('/web#action=point_of_sale.action_pos_config_kanban')
