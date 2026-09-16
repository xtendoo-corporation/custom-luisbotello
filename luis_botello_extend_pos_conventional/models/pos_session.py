# -*- coding: utf-8 -*-
from odoo import api, fields, models

from .pos_config import get_pos_locked_slug


class PosSession(models.Model):
    _inherit = "pos.session"

    qty_200 = fields.Integer(string="Cantidad 200€", default=0)
    qty_100 = fields.Integer(string="Cantidad 100€", default=0)
    qty_50 = fields.Integer(string="Cantidad 50€", default=0)
    qty_20 = fields.Integer(string="Cantidad 20€", default=0)
    qty_10 = fields.Integer(string="Cantidad 10€", default=0)
    qty_5 = fields.Integer(string="Cantidad 5€", default=0)
    qty_2 = fields.Integer(string="Cantidad 2€", default=0)
    qty_1 = fields.Integer(string="Cantidad 1€", default=0)
    qty_050 = fields.Integer(string="Cantidad 0,50€", default=0)
    qty_020 = fields.Integer(string="Cantidad 0,20€", default=0)
    qty_010 = fields.Integer(string="Cantidad 0,10€", default=0)
    qty_005 = fields.Integer(string="Cantidad 0,05€", default=0)
    qty_002 = fields.Integer(string="Cantidad 0,02€", default=0)
    qty_001 = fields.Integer(string="Cantidad 0,01€", default=0)

    @api.model
    def _search(self, domain, offset=0, limit=None, order=None, **kwargs):
        # Misma cookie de bloqueo que pos.config._search (ver
        # pos_config.get_pos_locked_slug): mientras el navegador la tenga,
        # las sesiones de otras cajas quedan ocultas aunque el usuario
        # tenga permiso a varias (allowed_pos_config_ids). Se salta en
        # sudo() por el mismo motivo que pos.config (comprobaciones de
        # permisos internas que no deben verse afectadas por la cookie).
        if not self.env.su:
            slug = get_pos_locked_slug()
            if slug:
                domain = [("config_id.access_slug", "=", slug)] + list(domain)
        return super()._search(
            domain, offset=offset, limit=limit, order=order, **kwargs
        )
