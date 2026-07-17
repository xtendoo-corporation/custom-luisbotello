/** @odoo-module **/

import { Orderline } from "@point_of_sale/app/components/orderline/orderline";
import { patch } from "@web/core/utils/patch";
import { formatCurrency } from "@web/core/currency";

patch(Orderline.prototype, {
    get lineScreenValues() {
        const res = super.lineScreenValues;
        const line = this.props.line;
        if (line && res.discount) {
            const discountAmount = line.displayPriceNoDiscount - line.displayPrice;
            res.discountAmount = formatCurrency(discountAmount, line.currency.id);
        }
        return res;
    },
});


