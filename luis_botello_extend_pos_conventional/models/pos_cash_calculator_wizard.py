# -*- coding: utf-8 -*-
from odoo import api, fields, models

class PosCashCalculatorWizard(models.TransientModel):
    _inherit = "pos.cash.calculator.wizard"

    parent_model = fields.Selection(
        selection_add=[("pos.session", "Sesión POS")],
        ondelete={"pos.session": "cascade"},
    )

    def action_confirm(self):
        self.ensure_one()
        if self.parent_model == "pos.session":
            parent = self._get_parent_wizard()
            if parent:
                parent.write({
                    "cash_register_balance_end_real": self.total,
                    "qty_200": self.qty_200,
                    "qty_100": self.qty_100,
                    "qty_50": self.qty_50,
                    "qty_20": self.qty_20,
                    "qty_10": self.qty_10,
                    "qty_5": self.qty_5,
                    "qty_2": self.qty_2,
                    "qty_1": self.qty_1,
                    "qty_050": self.qty_050,
                    "qty_020": self.qty_020,
                    "qty_010": self.qty_010,
                    "qty_005": self.qty_005,
                    "qty_002": self.qty_002,
                    "qty_001": self.qty_001,
                })
                return {"type": "ir.actions.act_window_close"}
        return super().action_confirm()

    def action_clear(self):
        self.ensure_one()
        self.write({
            "qty_200": 0, "qty_100": 0, "qty_50": 0, "qty_20": 0, "qty_10": 0, "qty_5": 0,
            "qty_2": 0, "qty_1": 0, "qty_050": 0, "qty_020": 0, "qty_010": 0, "qty_005": 0,
            "qty_002": 0, "qty_001": 0,
        })
        if self.parent_model == "pos.session":
            parent = self._get_parent_wizard()
            if parent:
                parent.write({
                    "qty_200": 0, "qty_100": 0, "qty_50": 0, "qty_20": 0, "qty_10": 0, "qty_5": 0,
                    "qty_2": 0, "qty_1": 0, "qty_050": 0, "qty_020": 0, "qty_010": 0, "qty_005": 0,
                    "qty_002": 0, "qty_001": 0,
                })
        return self._reload_view()
