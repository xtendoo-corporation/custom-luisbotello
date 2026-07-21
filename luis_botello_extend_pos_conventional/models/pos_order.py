# -*- coding: utf-8 -*-
from odoo import fields, models


class PosOrder(models.Model):
	_inherit = 'pos.order'

	pos_config_hide_return = fields.Boolean(
		string='Ocultar botón Devolución (config caja)',
		related='session_id.config_id.hide_return_button',
		readonly=True,
		store=False,
	)


