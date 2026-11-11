from odoo import api, fields, models


class StockInventoryHistory(models.Model):
    """Documento de conteo: una foto de lo que había y de lo contado al
    aplicar un inventario en un almacén."""

    _name = 'stock.inventory.history'
    _description = 'Documento de conteo de inventario'
    _order = 'date desc, id desc'

    name = fields.Char('Referencia', required=True, readonly=True, copy=False)
    date = fields.Datetime(
        'Fecha', required=True, readonly=True, default=fields.Datetime.now, index=True)
    warehouse_id = fields.Many2one(
        'stock.warehouse', 'Almacén', readonly=True, index=True)
    user_id = fields.Many2one(
        'res.users', 'Usuario', readonly=True, default=lambda self: self.env.user)
    company_id = fields.Many2one(
        'res.company', 'Compañía', required=True, readonly=True,
        default=lambda self: self.env.company)
    line_ids = fields.One2many(
        'stock.inventory.history.line', 'history_id', 'Líneas', readonly=True)
    line_count = fields.Integer('Productos contados', compute='_compute_counts', store=True)
    diff_line_count = fields.Integer('Con diferencia', compute='_compute_counts', store=True)

    @api.depends('line_ids', 'line_ids.difference_qty')
    def _compute_counts(self):
        for doc in self:
            doc.line_count = len(doc.line_ids)
            doc.diff_line_count = len(doc.line_ids.filtered(
                lambda line: line.difference_qty))


class StockInventoryHistoryLine(models.Model):
    _name = 'stock.inventory.history.line'
    _description = 'Línea de conteo de inventario'
    _order = 'history_id, product_id, id'

    history_id = fields.Many2one(
        'stock.inventory.history', 'Conteo', required=True, readonly=True,
        ondelete='cascade', index=True)
    date = fields.Datetime(related='history_id.date', store=True)
    warehouse_id = fields.Many2one(
        related='history_id.warehouse_id', store=True, string='Almacén')
    product_id = fields.Many2one(
        'product.product', 'Producto', required=True, readonly=True, index=True)
    lot_id = fields.Many2one('stock.lot', 'Lote/Nº serie', readonly=True)
    location_id = fields.Many2one('stock.location', 'Ubicación', readonly=True)
    uom_id = fields.Many2one('uom.uom', 'UdM', readonly=True)
    theoretical_qty = fields.Float('Cantidad anterior', readonly=True)
    counted_qty = fields.Float('Cantidad contada', readonly=True)
    difference_qty = fields.Float('Diferencia', readonly=True)
