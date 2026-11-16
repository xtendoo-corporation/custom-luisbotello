from odoo import api, fields, models


class ProductTemplate(models.Model):
    _inherit = "product.template"

    # Por defecto, todo producto nuevo se puede vender en el punto de venta.
    available_in_pos = fields.Boolean(default=True)

    @api.model_create_multi
    def create(self, vals_list):
        """Si no se informa categoría, se asigna la categoría «Todas»."""
        default_categ = None
        for vals in vals_list:
            if not vals.get("categ_id"):
                if default_categ is None:
                    # «Todas» es la categoría raíz (sin padre) de Odoo.
                    default_categ = self.env["product.category"].search(
                        [("parent_id", "=", False)], order="id", limit=1
                    )
                if default_categ:
                    vals["categ_id"] = default_categ.id
        return super().create(vals_list)
