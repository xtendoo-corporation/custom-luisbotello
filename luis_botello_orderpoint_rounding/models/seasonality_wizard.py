import math

from odoo import _, api, fields, models


class SeasonalityWizard(models.TransientModel):
    _inherit = 'stock.orderpoint.seasonality.wizard'

    hide_zero_demand = fields.Boolean(
        string='Ocultar sin demanda',
        default=True,
        help='No muestra ni crea reglas para los meses en los que el producto '
             'no tuvo ventas en el año de referencia.',
    )
    line_count = fields.Integer(compute='_compute_line_stats')
    create_count = fields.Integer(compute='_compute_line_stats')
    update_count = fields.Integer(compute='_compute_line_stats')
    conflict_count = fields.Integer(compute='_compute_line_stats')

    @api.depends('line_ids.action_flag')
    def _compute_line_stats(self):
        for wizard in self:
            flags = wizard.line_ids.mapped('action_flag')
            wizard.line_count = len(flags)
            wizard.create_count = flags.count('create')
            wizard.update_count = flags.count('update')
            wizard.conflict_count = flags.count('conflict')

    # ------------------------------------------------------------------
    # Cantidades enteras
    # ------------------------------------------------------------------
    def _compute_suggested_qtys(self, demand_qty, factor):
        """Redondea hacia arriba mínimo y máximo a unidades enteras."""
        suggested_min, suggested_max = super()._compute_suggested_qtys(demand_qty, factor)
        suggested_min = math.ceil(round(suggested_min, 6))
        suggested_max = max(math.ceil(round(suggested_max, 6)), suggested_min)
        return float(suggested_min), float(suggested_max)

    # ------------------------------------------------------------------
    # Sin líneas a cero
    # ------------------------------------------------------------------
    def _compute_demand(self, products, months):
        """El asistente lee ventas de venta y TPV. Un responsable de inventario
        no tiene por qué tener acceso a esos modelos, así que el cálculo (solo
        lectura, filtrado por compañía y almacén) se hace con sudo."""
        return super(SeasonalityWizard, self.sudo())._compute_demand(products, months)

    def _get_products(self):
        """Con «Ocultar sin demanda» solo se analizan los productos que
        vendieron algo en los meses elegidos."""
        products = super()._get_products()
        if self.hide_zero_demand and products:
            demand = self._compute_demand(products, self._get_months())
            with_demand = {product_id for (product_id, _month), qty in demand.items() if qty > 0}
            products = products.filtered(lambda p: p.id in with_demand)
        return products

    def action_compute_preview(self):
        result = super().action_compute_preview()
        if self.hide_zero_demand:
            self.line_ids.filtered(lambda l: l.demand_qty <= 0).unlink()
        result.update({
            'name': _('Mínimos de stock estacionales'),
            'context': dict(self.env.context, dialog_size='extra-large'),
        })
        return result
