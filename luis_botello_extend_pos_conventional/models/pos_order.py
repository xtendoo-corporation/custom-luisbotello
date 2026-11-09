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

	payment_method_names = fields.Char(
		string='Método de pago',
		compute='_compute_payment_method_names',
	)

	@api.depends('payment_ids.payment_method_id')
	def _compute_payment_method_names(self):
		for order in self:
			order.payment_method_names = ', '.join(
				order.payment_ids.payment_method_id.mapped('name')
			)

	@api.model
	def _get_view(self, view_id=None, view_type='form', **options):
		# Hace que todas las columnas de la lista de pedidos se puedan
		# mostrar/ocultar desde el selector de columnas. Se hace sobre la
		# vista ya combinada para cubrir también las columnas añadidas por
		# otros módulos. Las que ya traen `optional` (show/hide) se respetan.
		arch, view = super()._get_view(view_id, view_type, **options)
		if view_type == 'list':
			for node in arch.xpath('/list/field'):
				if node.get('optional') or node.get('column_invisible'):
					continue
				node.set('optional', 'show')
		return arch, view

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


