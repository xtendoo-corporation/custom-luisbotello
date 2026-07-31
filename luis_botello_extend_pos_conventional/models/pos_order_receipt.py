from odoo import models


class PosOrderReceiptData(models.Model):
    _inherit = "pos.order"

    def get_order_receipt_data(self, order_id):
        # Call parent to collect base data
        result = super(PosOrderReceiptData, self).get_order_receipt_data(order_id)
        # If parent returned falsy (some sub-modules may return {} or None when
        # they only provide enrichment fields), do not bail out early. Create
        # an empty dict so we can fallback to building payment data from the
        # order record when needed.
        if not result:
            result = {}

        # Ensure payment_ids entries include method type and is_cash_count
        payments = result.get("payment_ids") or []
        # Some sub-modules (pos_conventional_receipt_custom) return only
        # enrichment fields and do not call super() to include core data.
        # In that case `payment_ids` can be empty here even if the DB has
        # pos.payment records. Fallback to building payment_ids from the
        # order record when needed.
        if not payments:
            order = self.browse(order_id)
            payments = []
            for p in order.payment_ids:
                pm = p.payment_method_id
                payments.append({
                    'id': p.id,
                    'amount': p.amount,
                    'payment_method_id': [pm.id, pm.name],
                    'payment_method_type': getattr(pm, 'payment_method_type', False) or getattr(pm, 'type', False),
                    'payment_method_is_cash_count': bool(getattr(pm, 'is_cash_count', False)),
                })
        enriched = []
        for p in payments:
            # p expected shape: {"amount": ..., "payment_method_id": [id, name], ...}
            pm = p.get("payment_method_id")
            pm_type = p.get("payment_method_type")
            pm_is_cash_count = p.get("payment_method_is_cash_count")
            # If flags not present, try to infer from name (best-effort)
            if pm_is_cash_count is None:
                name = ""
                if isinstance(pm, (list, tuple)) and len(pm) > 1:
                    name = (pm[1] or "").lower()
                elif isinstance(pm, dict):
                    name = (pm.get("name") or "").lower()
                pm_is_cash_count = ("efectiv" in name) or ("cash" in name)
            enriched.append({
                **p,
                "payment_method_type": pm_type,
                "payment_method_is_cash_count": bool(pm_is_cash_count),
            })
        result["payment_ids"] = enriched
        return result

