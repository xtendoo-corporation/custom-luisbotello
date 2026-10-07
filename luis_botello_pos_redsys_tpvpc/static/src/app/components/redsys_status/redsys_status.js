/** @odoo-module */
import { Component, useState } from "@odoo/owl";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { Navbar } from "@point_of_sale/app/components/navbar/navbar";

const ICONS = {
    ok: "text-success",
    warn: "text-warning",
    error: "text-danger",
    busy: "text-info",
    idle: "text-muted",
};

/** Indicador del estado del datáfono (checkStatus periódico, nunca durante un cobro). */
export class RedsysStatus extends Component {
    static template = "luis_botello_pos_redsys_tpvpc.RedsysStatus";
    static props = {};
    setup() {
        this.redsys = useService("redsys_tpvpc");
        this.state = useState(this.redsys.state);
    }
    get items() {
        return this.redsys.redsysMethods().map((method) => {
            const st = this.state.statuses[method.id] || { level: "idle", text: "Datáfono sin comprobar" };
            return { method, text: st.text, cls: ICONS[st.level] || ICONS.idle, spin: st.level === "busy" };
        });
    }
    onClick(method) {
        this.redsys.checkNow(method, { reinit: true });
    }
}

patch(Navbar, {
    components: { ...Navbar.components, RedsysStatus },
});
