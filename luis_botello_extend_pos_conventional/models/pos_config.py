from odoo import api, fields, models

POS_LOCKED_SLUG_COOKIE = "pos_locked_slug"


def get_pos_locked_slug():
    """Slug de la caja bloqueada por cookie en la petición web actual, o
    None si no hay petición web o no hay cookie. Compartido por los
    ``_search`` de pos.config, pos.session y pos.order: los tres deben
    acotarse al mismo slug mientras el navegador tenga la cookie."""
    from odoo.http import request

    if request and hasattr(request, "cookies"):
        return request.cookies.get(POS_LOCKED_SLUG_COOKIE)
    return None


class PosConfig(models.Model):
    _inherit = "pos.config"

    access_slug = fields.Char(
        string="Ruta de acceso personalizada",
        help="Permite filtrar cajas mediante una URL tipo /pos/web/slug",
    )

    access_url = fields.Char(
        string="URL de acceso directo",
        compute="_compute_access_url",
        help="Utilice esta URL para acceder directamente a esta caja filtrada.",
    )

    hide_return_button = fields.Boolean(
        string="Ocultar botón Devolución en pedidos",
        default=False,
        help=(
            "Si está marcado, se ocultará el botón de devolución en los "
            "pedidos de venta en esta caja."
        ),
    )

    def _compute_access_url(self):
        base_url = self.env["ir.config_parameter"].sudo().get_param("web.base.url")
        for config in self:
            if config.access_slug:
                config.access_url = f"{base_url}/pos/web/{config.access_slug}"
            else:
                config.access_url = False

    @api.model
    def _search(self, domain, offset=0, limit=None, order=None, **kwargs):
        # Si estamos en una petición web y el navegador trae la cookie de
        # caja bloqueada (ver PosSlugController/POS_LOCKED_SLUG_COOKIE en
        # luis_botello_extend_pos_conventional/controllers/main.py), la
        # usamos para filtrar. A propósito no se usa request.session: esa
        # cookie es propia del navegador/terminal, no de la sesión de login,
        # así que no se comparte entre dispositivos ni se pierde con logout.
        #
        # Solo se aplica a búsquedas NO sudo (self.env.su es False): son las
        # que hace directamente el cliente web (p. ej. el search_read del
        # kanban de POS) con los permisos del propio usuario, y son las que
        # queremos limitar visualmente a la caja bloqueada.
        #
        # Las búsquedas con sudo() se dejan pasar sin filtrar (igual que
        # hacen las ir.rule nativas de Odoo, que sudo() también salta), a
        # propósito: pos.config._search se invoca también, internamente,
        # dentro de comprobaciones de permisos ajenas a esta funcionalidad
        # (p. ej. leer allowed_pos_config_ids de res.users, que hace sudo()
        # precisamente para obtener la respuesta SIN restricciones). Si
        # filtrásemos también ahí, la cookie de una caja ya bloqueada podría
        # hacer que un usuario con acceso legítimo a otra caja distinta
        # apareciera como "sin permiso" para ella.
        if not self.env.su:
            slug = get_pos_locked_slug()
            if slug:
                # Añadimos el filtro por slug al dominio de búsqueda
                domain = [("access_slug", "=", slug)] + list(domain)
        return super()._search(
            domain, offset=offset, limit=limit, order=order, **kwargs
        )
