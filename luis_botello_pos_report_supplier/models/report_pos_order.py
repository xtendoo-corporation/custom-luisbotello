from odoo import fields, models


class ReportPosOrder(models.Model):
    _inherit = 'report.pos.order'

    supplier_id = fields.Many2one('res.partner', string='Vendor', readonly=True)

    def _select(self):
        return super()._select() + """,
                sup.partner_id AS supplier_id
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
        """
