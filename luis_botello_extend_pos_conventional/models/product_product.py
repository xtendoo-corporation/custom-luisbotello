# -*- coding: utf-8 -*-
from odoo import api, models


class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def name_search(self, name='', domain=None, operator='ilike', limit=100):
        """
        Extend name_search to allow partial barcode matching in POS context.

        Strategy:
        - First, call super().name_search() to preserve default behaviour.
        - If no results and the search appears to come from POS (context keys
          like 'from_pos', 'pos_session_id' or 'pos_order_id') or the input
          looks like a barcode (numeric and length >= 3), perform a
          fallback search on ('barcode', 'ilike', name).
        - This keeps the change limited to POS and avoids impacting global
          searches in other areas.
        """
        # Preserve standard behaviour first
        res = super(ProductProduct, self).name_search(name=name, domain=domain, operator=operator, limit=limit)
        if res:
            return res

        if not name:
            return res

        ctx = self.env.context or {}
        do_pos_barcode_search = False

        # Activate when explicitly in POS context
        if ctx.get('from_pos') or ctx.get('pos_session_id') or ctx.get('pos_order_id'):
            do_pos_barcode_search = True
        else:
            # Heuristic: if input is numeric and of reasonable length, assume barcode typing
            try:
                if name.isdigit() and len(name) >= 3:
                    do_pos_barcode_search = True
            except Exception:
                do_pos_barcode_search = False

        if not do_pos_barcode_search:
            return res

        domain = domain or []
        products = self.search([('barcode', 'ilike', name)] + domain, limit=limit)
        if products:
            return [(p.id, p.display_name) for p in products]
        return res

