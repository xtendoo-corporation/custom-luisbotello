# -*- coding: utf-8 -*-
from odoo import models, fields


class LuisBotelloStockReport(models.Model):
    _name = 'luis_botello.stock_report'
    _description = 'Informe consolidado de stock'
    _auto = False
    _rec_name = 'product_id'
    _order = 'available_qty desc'

    product_id = fields.Many2one('product.product', string='Prod.', readonly=True)
    product_tmpl_id = fields.Many2one('product.template', string='Plantilla', readonly=True)
    categ_id = fields.Many2one('product.category', string='Cat.', readonly=True)
    uom_id = fields.Many2one('uom.uom', string='UdM', readonly=True)
    company_id = fields.Many2one('res.company', string='Cía.', readonly=True)
    warehouse_id = fields.Many2one('stock.warehouse', string='Alm.', readonly=True)
    qty = fields.Float(string='Total', readonly=True)
    reserved_qty = fields.Float(string='Res.', readonly=True)
    available_qty = fields.Float(string='Disp.', readonly=True)

    def init(self):
        self._cr.execute("DROP VIEW IF EXISTS luis_botello_stock_report")
        self._cr.execute("""
            CREATE OR REPLACE VIEW luis_botello_stock_report AS (
                SELECT
                    row_number() OVER () AS id,
                    sq.product_id AS product_id,
                    pp.product_tmpl_id AS product_tmpl_id,
                    pt.categ_id AS categ_id,
                    pt.uom_id AS uom_id,
                    sq.company_id AS company_id,
                    sl.warehouse_id AS warehouse_id,
                    SUM(COALESCE(sq.quantity, 0)) AS qty,
                    SUM(COALESCE(sq.reserved_quantity, 0)) AS reserved_qty,
                    SUM(COALESCE(sq.quantity, 0) - COALESCE(sq.reserved_quantity, 0)) AS available_qty
                FROM stock_quant sq
                JOIN product_product pp ON pp.id = sq.product_id
                JOIN product_template pt ON pt.id = pp.product_tmpl_id
                JOIN stock_location sl ON sl.id = sq.location_id
                GROUP BY sq.product_id, pp.product_tmpl_id, pt.categ_id, pt.uom_id, sq.company_id, sl.warehouse_id
            )
        """)

