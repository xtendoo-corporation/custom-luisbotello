from odoo import http
from odoo.http import request

from odoo.addons.pos_conventional_config_user_filter.controllers.main import (
    PosConfigUserFilterController,
)


class PosSlugController(http.Controller):
    @staticmethod
    def _get_pos_conventional_url(pos_config):
        return "/odoo/point-of-sale"

    @http.route("/pos/web/<string:slug>", type="http", auth="user")
    def pos_slug_access(self, slug, **kwargs):
        # Validamos que exista una pos.config con este slug
        pos_config = (
            request.env["pos.config"]
            .sudo()
            .search([("access_slug", "=", slug)], limit=1)
        )

        if not pos_config:
            # Si no existe el slug, mostramos un error amigable
            return _render_error_page(
                "Punto de venta no encontrado",
                f"No existe ningún punto de venta con el identificador '{slug}'",
            )

        # Verificamos que el usuario tenga acceso a esta POS
        if not request.env.user._can_access_pos_config(pos_config):
            return _render_error_page(
                "Acceso denegado",
                f"No tienes permiso para acceder al punto de venta '{pos_config.name}'",
            )

        # Guardamos el slug en la sesión del usuario. Mientras dure la sesión
        # de navegador, PosSlugAccessGuardController impide abrir cualquier
        # otra caja distinta de la aquí fijada, y pos.config._search filtra
        # el listado estándar de cajas para que solo aparezca esta.
        request.session["active_pos_slug"] = slug

        url = self._get_pos_conventional_url(pos_config)
        return request.redirect(url)


class PosSlugAccessGuardController(PosConfigUserFilterController):
    """Fuerza el uso exclusivo de la caja fijada por la URL de slug.

    Mientras ``active_pos_slug`` esté presente en la sesión del usuario
    (ver :class:`PosSlugController`), cualquier intento de abrir la interfaz
    POS (``/pos/ui``, ``/pos/web``) de una caja distinta a la marcada por el
    slug se deniega, y las peticiones sin caja explícita se resuelven
    siempre contra la caja fijada, en vez de recurrir al comportamiento por
    defecto de Odoo (abrir cualquier sesión ya activa del usuario).
    """

    @http.route()
    def pos_web(self, config_id=False, from_backend=False, subpath=None, **k):
        locked_config = self._get_slug_locked_pos_config()
        if locked_config:
            if config_id:
                requested_id = int(config_id) if str(config_id).isdigit() else None
                if requested_id != locked_config.id:
                    return _render_error_page(
                        "Acceso restringido",
                        "Tu acceso está limitado al punto de venta "
                        f"'{locked_config.name}'. Usa el enlace de acceso "
                        "correspondiente para entrar a esa caja.",
                    )
            else:
                config_id = locked_config.id

        return super().pos_web(
            config_id=config_id,
            from_backend=from_backend,
            subpath=subpath,
            **k,
        )

    @staticmethod
    def _get_slug_locked_pos_config():
        slug = request.session.get("active_pos_slug")
        if not slug:
            return None
        return (
            request.env["pos.config"]
            .sudo()
            .search([("access_slug", "=", slug)], limit=1)
            or None
        )


def _render_error_page(title, message):
    """Renderiza una página de error amigable"""
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Error - POS</title>
        <style>
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                    Roboto, "Helvetica Neue", Arial, sans-serif;
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
            <a href="/web#action=point_of_sale.action_pos_config_kanban">
                Volver a POS
            </a>
        </div>
    </body>
    </html>
    """
    headers = [("Content-Type", "text/html; charset=utf-8")]
    return request.make_response(html, headers=headers)
