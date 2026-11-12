from odoo import api, fields, models


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    seller_discounts_key = fields.Char(
        string='Descuentos aplicados desde la tarifa',
        copy=False,
        help="Técnico: descuentos que puso la tarifa del proveedor en esta "
             "línea. Si los descuentos actuales son otros, los ha escrito el "
             "usuario y no se vuelven a pisar con los de la tarifa.",
    )

    def _discounts_key(self):
        self.ensure_one()
        return '|'.join(
            '%.6f' % (self[fname] or 0.0)
            for fname in self._get_multiple_discount_field_names())

    def _discounts_match_seller(self):
        self.ensure_one()
        seller = self.selected_seller_id
        return bool(seller) and all(
            abs((self[fname] or 0.0) - (seller[fname] or 0.0)) < 1e-6
            for fname in self._get_multiple_discount_field_names())

    def _discounts_need_recompute(self):
        """Los descuentos de la tarifa solo se reaplican si la línea sigue con
        los que puso la tarifa (o no tiene ninguno): nunca se pisa un valor
        escrito a mano, sea cual sea el motivo del recálculo (cambio de
        cantidad, guardado, onchange...)."""
        self.ensure_one()
        if not self.seller_discounts_key:
            return not any(
                self[fname] for fname in self._get_multiple_discount_field_names())
        return self.seller_discounts_key == self._discounts_key()

    def _compute_discounts(self):
        to_compute = self.filtered(lambda line: line._discounts_need_recompute())
        if to_compute:
            super(PurchaseOrderLine, to_compute)._compute_discounts()
            for line in to_compute:
                line.seller_discounts_key = line._discounts_key()

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        # Líneas creadas con los descuentos de la tarifa (formulario,
        # reposición...): quedan marcadas para poder seguir actualizándolos
        # al cambiar la cantidad mientras nadie los toque.
        for line in lines.filtered(lambda l: not l.seller_discounts_key and not l.display_type):
            if line._discounts_match_seller():
                line.seller_discounts_key = line._discounts_key()
        return lines
