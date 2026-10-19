from odoo import api, fields, models


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    dest_location_id = fields.Many2one(
        comodel_name='stock.location',
        string='Destination Location',
        domain="[('usage', '=', 'internal'), ('company_id', 'in', (company_id, False))]",
        check_company=True,
        index='btree_not_null',
        help="Location where the goods of this line will be received. "
             "If empty, the destination of the operation type is used.",
    )

    seller_tiers_data = fields.Json(
        string='Vendor Tiers Data',
        compute='_compute_seller_tiers_data',
        help="Technical field used by the vendor discounts / minimum quantity widget.",
    )

    # ------------------------------------------------------------------
    # Proveedor / descuento según la cantidad total del producto en el pedido
    # ------------------------------------------------------------------
    def _get_total_product_qty(self):
        """Cantidad de todas las líneas del pedido con el mismo producto,
        expresada en la UdM de esta línea."""
        self.ensure_one()
        lines = self.order_id.order_line.filtered(
            lambda l: not l.display_type and l.product_id == self.product_id
        )
        if self not in lines:
            lines |= self
        total = 0.0
        for line in lines:
            qty = abs(line.product_qty)
            if line.product_uom_id and self.product_uom_id and line.product_uom_id != self.product_uom_id:
                qty = line.product_uom_id._compute_quantity(qty, self.product_uom_id)
            total += qty
        return total

    @api.depends(
        'order_id.order_line.product_qty',
        'order_id.order_line.product_id',
        'order_id.order_line.product_uom_id',
    )
    def _compute_selected_seller_id(self):
        super()._compute_selected_seller_id()
        for line in self:
            if not line.product_id:
                continue
            seller = line.product_id._select_seller(
                partner_id=line.partner_id,
                quantity=line._get_total_product_qty(),
                date=fields.Date.context_today(line, timestamp=line.order_id.date_order),
                uom_id=line.product_uom_id,
                params=line._get_select_sellers_params(),
            )
            line.selected_seller_id = seller.id if seller else False

    @api.depends(
        'product_id', 'partner_id', 'product_uom_id', 'selected_seller_id',
        'order_id.order_line.product_qty',
        'order_id.order_line.product_id',
        'order_id.order_line.product_uom_id',
    )
    def _compute_seller_tiers_data(self):
        for line in self:
            if not line.product_id or line.display_type:
                line.seller_tiers_data = False
                continue
            date = fields.Date.context_today(line, timestamp=line.order_id.date_order)
            sellers = line.product_id._prepare_sellers(line._get_select_sellers_params())
            sellers = sellers.filtered(
                lambda s: (not line.partner_id or s.partner_id in (line.partner_id | line.partner_id.parent_id))
                and (not s.date_start or s.date_start <= date)
                and (not s.date_end or s.date_end >= date)
                and (not s.product_id or s.product_id == line.product_id)
            ).sorted(lambda s: (s.min_qty, s.price))
            if not sellers:
                line.seller_tiers_data = False
                continue
            total = line._get_total_product_qty()
            tiers = [{
                'min_qty': s.min_qty,
                'price': s.price,
                'discount': s.discount,
                'uom': s.product_uom_id.display_name,
                'currency': s.currency_id.display_name,
                'vendor': s.partner_id.display_name,
                'current': s == line.selected_seller_id,
            } for s in sellers]
            next_tier = next((t for t in tiers if t['min_qty'] > total), None)
            line.seller_tiers_data = {
                'tiers': tiers,
                'min_qty': min(s.min_qty for s in sellers),
                'uom': sellers[0].product_uom_id.display_name,
                'total_qty': total,
                'next': next_tier and dict(next_tier, missing=next_tier['min_qty'] - total),
            }

    @api.depends('selected_seller_id')
    def _compute_price_unit_and_date_planned_and_name(self):
        return super()._compute_price_unit_and_date_planned_and_name()

    @api.model_create_multi
    def create(self, vals_list):
        # Si el precio no viene informado, el estándar lo fija en el create con
        # la cantidad de la propia línea; lo recalculamos con la cantidad total.
        auto_price = [not vals.get('price_unit') for vals in vals_list]
        lines = super().create(vals_list)
        to_reprice = lines.filtered(
            lambda l: auto_price[lines.ids.index(l.id)]
            and l.product_id and not l.display_type
            and l.selected_seller_id and l.state in ('draft', 'sent')
        )
        if to_reprice:
            to_reprice._compute_price_unit_and_date_planned_and_name()
        return lines

    # ------------------------------------------------------------------
    # Líneas generadas por reabastecimiento (planificador / reglas de stock)
    # ------------------------------------------------------------------
    @api.model
    def _prepare_purchase_order_line_from_procurement(
            self, product_id, product_qty, product_uom, location_dest_id, name, origin,
            company_id, values, po):
        res = super()._prepare_purchase_order_line_from_procurement(
            product_id, product_qty, product_uom, location_dest_id, name, origin,
            company_id, values, po)
        if location_dest_id and location_dest_id.usage == 'internal':
            res['dest_location_id'] = location_dest_id.id
        return res

    def _find_candidate(self, product_id, product_qty, product_uom, location_id, *args, **kwargs):
        # No fusionar necesidades de ubicaciones distintas en una misma línea
        lines = self.filtered(
            lambda l: not l.dest_location_id or not location_id or l.dest_location_id == location_id
        )
        return super(PurchaseOrderLine, lines)._find_candidate(
            product_id, product_qty, product_uom, location_id, *args, **kwargs)

    # ------------------------------------------------------------------
    # Movimientos de stock
    # ------------------------------------------------------------------
    def _prepare_stock_move_vals(self, picking, price_unit, product_uom_qty, product_uom):
        vals = super()._prepare_stock_move_vals(picking, price_unit, product_uom_qty, product_uom)
        if self.dest_location_id:
            vals['location_dest_id'] = self.dest_location_id.id
            vals['location_final_id'] = self.dest_location_id.id
        return vals
