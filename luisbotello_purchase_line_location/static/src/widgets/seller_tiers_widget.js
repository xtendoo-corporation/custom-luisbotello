import { Component } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { usePopover } from "@web/core/popover/popover_hook";
import { _t } from "@web/core/l10n/translation";
import { sprintf } from "@web/core/utils/strings";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";

export class SellerTiersPopover extends Component {
    static template = "luisbotello_purchase_line_location.SellerTiersPopover";
    static props = {
        mode: String,
        data: Object,
        close: Function,
    };

    get nextMessage() {
        const next = this.props.data.next;
        return sprintf(_t("Add %(missing)s more to reach %(min)s (%(discount)s%% discount)."), {
            missing: next.missing,
            min: next.min_qty,
            discount: next.discount,
        });
    }
}

export class SellerTiersWidget extends Component {
    static template = "luisbotello_purchase_line_location.SellerTiers";
    static props = { ...standardWidgetProps };
    setup() {
        this.popover = usePopover(SellerTiersPopover, { position: "top" });
    }

    get data() {
        return this.props.record.data.seller_tiers_data || false;
    }

    show(ev, mode) {
        this.popover.open(ev.currentTarget, { mode, data: this.data });
    }
}

export const sellerTiersWidget = {
    component: SellerTiersWidget,
    fieldDependencies: [{ name: "seller_tiers_data", type: "json" }],
};
registry.category("view_widgets").add("lb_seller_tiers", sellerTiersWidget);
