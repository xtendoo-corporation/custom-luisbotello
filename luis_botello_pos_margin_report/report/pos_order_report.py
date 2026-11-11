from odoo import api, fields, models


class ReportPosOrder(models.Model):
    _inherit = 'report.pos.order'

    total_cost = fields.Float(string='Coste', readonly=True)

    def _select(self):
        return super()._select() + """,
                COALESCE(l.total_cost, 0) / COALESCE(NULLIF(s.currency_rate, 0), 1.0) AS total_cost
        """

    # El pivot/graph agrupa por producto: mostrar el nombre sin el código [ref],
    # independientemente del contexto de la acción desde la que se abra.
    @api.model
    def formatted_read_group(self, *args, **kwargs):
        return super(ReportPosOrder, self.with_context(
            display_default_code=False)).formatted_read_group(*args, **kwargs)

    @api.model
    @api.model
    def formatted_read_grouping_sets(self, *args, **kwargs):
        return super(ReportPosOrder, self.with_context(
            display_default_code=False)).formatted_read_grouping_sets(*args, **kwargs)

    @api.model
    def web_read_group(self, *args, **kwargs):
        return super(ReportPosOrder, self.with_context(
            display_default_code=False)).web_read_group(*args, **kwargs)
