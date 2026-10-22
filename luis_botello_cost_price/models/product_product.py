from odoo import fields, models


class ProductProduct(models.Model):
    _inherit = 'product.product'

    fixed_cost = fields.Float(
        string='Coste fijo',
        digits='Product Price',
        company_dependent=True,
        help="Si se informa, es el precio unitario que se propone en las compras "
             "de esta variante en lugar del coste de la ficha. En reposición se "
             "respeta el precio de la tarifa de proveedor si lo tiene. Se avisa "
             "si en una compra se introduce un precio superior.",
    )
