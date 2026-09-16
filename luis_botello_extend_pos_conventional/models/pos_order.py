# -*- coding: utf-8 -*-
from odoo import api, fields, models

from .pos_config import get_pos_locked_slug


class PosOrder(models.Model):
	_inherit = 'pos.order'

	pos_config_hide_return = fields.Boolean(
		string='Ocultar botón Devolución (config caja)',
		related='session_id.config_id.hide_return_button',
		readonly=True,
		store=False,
	)

	@api.model
	def _search(self, domain, offset=0, limit=None, order=None, **kwargs):
		# Misma cookie de bloqueo que pos.config._search (ver
		# pos_config.get_pos_locked_slug): mientras el navegador la tenga,
		# los pedidos de otras cajas quedan ocultos aunque el usuario tenga
		# permiso a varias (allowed_pos_config_ids). Se salta en sudo() por
		# el mismo motivo que pos.config (comprobaciones de permisos
		# internas que no deben verse afectadas por la cookie).
		if not self.env.su:
			slug = get_pos_locked_slug()
			if slug:
				domain = [("config_id.access_slug", "=", slug)] + list(domain)
		return super()._search(
			domain, offset=offset, limit=limit, order=order, **kwargs
		)


