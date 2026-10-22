from odoo import api, fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    # Igual que standard_price: el valor vive en la variante y la plantilla
    # lo muestra/edita solo cuando tiene una única variante.
    fixed_cost = fields.Float(
        string='Coste fijo',
        digits='Product Price',
        compute='_compute_fixed_cost',
        inverse='_set_fixed_cost',
        search='_search_fixed_cost',
        help="Si se informa, es el precio unitario que se propone en las compras "
             "del producto en lugar del coste de la ficha. En reposición se "
             "respeta el precio de la tarifa de proveedor si lo tiene. Se avisa "
             "si en una compra se introduce un precio superior.",
    )

    @api.depends_context('company')
    @api.depends('product_variant_ids.fixed_cost')
    def _compute_fixed_cost(self):
        self._compute_template_field_from_variant_field('fixed_cost')

    def _set_fixed_cost(self):
        self._set_product_variant_field('fixed_cost')

    def _search_fixed_cost(self, operator, value):
        return [('product_variant_ids.fixed_cost', operator, value)]

    def _get_related_fields_variant_template(self):
        return super()._get_related_fields_variant_template() + ['fixed_cost']
