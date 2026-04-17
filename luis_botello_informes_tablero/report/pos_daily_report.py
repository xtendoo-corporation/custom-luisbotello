from odoo import fields, models, tools


class LuisBotelloPosDailyReport(models.Model):
    _name = 'luis.botello.pos.daily.report'
    _description = 'Informe diario de pedidos TPV por caja'
    _auto = False
    _order = 'report_date desc, config_id'
    _rec_name = 'display_name'

    display_name = fields.Char(string='Descripción', readonly=True)
    report_date = fields.Date(string='Día', readonly=True)
    config_id = fields.Many2one('pos.config', string='Caja', readonly=True)
    company_id = fields.Many2one('res.company', string='Compañía', readonly=True)
    currency_id = fields.Many2one('res.currency', string='Moneda', readonly=True)
    order_count = fields.Integer(string='Pedidos', readonly=True)
    amount_total = fields.Monetary(string='Importe total', currency_field='currency_id', readonly=True)
    average_ticket = fields.Monetary(
        string='Ticket medio',
        currency_field='currency_id',
        readonly=True,
        aggregator='avg',
    )

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute(f"""
            CREATE OR REPLACE VIEW {self._table} AS (
                WITH order_base AS (
                    SELECT
                        po.id,
                        CAST(
                            date_trunc(
                                'day',
                                timezone(
                                    COALESCE(partner.tz, 'UTC'),
                                    po.date_order AT TIME ZONE 'UTC'
                                )
                            ) AS date
                        ) AS report_date,
                        po.config_id,
                        po.company_id,
                        company.currency_id,
                        po.amount_total
                    FROM pos_order po
                    JOIN res_company company
                        ON company.id = po.company_id
                    LEFT JOIN res_partner partner
                        ON partner.id = company.partner_id
                    WHERE po.state NOT IN ('draft', 'cancel')
                )
                SELECT
                    MIN(ob.id) AS id,
                    CONCAT(pc.name, ' - ', to_char(ob.report_date, 'DD/MM/YYYY')) AS display_name,
                    ob.report_date,
                    ob.config_id,
                    ob.company_id,
                    ob.currency_id,
                    COUNT(*)::integer AS order_count,
                    COALESCE(SUM(ob.amount_total), 0.0) AS amount_total,
                    COALESCE(AVG(ob.amount_total), 0.0) AS average_ticket
                FROM order_base ob
                JOIN pos_config pc
                    ON pc.id = ob.config_id
                GROUP BY
                    ob.report_date,
                    ob.config_id,
                    ob.company_id,
                    ob.currency_id,
                    pc.name
            )
        """)

