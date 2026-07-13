/** @odoo-module **/

import { ClosingPopup } from "@pos_conventional_session_management/js/closing_popup";
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";

patch(ClosingPopup.prototype, {
    async openCashCalculator() {
        const sessionId = this.props.sessionId;
        const sessionData = await this.orm.read("pos.session", [sessionId], [
            "qty_200", "qty_100", "qty_50", "qty_20", "qty_10", "qty_5",
            "qty_2", "qty_1", "qty_050", "qty_020", "qty_010", "qty_005"
        ]);
        const s = sessionData[0];

        await this.action.doAction({
            name: _t("Recuento de efectivo"),
            type: "ir.actions.act_window",
            res_model: "pos.cash.calculator.wizard",
            view_mode: "form",
            views: [[false, "form"]],
            target: "new",
            context: {
                default_parent_model: "pos.session",
                default_parent_res_id: sessionId,
                default_qty_200: s.qty_200,
                default_qty_100: s.qty_100,
                default_qty_50: s.qty_50,
                default_qty_20: s.qty_20,
                default_qty_10: s.qty_10,
                default_qty_5: s.qty_5,
                default_qty_2: s.qty_2,
                default_qty_1: s.qty_1,
                default_qty_050: s.qty_050,
                default_qty_020: s.qty_020,
                default_qty_010: s.qty_010,
                default_qty_005: s.qty_005,
            }
        }, {
            onClose: async () => {
                await this.loadClosingData();
                if (this.state.cashDetails) {
                    const session = await this.orm.read("pos.session", [sessionId], ["cash_register_balance_end_real"]);
                    const amount = session[0].cash_register_balance_end_real || 0;
                    this.state.payments[this.state.cashDetails.id].counted = this.formatAmount(amount);
                }
            }
        });
    }
});
