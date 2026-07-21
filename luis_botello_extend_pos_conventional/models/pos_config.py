# -*- coding: utf-8 -*-
from odoo import api, fields, models

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
        help="Si está marcado, se ocultará el botón de devolución en los pedidos de venta en esta caja.",
    )

    def _compute_access_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for config in self:
            if config.access_slug:
                config.access_url = f"{base_url}/pos/web/{config.access_slug}"
            else:
                config.access_url = False

    @api.model
    def _search(self, domain, offset=0, limit=None, order=None, **kwargs):
        from odoo.http import request
        # Si estamos en una petición web y existe el slug activo en la sesión
        if request and hasattr(request, "session") and request.session.get("active_pos_slug"):
            slug = request.session.get("active_pos_slug")
            # Añadimos el filtro por slug al dominio de búsqueda
            domain = [("access_slug", "=", slug)] + list(domain)
        return super()._search(domain, offset=offset, limit=limit, order=order, **kwargs)
