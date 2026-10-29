from odoo import api, models


class ReportSaleDetails(models.AbstractModel):
    _inherit = 'report.point_of_sale.report_saledetails'

    @api.model
    def get_sale_details(self, date_start=False, date_stop=False, config_ids=False, session_ids=False):
        """Añade la caja inicial y la caja contada al cierre de la(s) sesión(es)."""
        res = super().get_sale_details(
            date_start=date_start, date_stop=date_stop,
            config_ids=config_ids, session_ids=session_ids,
        )
        sessions = self.env['pos.session'].browse(session_ids or [])
        closed = sessions.filtered(lambda s: s.state == 'closed')
        res['lb_cash_opening'] = sum(sessions.mapped('cash_register_balance_start'))
        res['lb_cash_closing'] = sum(closed.mapped('cash_register_balance_end_real'))
        res['lb_show_cash_boxes'] = bool(sessions)
        res['lb_cash_is_closed'] = bool(sessions) and closed == sessions
        return res
