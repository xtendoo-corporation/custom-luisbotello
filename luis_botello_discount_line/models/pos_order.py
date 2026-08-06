from odoo import models

class PosOrder(models.Model):
    _inherit = 'pos.order'

    def _get_invoice_lines_values(self, line_values, pos_line, move_type):
        res = super(PosOrder, self)._get_invoice_lines_values(line_values, pos_line, move_type)
        if pos_line and 'discount_line' in pos_line._fields:
            res.update({'discount_line': pos_line.discount_line})
        return res

    def add_product_by_barcode(self, barcode=None, product_id=None, line_vals=None):
        """
        Override para que al añadir/escaniar un producto siempre se cree una nueva línea
        en el pedido, en lugar de incrementar la cantidad en una línea existente.
        """
        self.ensure_one()
        if self.state != 'draft':
            return {
                'success': False,
                'message': "No se pueden añadir productos a un pedido que no está en borrador.",
            }

        Product = self.env['product.product']

        # Obtener producto por ID o por código de barras
        if product_id:
            product = Product.browse(product_id)
            if not product.exists():
                return {'success': False, 'message': "Producto no encontrado con ID: %s" % product_id}
        elif barcode:
            product = Product.search([('barcode', '=', barcode)], limit=1)
            if not product:
                product = Product.search([('default_code', '=', barcode)], limit=1)
            if not product:
                return {'success': False, 'message': "No se encontró ningún producto con el código: %s" % barcode}
        else:
            return {'success': False, 'message': "Debe proporcionar un código de barras o ID de producto."}

        try:
            # Intentar usar la preparación estándar si existe
            if hasattr(self, '_prepare_order_line_vals'):
                base_vals = self._prepare_order_line_vals(product)
            else:
                # Fallback mínimo
                taxes = product.taxes_id.filtered(lambda t: t.company_id == self.env.company)
                price_unit = product.lst_price
                qty = 1.0
                price_subtotal = price_unit * qty
                price_subtotal_incl = price_unit * qty
                if taxes:
                    tr = taxes.compute_all(price_unit, currency=self.currency_id or self.env.company.currency_id, quantity=qty, product=product)
                    price_subtotal = tr['total_excluded']
                    price_subtotal_incl = tr['total_included']
                base_vals = {
                    'order_id': self.id,
                    'product_id': product.id,
                    'full_product_name': product.display_name,
                    'qty': qty,
                    'price_unit': price_unit,
                    'discount': 0.0,
                    'price_subtotal': price_subtotal,
                    'price_subtotal_incl': price_subtotal_incl,
                    'tax_ids': [(6, 0, taxes.ids)],
                }

            vals = dict(base_vals)
            if line_vals and isinstance(line_vals, dict):
                for k in ('qty', 'price_unit', 'discount', 'tax_ids', 'full_product_name'):
                    if k in line_vals:
                        vals[k] = line_vals[k]

            new_line = self.env['pos.order.line'].create(vals)

            # Ejecutar onchanges si existen y recalcular totales
            try:
                if hasattr(new_line, '_onchange_qty'):
                    new_line._onchange_qty()
                elif hasattr(new_line, '_onchange_product_id'):
                    new_line._onchange_product_id()
            except Exception:
                pass

            if hasattr(self, '_recompute_barcode_order_amounts'):
                try:
                    self._recompute_barcode_order_amounts()
                except Exception:
                    pass
            else:
                try:
                    self._compute_prices()
                except Exception:
                    pass

            return {'success': True, 'message': "Añadido: %s" % product.display_name}

        except Exception as e:
            return {'success': False, 'message': "Error al añadir el producto: %s" % str(e)}

