# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError

class PosCategoryToProduct(models.TransientModel):
    _name = 'pos.category.to.product'
    _description = 'Copiar categorías de TPV a Productos'

    parent_id = fields.Many2one(
        'product.category',
        string='Categoría Padre',
        required=True,
        help="Las categorías de TPV se crearán dentro de esta categoría de producto."
    )

    def action_copy_categories(self):
        self.ensure_one()
        pos_categories = self.env['pos.category'].search([])
        product_category_obj = self.env['product.category']

        count = 0
        for pos_cat in pos_categories:
            # Buscar si ya existe una categoría de producto con el mismo nombre y padre
            existing = product_category_obj.search([
                ('name', '=', pos_cat.name),
                ('parent_id', '=', self.parent_id.id)
            ], limit=1)

            if not existing:
                new_product_category = product_category_obj.create({
                    'name': pos_cat.name,
                    'parent_id': self.parent_id.id,
                    'property_cost_method': 'average',
                    'property_valuation': 'real_time',
                })
                count += 1
            else:
                new_product_category = existing

            # Asignar la categoría de producto a los productos que tengan esta categoría de TPV
            products_to_update = self.env['product.template'].search([
                ('pos_categ_ids', 'in', pos_cat.id)
            ])
            if products_to_update:
                products_to_update.write({'categ_id': new_product_category.id})

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Proceso Completado'),
                'message': _('Se han creado %s nuevas categorías de producto.') % count,
                'sticky': False,
            }
        }

