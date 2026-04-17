from odoo import fields, models, tools


class LuisBotelloPosHourlyReport(models.Model):
    _name = 'luis.botello.pos.hourly.report'
    _description = 'Informe de pedidos TPV por tramo horario'
    _auto = False
    _order = 'report_date desc, config_id, slot_hour'
    _rec_name = 'display_name'

    display_name = fields.Char(string='Descripción', readonly=True)
    report_date = fields.Date(string='Día', readonly=True)
    config_id = fields.Many2one('pos.config', string='Caja', readonly=True)
    company_id = fields.Many2one('res.company', string='Compañía', readonly=True)
    currency_id = fields.Many2one('res.currency', string='Moneda', readonly=True)
    slot_hour = fields.Integer(string='Hora', readonly=True)
    time_slot = fields.Char(string='Tramo horario', readonly=True)
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
                        timezone(
                            COALESCE(partner.tz, 'UTC'),
                            po.date_order AT TIME ZONE 'UTC'
                        ) AS local_datetime,
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
                ),
                grouped_base AS (
                    SELECT
                        ob.id,
                        CAST(date_trunc('day', ob.local_datetime) AS date) AS report_date,
                        EXTRACT(HOUR FROM ob.local_datetime)::integer AS slot_hour,
                        ob.config_id,
                        ob.company_id,
                        ob.currency_id,
                        ob.amount_total
                    FROM order_base ob
                )
                SELECT
                    MIN(gb.id) AS id,
                    CONCAT(
                        pc.name,
                        ' - ',
                        to_char(gb.report_date, 'DD/MM/YYYY'),
                        ' - ',
                        LPAD(gb.slot_hour::text, 2, '0'),
                        ':00 - ',
                        LPAD(gb.slot_hour::text, 2, '0'),
                        ':59'
                    ) AS display_name,
                    gb.report_date,
                    gb.config_id,
                    gb.company_id,
                    gb.currency_id,
                    gb.slot_hour,
                    CONCAT(
                        LPAD(gb.slot_hour::text, 2, '0'),
                        ':00 - ',
                        LPAD(gb.slot_hour::text, 2, '0'),
                        ':59'
                    ) AS time_slot,
                    COUNT(*)::integer AS order_count,
                    COALESCE(SUM(gb.amount_total), 0.0) AS amount_total,
                    COALESCE(AVG(gb.amount_total), 0.0) AS average_ticket
                FROM grouped_base gb
                JOIN pos_config pc
                    ON pc.id = gb.config_id
                GROUP BY
                    gb.report_date,
                    gb.config_id,
                    gb.company_id,
                    gb.currency_id,
                    gb.slot_hour,
                    pc.name
            )
        """)

