// QA independiente, ronda 3. Ver docs/qa_report3.md.
// Convencion: `{ todo }` = HALLAZGO ABIERTO; el test describe el comportamiento DESEADO, hoy falla y no rompe la
// suite. Al corregir el codigo pasara solo: quitar `todo`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    canDeleteRedsysLine,
    orderDeletionBlockers,
    pendingRedsysLines,
    unresolvedLines,
} from "../../static/src/app/utils/redsys_pos_logic.js";
import { makePos } from "./harness/pos.js";

const method = { use_payment_terminal: "redsys_tpvpc" };

describe("ronda 3: liberacion de una linea unknown ya sincronizada (QA2-04) y recarga", () => {
    it("tras liberar en servidor, el POS reenvia y borra la linea; si el borrado local no llega a sincronizarse (recarga) el servidor devuelve `not_charged` + payment_status `force_done`: debe seguir siendo borrable y no bloquear la validacion (R3-06)", { todo: "R3-06 abierto" }, () => {
        const reloaded = { payment_method_id: method, redsys_state: "not_charged", payment_status: "force_done", amount: 10, uuid: "u1" };
        assert.equal(canDeleteRedsysLine(reloaded).ok, true, "borrable");
        assert.deepEqual(pendingRedsysLines([reloaded]), [], "no bloquea validar");
        assert.deepEqual(orderDeletionBlockers({ payment_ids: [reloaded] }), [], "no bloquea cancelar el pedido");
        assert.deepEqual(unresolvedLines([reloaded]), [], "no bloquea un segundo cobro");
    });

    it("caracterizacion R3-06: hoy esa linea queda bloqueada por completo (ni borrable, ni validable, ni cancelable)", () => {
        const reloaded = { payment_method_id: method, redsys_state: "not_charged", payment_status: "force_done", amount: 10, uuid: "u1" };
        assert.equal(canDeleteRedsysLine(reloaded).ok, false);
        assert.equal(pendingRedsysLines([reloaded]).length, 1);
        assert.equal(orderDeletionBlockers({ payment_ids: [reloaded] }).length, 1);
    });

    it("liberacion local (linea sin id de servidor) y liberacion en servidor (id numerico) dejan la linea sin bloqueo en esta sesion", async () => {
        const ctx = await makePos();
        const { svc, addLine, rpc } = ctx;
        const local = addLine({ redsys_state: "unknown", payment_status: "force_done", redsys_reference: "ODOO-LOCAL001", payment_ref_no: "ODOO-LOCAL001" });
        assert.equal(await svc.releaseLine(local), true);
        assert.equal(local.redsys_state, false);
        assert.equal(local.payment_status, "retry");
        assert.equal(rpc.filter((r) => r.fn === "redsys_release_unknown").length, 0, "sin RPC si la linea no esta en servidor");
        const synced = addLine({ id: 77, redsys_state: "unknown", payment_status: "force_done", redsys_reference: "ODOO-SYNCED01", payment_ref_no: "ODOO-SYNCED01" });
        assert.equal(await svc.releaseLine(synced), true);
        assert.equal(synced.redsys_state, "not_charged");
        assert.deepEqual(rpc.filter((r) => r.fn === "redsys_release_unknown").map((r) => r.args), [[[77]]]);
        assert.equal(pendingRedsysLines([synced]).length, synced.payment_status === "force_done" ? 1 : 0,
            "con el stub (sin removePaymentline) queda en retry: sin bloqueo");
    });
});

describe("ronda 3: guardar para conciliacion", () => {
    it("el diálogo 'Guardar el pedido para conciliación' debe sincronizar con throw:true para que un fallo llegue al AlertDialog (hoy syncAllOrders sin throw lo traga)", { todo: "R3-07 abierto" }, async () => {
        const ctx = await makePos();
        const { m, pos, addLine, dialogs, order } = ctx;
        const store = new m.stubs.PosStore();
        store.dialog = pos.dialog;
        order.id = 3;
        addLine({ redsys_state: "unknown", payment_status: "force_done", redsys_reference: "ODOO-SAVE0003" });
        await store._onBeforeDeleteOrder(order);
        await dialogs.at(-1).props.confirm();
        assert.equal(store.synced[0].throw, true);
    });
});
