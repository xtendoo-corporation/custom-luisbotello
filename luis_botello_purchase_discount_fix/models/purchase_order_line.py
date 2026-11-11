from odoo import models


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    def _compute_discounts(self):
        """Solo reaplica los descuentos de la tarifa del proveedor cuando ha
        cambiado algo que los determina.

        En el formulario, al teclear un descuento Odoo vuelve a calcular el
        precio/fecha/descripción de la línea (los campos no enviados por el
        cliente se consideran pendientes de calcular) y
        purchase_triple_discount aprovechaba para pisar los descuentos con los
        de la tarifa, de modo que el valor escrito se perdía.
        """
        to_compute = self.filtered(lambda line: line._discounts_need_recompute())
        if to_compute:
            super(PurchaseOrderLine, to_compute)._compute_discounts()

    def _discounts_need_recompute(self):
        self.ensure_one()
        origin = self._origin
        if self.id or not origin:
            # Escritura directa o línea nueva sin guardar: comportamiento original.
            return True
        return (
            self.product_id != origin.product_id
            or self.product_qty != origin.product_qty
            or self.product_uom_id != origin.product_uom_id
            or self.order_id.partner_id != origin.order_id.partner_id
        )
