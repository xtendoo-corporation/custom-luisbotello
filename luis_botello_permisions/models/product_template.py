from odoo import api, fields, models


class ProductTemplate(models.Model):
    _inherit = "product.template"

    can_edit_list_price = fields.Boolean(
        compute="_compute_can_edit_list_price",
        help="Indica si el usuario actual puede modificar el precio de venta "
        "en la ficha del producto.",
    )

    @api.depends_context("uid")
    def _compute_can_edit_list_price(self):
        allowed = self.env.user.has_group(
            "luis_botello_permisions.group_edit_product_price"
        )
        for product in self:
            product.can_edit_list_price = allowed
