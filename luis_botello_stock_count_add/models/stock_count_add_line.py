from odoo import fields, models


class StockCountAddLine(models.TransientModel):
    _name = "stock.count.add.line"
    _description = "Línea de log del conteo aditivo"
    _order = "id desc"

    session_id = fields.Many2one(
        comodel_name="stock.count.add.session",
        required=True,
        ondelete="cascade",
    )
    product_id = fields.Many2one(
        comodel_name="product.product",
        string="Producto",
        required=True,
    )
    location_id = fields.Many2one(
        comodel_name="stock.location",
        string="Ubicación",
        required=True,
    )
    lot_id = fields.Many2one(
        comodel_name="stock.lot",
        string="Lote/Serie",
    )
    package_id = fields.Many2one(
        comodel_name="stock.package",
        string="Paquete",
    )
    qty = fields.Float(
        string="Cantidad añadida",
        digits="Product Unit",
    )
    result_qty = fields.Float(
        string="Contado acumulado",
        digits="Product Unit",
        help="Cantidad contada del quant tras aplicar esta entrada.",
    )
