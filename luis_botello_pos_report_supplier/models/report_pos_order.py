from odoo import fields, models


class ReportPosOrder(models.Model):
    _inherit = 'report.pos.order'

    supplier_id = fields.Many2one('res.partner', string='Vendor', readonly=True)
    stock_qty = fields.Float(
        string='Stock', readonly=True, aggregator='max',
        help='Current on-hand quantity in the warehouse of the order\'s point of sale.')

    def _select(self):
        return super()._select() + """,
                sup.partner_id AS supplier_id,
                COALESCE(stk.quantity, 0) AS stock_qty
        """

    def _from(self):
        # Main vendor computed once per product (not once per order line):
        # a per-row LATERAL lookup was far too slow on large POS histories.
        return super()._from() + """
                LEFT JOIN (
                    SELECT DISTINCT ON (p2.id) p2.id AS product_id, si.partner_id
                    FROM product_product p2
                    JOIN product_supplierinfo si
                      ON si.product_tmpl_id = p2.product_tmpl_id
                     AND (si.product_id IS NULL OR si.product_id = p2.id)
                    ORDER BY p2.id, (si.product_id IS NULL), si.sequence,
                             si.min_qty DESC, si.price, si.id
                ) sup ON sup.product_id = p.id
                LEFT JOIN pos_config pcfg ON pcfg.id = ps.config_id
                LEFT JOIN stock_picking_type spt ON spt.id = pcfg.picking_type_id
                LEFT JOIN (
                    SELECT sq.product_id, w.id AS warehouse_id,
                           SUM(sq.quantity) AS quantity
                    FROM stock_quant sq
                    JOIN stock_location sl ON sl.id = sq.location_id
                    JOIN stock_warehouse w ON w.active
                    JOIN stock_location wl ON wl.id = w.view_location_id
                     AND sl.parent_path LIKE wl.parent_path || '%%'
                    WHERE sl.usage = 'internal'
                    GROUP BY sq.product_id, w.id
                ) stk ON stk.product_id = p.id
                     AND stk.warehouse_id = spt.warehouse_id
        """
