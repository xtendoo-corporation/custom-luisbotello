import assert from "node:assert/strict";
import { test } from "node:test";
import {
    authorizedVals,
    canRefundRedsysLine,
    chooseTransportKind,
    interpretPayResult,
    interpretQuery,
    needsRecovery,
    previousRefunds,
    receiptText,
    recoveryWindow,
    refundableAmount,
    statusFromCode,
    unresolvedLines,
    validateMethodConfig,
    validateRefund,
} from "../../static/src/app/utils/redsys_pos_logic.js";

const method = { use_payment_terminal: "redsys_tpvpc" };
const AUTH = {
    status: "authorized",
    pedido: "10549",
    rts: "123456789012345678901234",
    reference: "ODOO-AB12CD34",
    authCode: "654321",
    cardBrand: "VISA",
    last4: "0018",
    date: "20261007 101010",
    rawXml: "<x/>",
};

test("autorizado: rellena pedido, rts, xml, estado, marca, last4, authcode", () => {
    const d = interpretPayResult(AUTH);
    assert.equal(d.outcome, "done");
    assert.deepEqual(
        { ...d.vals },
        {
            transaction_id: "10549",
            payment_ref_no: "ODOO-AB12CD34",
            redsys_reference: "ODOO-AB12CD34",
            redsys_rts: AUTH.rts,
            redsys_xml: "<x/>",
            redsys_state: "authorized",
            card_brand: "VISA",
            card_type: "VISA",
            card_no: "0018",
            payment_method_authcode: "654321",
        }
    );
    assert.match(d.receipt, /VISA \*\*\*\*0018/);
    assert.match(d.receipt, /Autorizacion: 654321/);
    assert.match(d.receipt, /Pedido: 10549/);
    assert.match(d.receipt, /Fecha: 20261007/);
});

test("devolucion autorizada: estado refund y cabecera de ticket", () => {
    const d = interpretPayResult(AUTH, { isRefund: true });
    assert.equal(d.vals.redsys_state, "refund");
    assert.match(receiptText(AUTH, { isRefund: true }), /DEVOLUCION/);
});

test("autorizado con importe distinto o multiples => unknown, no done", () => {
    const d = interpretPayResult({ ...AUTH, warning: "AMOUNT_MISMATCH" });
    assert.equal(d.outcome, "unknown");
    assert.equal(d.vals.redsys_state, "unknown");
    assert.equal(d.receipt, null);
});

test("denegado y error => retry sin valores", () => {
    for (const status of ["denied", "error"]) {
        const d = interpretPayResult({ status, userMessage: "no", reference: "ODOO-1" });
        assert.equal(d.outcome, "retry");
        assert.deepEqual(d.vals, {});
        assert.equal(d.message, "no");
    }
});

test("unknown: persiste estado y referencia, advierte de no repetir", () => {
    const d = interpretPayResult({ status: "unknown", reference: "ODOO-AB12CD34" });
    assert.equal(d.outcome, "unknown");
    assert.deepEqual(d.vals, {
        redsys_state: "unknown",
        redsys_reference: "ODOO-AB12CD34",
        payment_ref_no: "ODOO-AB12CD34",
    });
    assert.match(d.message, /NO repita/);
});

test("interpretQuery: autorizada => authorized; sin operaciones => not_charged; P / error => unknown", () => {
    const op = { estado: "F", resultado: "Autorizada", factura: "R1", pedido: "5", rts: "9", importe: "12.50", last4: "1111", fecha: "f" };
    const ok = interpretQuery({ operations: [op] }, { reference: "R1", amount: 12.5 });
    assert.equal(ok.outcome, "authorized");
    assert.equal(ok.vals.redsys_state, "authorized");
    assert.equal(interpretQuery({ operations: [op] }, { reference: "R1", amount: -12.5, isRefund: true }).vals.redsys_state, "refund");
    assert.equal(interpretQuery({ operations: [op] }, { reference: "R1", amount: 10 }).outcome, "unknown");
    assert.equal(interpretQuery({ operations: [] }, { reference: "R1", amount: 1 }).outcome, "not_charged");
    assert.equal(
        interpretQuery({ operations: [{ ...op, estado: "G", resultado: "DENEGADA" }] }, { reference: "R1", amount: 12.5 }).outcome,
        "not_charged"
    );
    assert.equal(interpretQuery({ operations: [{ ...op, estado: "P", resultado: "x" }] }, { reference: "R1", amount: 12.5 }).outcome, "unknown");
    assert.equal(interpretQuery({ error: { message: "x" } }, {}).outcome, "unknown");
    // otra referencia no cuenta
    assert.equal(interpretQuery({ operations: [op] }, { reference: "OTRA", amount: 12.5 }).outcome, "not_charged");
});

