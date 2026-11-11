from odoo import models


class StockQuant(models.Model):
    _inherit = 'stock.quant'

    def _apply_inventory(self, date=None):
        # Hay que tomar la foto antes de aplicar: después el quant ya no
        # conserva la cantidad contada ni la diferencia.
        snapshot = self._get_inventory_history_snapshot()
        res = super()._apply_inventory(date)
        self._create_inventory_history(snapshot)
        return res

    def _get_inventory_history_snapshot(self):
        """Agrupa por (almacén, compañía) las líneas a registrar."""
        grouped = {}
        for quant in self:
            if quant.location_id.usage not in ('internal', 'transit'):
                continue
            theoretical = quant.quantity
            counted = quant.inventory_quantity
            if self.env.context.get('from_inverse_qty') and \
                    quant.product_uom_id.compare(counted, theoretical) == 0:
                continue
            key = (quant.location_id.warehouse_id.id, quant.company_id.id)
            grouped.setdefault(key, []).append({
                'product_id': quant.product_id.id,
                'lot_id': quant.lot_id.id,
                'location_id': quant.location_id.id,
                'uom_id': quant.product_uom_id.id,
                'theoretical_qty': theoretical,
                'counted_qty': counted,
                'difference_qty': counted - theoretical,
                'unit_cost': quant.product_id.with_company(
                    quant.company_id).standard_price,
            })
        return grouped

    def _create_inventory_history(self, snapshot):
        history = self.env['stock.inventory.history'].sudo()
        sequence = self.env['ir.sequence'].sudo()
        for (warehouse_id, company_id), lines in snapshot.items():
            warehouse = self.env['stock.warehouse'].browse(warehouse_id)
            code = warehouse.code or 'SIN-ALM'
            number = sequence.with_company(company_id).next_by_code(
                'stock.inventory.history') or '/'
            history.create({
                'name': f'INV/{code}/{number}',
                'warehouse_id': warehouse_id or False,
                'company_id': company_id,
                'user_id': self.env.user.id,
                'line_ids': [(0, 0, vals) for vals in lines],
            })
