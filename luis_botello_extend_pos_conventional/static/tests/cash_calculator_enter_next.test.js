/** @odoo-module */

import { expect, test } from "@odoo/hoot";
import { press } from "@odoo/hoot-dom";
import { mountOnFixture } from "@odoo/hoot-mock";
import { Component, xml } from "@odoo/owl";

import "@luis_botello_extend_pos_conventional/js/cash_calculator_enter_next";

test("Enter salta a la siguiente cantidad del recuento", async () => {
    class Dummy extends Component {
        static template = xml`
            <div class="o_cash_calculator_wizard">
                <div class="o_cash_qty_group"><input class="a"/></div>
                <div class="o_cash_qty_group"><input class="b"/></div>
                <button name="action_confirm" class="c"/>
            </div>`;
        static props = {};
    }
    await mountOnFixture(Dummy);
    document.querySelector("input.a").focus();
    await press("Enter");
    expect(document.activeElement).toBe(document.querySelector("input.b"));
    await press("Enter");
    expect(document.activeElement).toBe(document.querySelector("button.c"));
});