const orig = {
    payment_method_id: method,
    redsys_state: "authorized",
    transaction_id: "10549",
    redsys_rts: "RTS1",
    amount: 20,
    uuid: "u1",
};

test("devolucion: exige pedido y RTS y estado autorizado", () => {
    assert.equal(canRefundRedsysLine(orig).ok, true);
    assert.equal(canRefundRedsysLine({ ...orig, redsys_rts: "" }).ok, false);
    assert.match(canRefundRedsysLine({ ...orig, transaction_id: "" }).reason, /no se puede devolver/);
    assert.equal(canRefundRedsysLine({ ...orig, redsys_state: "unknown" }).ok, false);
    assert.equal(canRefundRedsysLine({ ...orig, payment_method_id: { use_payment_terminal: "adyen" } }).ok, false);
    assert.equal(canRefundRedsysLine(null).ok, false);
});

test("devolucion: parcial/total <= original", () => {
    const info = { pedido: "1", rts: "r", amount: 20 };
    assert.equal(validateRefund(info, -5).ok, true);
    assert.equal(validateRefund(info, -20).ok, true);
    assert.equal(validateRefund(info, -20.01).ok, false);
    assert.equal(validateRefund(info, 0).ok, false);
    assert.equal(validateRefund({ pedido: "1", rts: "", amount: 20 }, -5).ok, false);
    assert.equal(refundableAmount(orig, [{ amount: -5 }, { amount: -7.5 }]), 7.5);
    assert.equal(refundableAmount(orig, [{ amount: -25 }]), 0);
});

test("recuperacion: lineas a medias o desconocidas", () => {
    const base = { payment_method_id: method, redsys_reference: "ODOO-1" };
    assert.equal(needsRecovery({ ...base, payment_status: "waiting" }), true);
    assert.equal(needsRecovery({ ...base, payment_status: "waitingCard" }), true);
    assert.equal(needsRecovery({ ...base, payment_status: "force_done", redsys_state: "unknown" }), true);
    assert.equal(needsRecovery({ ...base, payment_status: "retry" }), false);
    assert.equal(needsRecovery({ ...base, payment_status: "done" }), false);
    assert.equal(needsRecovery({ ...base, payment_status: "pending" }), false);
    assert.equal(needsRecovery({ payment_method_id: method, payment_status: "waiting" }), false); // sin referencia
    assert.equal(needsRecovery({ ...base, payment_method_id: {}, payment_status: "waiting" }), false);
});

test("bloqueo de segundo cobro: desconocidas y en curso", () => {
    const l = (o) => ({ payment_method_id: method, uuid: "x", ...o });
    assert.equal(unresolvedLines([l({ redsys_state: "unknown" })]).length, 1);
    assert.equal(unresolvedLines([l({ payment_status: "waiting" })]).length, 1);
    assert.equal(unresolvedLines([l({ payment_status: "done", redsys_state: "authorized" })]).length, 0);
    assert.equal(unresolvedLines([l({ payment_status: "waiting", uuid: "me" })], "me").length, 0);
});

test("ventana de consulta +-10 min alrededor de la fecha de la linea", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    const w = recoveryWindow(new Date("2026-10-07T09:50:00Z"), now);
    assert.equal(w.from.toISOString(), "2026-10-07T09:40:00.000Z");
    assert.equal(w.to.toISOString(), "2026-10-07T10:10:00.000Z");
    assert.ok(recoveryWindow(null, now).from < now);
    assert.equal(recoveryWindow({ toJSDate: () => new Date("2026-10-07T09:00:00Z") }, now).from.toISOString(), "2026-10-07T08:50:00.000Z");
});

