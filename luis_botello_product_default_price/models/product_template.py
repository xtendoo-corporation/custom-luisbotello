from odoo import api, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        # Odoo propone 1.0 por defecto; aquí 0.0 salvo que el contexto
        # (p. ej. default_list_price) indique otro valor.
        if 'list_price' in fields_list and 'default_list_price' not in self.env.context:
            res['list_price'] = 0.0
        return res
