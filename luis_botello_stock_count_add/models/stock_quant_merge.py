# -*- coding: utf-8 -*-
from odoo import api, fields, models
from odoo.exceptions import UserError


class StockQuantMerge(models.Model):
    _inherit = "stock.quant"

    @api.model_create_multi
    def create(self, vals_list):
        """Extiende la creación en modo inventario para SUMAR los contados cuando
        el quant ya tiene un `inventory_quantity` fijado en una sesión no aplicada.

        - Si se crea en `inventory_mode` y se pasa `inventory_quantity` (o
          `inventory_quantity_auto_apply`) y existe un quant similar, en lugar de
          sobrescribir `inventory_quantity` se SUMA a la existente si ésta ya estaba
          marcada como fijada (`inventory_quantity_set=True`).
        - En caso contrario se mantiene la lógica por defecto (primer toque -> fijar).
        """
        def _add_to_cache(quant):
            if 'quants_cache' in self.env.context:
                self.env.context['quants_cache'][
                    quant.product_id.id, quant.location_id.id, quant.lot_id.id, quant.package_id.id, quant.owner_id.id
                ] |= quant

        quants = self.env['stock.quant']
        is_inventory_mode = self._is_inventory_mode()
        allowed_fields = self._get_inventory_fields_create()
        for vals in vals_list:
            if is_inventory_mode and any(f in vals for f in ['inventory_quantity', 'inventory_quantity_auto_apply']):
                if any(field for field in vals if not field.startswith('x_') and field not in allowed_fields):
                    raise UserError(("Quant's creation is restricted, you can't do this operation."))
                auto_apply = 'inventory_quantity_auto_apply' in vals
                inventory_quantity = vals.pop('inventory_quantity_auto_apply', False) or vals.pop(
                    'inventory_quantity', False) or 0
                # Create an empty quant or write on a similar one.
                product = self.env['product.product'].browse(vals['product_id'])
                location = self.env['stock.location'].browse(vals['location_id'])
                lot_id = self.env['stock.lot'].browse(vals.get('lot_id'))
                package_id = self.env['stock.package'].browse(vals.get('package_id'))
                owner_id = self.env['res.partner'].browse(vals.get('owner_id'))
                quant = self.env['stock.quant']
                if not self.env.context.get('import_file'):
                    # Merge quants later, to make sure one line = one record during batch import
                    quant = self._gather(product, location, lot_id=lot_id, package_id=package_id, owner_id=owner_id, strict=True)
                if lot_id:
                    if self.env.context.get('import_file') and lot_id.product_id != product:
                        lot_name = lot_id.name
                        lot_id = self.env['stock.lot'].search([('product_id', '=', product.id), ('name', '=', lot_name)], limit=1)
                        if not lot_id:
                            company_id = location.company_id or self.env.company
                            lot_id = self.env['stock.lot'].create({'name': lot_name, 'product_id': product.id, 'company_id': company_id.id})
                        vals['lot_id'] = lot_id.id
                    quant = quant.filtered(lambda q: q.lot_id)
                if quant:
                    # Existe un quant similar: en lugar de sobrescribir, SUMAMOS si ya había un contado fijado
                    quant = quant[0].sudo()
                else:
                    quant = self.sudo().create(vals)
                    _add_to_cache(quant)
                if auto_apply:
                    # Para auto_apply mantenemos el comportamiento por defecto (se escribe el campo compute/ inverse)
                    quant.write({'inventory_quantity_auto_apply': inventory_quantity})
                else:
                    # Nuevo comportamiento: si el quant ya tenía un inventory_quantity_set (otro conteo previo), sumamos
                    if quant.inventory_quantity_set:
                        existing = float(quant.inventory_quantity or 0.0)
                        counted_quantity = existing + float(inventory_quantity or 0.0)
                    else:
                        counted_quantity = inventory_quantity
                    quant.write({
                        'inventory_quantity': counted_quantity,
                        'inventory_quantity_set': True,
                    })
                    quant.user_id = vals.get('user_id', self.env.user.id)
                    quant.inventory_date = fields.Date.today()
                quants |= quant
            else:
                if 'inventory_quantity' not in vals:
                    vals['inventory_quantity_set'] = vals.get('inventory_quantity_set', False)
                quant = super(StockQuantMerge, self).create([vals])[0]
                _add_to_cache(quant)
                quants |= quant
                if self._is_inventory_mode() and quant.company_id:
                    quant._check_company()
        return quants