test("transporte: mock SOLO con simulacion del metodo Y flag de URL", () => {
    const flag = (s) => /redsys_sim=1/.test(s);
    const k = (o) => chooseTransportKind({ flagCheck: flag, ...o });
    assert.equal(k({ transport: "js", simulation: true, search: "?redsys_sim=1" }), "mock");
    assert.equal(k({ transport: "js", simulation: true, search: "" }), "js");
    assert.equal(k({ transport: "js", simulation: false, search: "?redsys_sim=1" }), "js");
    assert.equal(k({ transport: "http", simulation: false, search: "?redsys_sim=1" }), "http");
    assert.equal(k({ transport: "http", simulation: undefined, search: "" }), "http");
    assert.equal(k({ transport: undefined, simulation: "true", search: "?redsys_sim=1" }), "js");
});

test("config de metodo", () => {
    assert.match(validateMethodConfig({ redsys_terminal_number: "1" }, "k"), /FUC/);
    assert.match(validateMethodConfig({ redsys_merchant_code: "1" }, "k"), /terminal/);
    assert.match(validateMethodConfig({ redsys_merchant_code: "1", redsys_terminal_number: "1" }, ""), /clave/);
    assert.equal(validateMethodConfig({ redsys_merchant_code: "1", redsys_terminal_number: "1" }, "k"), null);
});

test("indicador", () => {
    assert.equal(statusFromCode(0).level, "ok");
    assert.equal(statusFromCode(-2).level, "error");
    assert.equal(statusFromCode(-3).level, "warn");
    assert.equal(statusFromCode(-1, { initialized: false }).level, "idle");
    assert.equal(statusFromCode(0, { busy: true }).level, "busy");
});

test("authorizedVals nunca incluye PAN completo", () => {
    const v = authorizedVals({ ...AUTH, maskedPan: "************0018" });
    assert.ok(!JSON.stringify(v).includes("************"));
});

test("devoluciones previas: acumula por redsys_original_pedido y respeta el limite", () => {
    const m = { id: 7, use_payment_terminal: "redsys_tpvpc" };
    const o = { ...orig, transaction_id: "10549", payment_method_id: m, amount: 20 };
    const r = (amount, extra = {}) => ({
        amount,
        payment_method_id: m,
        redsys_state: "refund",
        redsys_original_pedido: "10549",
        ...extra,
    });
    const payments = [
        o,
        r(-5),
        r(-7.5, { redsys_state: "unknown" }),
        r(-3, { redsys_original_pedido: "99999" }), // otro cobro
        r(-2, { redsys_state: false }), // no confirmada
        r(-4, { payment_method_id: { id: 8, use_payment_terminal: "redsys_tpvpc" } }), // otro metodo
        r(6), // positiva: no es devolucion
    ];
    const prev = previousRefunds(o, payments);
    assert.equal(prev.length, 2);
    assert.equal(refundableAmount(o, prev), 7.5);
    assert.deepEqual(previousRefunds({ ...o, transaction_id: "" }, payments), []);
    assert.equal(refundableAmount(o, previousRefunds(o, [r(-20)])), 0);
});

test("validateRefund con devoluciones ya realizadas", () => {
    const info = { pedido: "1", rts: "r", amount: 20 };
    assert.equal(validateRefund(info, -5, 15).ok, true);
    assert.equal(validateRefund(info, -5.01, 15).ok, false);
    assert.equal(validateRefund(info, -5).ok, true);
});

test("la devolucion autorizada/desconocida guarda redsys_original_pedido; el cobro no", () => {
    const ok = interpretPayResult(AUTH, { isRefund: true, originalPedido: "10549" });
    assert.equal(ok.vals.redsys_original_pedido, "10549");
    assert.equal(ok.vals.redsys_state, "refund");
    const warn = interpretPayResult({ ...AUTH, warning: "AMOUNT_MISMATCH" }, { isRefund: true, originalPedido: "10549" });
    assert.equal(warn.vals.redsys_original_pedido, "10549");
    const unk = interpretPayResult({ status: "unknown", reference: "R" }, { isRefund: true, originalPedido: 10549 });
    assert.equal(unk.vals.redsys_original_pedido, "10549");
    assert.equal(interpretPayResult(AUTH).vals.redsys_original_pedido, undefined);
    assert.equal(authorizedVals(AUTH, { originalPedido: "1" }).redsys_original_pedido, undefined);
});
