from odoo import models, fields

class StockMove(models.Model):
    _inherit = 'stock.move'

    next_picking_type_id = fields.Many2one(
        'stock.picking.type',
        string='Siguiente tipo de operación',
        help="Si se selecciona un tipo de operación, se creará un nuevo movimiento de stock automáticamente al confirmar este."
    )

