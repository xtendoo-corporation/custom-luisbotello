// QA independiente: flujo de la capa POS (PaymentInterface + servicio OWL + parche de PosPayment)
// REALES sobre stubs de Odoo (ver harness/) y el MockTransport real detrás.
// No cubre PaymentScreen (overrides/payment_screen.js): requiere navegador, ver docs/qa_report.md.
// Los hallazgos QA corregidos son tests normales; los que siguen abiertos llevan { todo } en adversarial.test.js.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEY, makePos, tick, transportOf } from "./harness/pos.js";

const payCount = (t) => t.callLog.filter((c) => c.cmd === "fnDllOperPinPad").length;
const charges = (t) => t.operations.filter((o) => o.tipoOper === "Autorizacion" && o.resultado === "Autorizada");

async function fresh(opts) {
    const ctx = await makePos(opts);
    const transport = await transportOf(ctx);
    return { ...ctx, transport };
}

describe("PaymentRedsysTpvpc: cobro", () => {
    it("registro y clave: se registra 'redsys_tpvpc' y la clave se pide por RPC (no está en los datos del POS)", async () => {
        const { m, rpc, iface } = await fresh();
        assert.equal(m.stubs.registered.payment.redsys_tpvpc, m.payment.PaymentRedsysTpvpc);
        assert.deepEqual(rpc.map((r) => [r.model, r.fn, r.args]), [["pos.payment.method", "redsys_get_signature_key", [1]]]);
        assert.equal(iface.supports_reversals, false);
        assert.ok(!JSON.stringify(rpc).includes(KEY));
    });

    it("autorizado: línea done con pedido/RTS/XML/estado/referencia persistidos y ticket con marca, últimos 4 y pedido", async () => {
        const { addLine, transport } = await fresh();
        const line = addLine();
        assert.equal(await line.pay(), true);
        assert.equal(line.payment_status, "done");
        assert.equal(line.redsys_state, "authorized");
        const op = charges(transport)[0];
        assert.equal(line.transaction_id, op.pedido);
        assert.equal(line.redsys_rts, op.rts);
        assert.match(line.redsys_reference, /^ODOO-[0-9A-F]{8}$/);
        assert.equal(line.payment_ref_no, line.redsys_reference);
        assert.match(line.redsys_xml, /<estado>F<\/estado>/);
        assert.match(line.ticket, /PAGO TARJETA[\s\S]*\*\*\*\*0018[\s\S]*Pedido: \d+/);
        assert.equal(line.card_no, "0018");
        for (const f of ["ticket", "redsys_xml", "transaction_id", "redsys_rts", "card_no", "payment_ref_no"]) {
            assert.ok(!String(line[f]).includes(KEY), f);
        }
    });

    it("denegado: retry, sin estado Redsys, diálogo con el motivo; el reintento sobre la misma línea cobra una vez", async () => {
        const { addLine, transport, dialogs } = await fresh();
        const line = addLine();
        transport.forceNext({ name: "denied", denialCode: "116" });
        assert.equal(await line.pay(), false);
        assert.equal(line.payment_status, "retry");
        assert.ok(!line.redsys_state);
        assert.match(dialogs.at(-1).props.body, /denegada/i);
        assert.equal(await line.pay(), true);
        assert.equal(charges(transport).length, 1);
    });

    it("-2 con consulta fallida: UNKNOWN => force_done, estado y referencia persistidos, aviso 'NO repita'", async () => {
        const { addLine, transport, dialogs } = await fresh();
        const line = addLine();
        transport.forceNext("unknown_query_fails");
        assert.equal(await line.pay(), false);
        assert.equal(line.redsys_state, "unknown");
        assert.equal(line.payment_status, "force_done", "no 'retry': no se ofrece reintentar");
        assert.ok(line.redsys_reference);
        assert.match(dialogs.at(-1).props.body, /NO repita/);
        assert.equal(payCount(transport), 1);
    });

    it("con una línea unknown, otra línea del pedido NO puede cobrar (anti doble cobro)", async () => {
        const { addLine, transport, dialogs } = await fresh();
        const a = addLine();
        transport.forceNext("unknown_query_fails");
        await a.pay();
        const b = addLine();
        assert.equal(await b.pay(), false);
        assert.equal(payCount(transport), 1, "el segundo cobro ni llega al datáfono");
        assert.match(dialogs.at(-1).props.title, /pendiente/i);
    });

    it("QA-11 una línea 'unknown' o 'authorized' no debe poder volver a cobrarse invocando de nuevo su propia pay()", async () => {
        const { addLine, transport } = await fresh();
        const a = addLine();
        transport.forceNext("unknown_query_fails");
        await a.pay();
        assert.equal(a.redsys_state, "unknown");
        await a.pay(); // p. ej. "Reintentar" tras una recuperación fallida, tecla rápida, otra pestaña que reenvía
        const before = charges(transport).length;
        assert.equal(before, 1, `la misma línea (misma referencia) se cobró de nuevo: ${before} cargos`);
    });

    it("QA-11 una línea ya 'authorized' tampoco se reenvía: pay() de nuevo es idempotente (done, un solo cargo)", async () => {
        const { addLine, transport } = await fresh();
        const done = addLine();
        assert.equal(await done.pay(), true);
        assert.equal(await done.pay(), true);
        assert.equal(done.payment_status, "done");
        assert.equal(done.redsys_state, "authorized");
        assert.equal(charges(transport).length, 1, "una línea ya autorizada no se reenvía");
        assert.equal(payCount(transport), 1);
    });

    it("QA-13 doble clic en 'Reintentar': el 2º sendPaymentRequest no debe dejar la línea en 'retry' mientras el 1º sigue en curso", async () => {
        const { addLine, transport, svc, method } = await fresh();
        transport.setLatency({ cardRead: 60, process: 10, init: 0 });
        const line = addLine();
        const p1 = line.pay();
        const p2 = line.pay(); // doble clic dentro del mismo fotograma
        await tick(20); // el primer cobro sigue en el datáfono (esperando tarjeta)
        const midStatus = line.payment_status;
        assert.ok(svc.isOperationActive(method), "el primer cobro sigue en el datáfono");
        assert.notEqual(midStatus, "retry", "en 'retry' el cajero puede borrar la línea => cobro sin línea (huérfano) o reintentar");
        assert.equal(await p1, true);
        assert.equal(await p2, true);
        assert.equal(payCount(transport), 1);
        assert.equal(charges(transport).length, 1);
        assert.equal(line.payment_status, "done");
    });

    it("doble clic: aunque el estado se confunda, el datáfono recibe UN solo cobro y el resultado final es done", async () => {
        const { addLine, transport } = await fresh();
        transport.setLatency({ cardRead: 40, process: 10, init: 0 });
        const line = addLine();
        const [a, b] = await Promise.all([line.pay(), line.pay()]);
        assert.equal(payCount(transport), 1);
        assert.equal(charges(transport).length, 1);
        assert.equal(a || b, true);
        assert.equal(line.payment_status, "done");
    });

    it("cancelar: bloqueado durante la operación (explica por qué) y permitido sin operación ni cobro", async () => {
        const { addLine, transport, iface, dialogs, svc, method } = await fresh();
        transport.setLatency({ cardRead: 40, process: 10, init: 0 });
        const line = addLine();
        const p = line.pay();
        await tick(10);
        assert.equal(svc.isOperationActive(method), true);
        assert.equal(await iface.sendPaymentCancel({}, line.uuid), false);
        assert.match(dialogs.at(-1).props.body, /doble cobro/);
        await p;
        const other = addLine();
        assert.equal(await iface.sendPaymentCancel({}, other.uuid), true);
        assert.equal(await iface.sendPaymentCancel({}, line.uuid), false, "una línea autorizada no se cancela");
    });
});

describe("Recarga a mitad (recoverOrder)", () => {
    const inFlight = (addLine, ref = "ODOO-A1B2C3D1", extra = {}) =>
        addLine({ payment_status: "waitingCard", redsys_reference: ref, payment_ref_no: ref, ...extra });

    it("cobrado en Redsys: la línea queda done con datos recuperados y ticket", async () => {
        const { addLine, transport, svc, order } = await fresh();
        transport.seedOperation({ cents: 1234, factura: "ODOO-A1B2C3D1" });
        const line = inFlight(addLine);
        const results = await svc.recoverOrder(order, { silent: true });
        assert.equal(results[0].outcome.outcome, "authorized");
        assert.equal(line.payment_status, "done");
        assert.equal(line.redsys_state, "authorized");
        assert.ok(line.transaction_id && line.redsys_rts);
    });

    it("importe distinto en Redsys: unknown + force_done (revisión humana), no done", async () => {
        const { addLine, transport, svc, order } = await fresh();
        transport.seedOperation({ cents: 100, factura: "ODOO-A1B2C3D1" });
        const line = inFlight(addLine);
        await svc.recoverOrder(order, { silent: true });
        assert.equal(line.redsys_state, "unknown");
        assert.equal(line.payment_status, "force_done");
    });

    it("QA-01 consulta vacía dentro de la gracia: NO pasa a retry (el cobro puede seguir en el datáfono); se reconsulta sola", async () => {
        const { addLine, svc, order } = await fresh();
        const a = inFlight(addLine);
        const r = await svc.recoverOrder(order, { silent: true });
        assert.equal(r[0].outcome.outcome, "unknown");
        assert.equal(a.redsys_state, "unknown");
        assert.equal(a.payment_status, "force_done", "bloqueada: nada de reintentar");
    });

    it("QA-01 pasada la gracia y con datáfono sano: 'no consta cobro' pero SOLO el cajero libera la línea (releaseLine)", async () => {
        const { addLine, svc, order } = await fresh();
        svc.config.graceMs = 0;
        const a = inFlight(addLine);
        const r = await svc.recoverOrder(order, { silent: true });
        assert.equal(r[0].outcome.outcome, "not_charged");
        assert.equal(r[0].outcome.needsConfirmation, true);
        assert.equal(a.payment_status, "force_done", "sin confirmación no se pasa a retry");
        assert.equal(a.redsys_state, "unknown");
        assert.equal(svc.releaseLine(a), true);
        assert.equal(a.payment_status, "retry");
        assert.ok(!a.redsys_state);
    });

    it("QA-01 gracia vencida pero checkStatus falla: sigue sin concluirse 'no cobrado'", async () => {
        const { addLine, svc, order, transport } = await fresh();
        svc.config.graceMs = 0;
        const a = inFlight(addLine);
        transport.forceNext("check_terminal_fail");
        const r = await svc.recoverOrder(order, { silent: true });
        assert.equal(r[0].outcome.outcome, "unknown");
        assert.equal(a.payment_status, "force_done");
    });

    it("denegación registrada en Redsys: evidencia cierta, vuelve a retry sin esperar", async () => {
        const { addLine, transport, svc, order } = await fresh();
        transport.forceNext({ name: "denied", denialCode: "116" });
        const d = addLine();
        assert.equal(await d.pay(), false);
        d.setPaymentStatus("waitingCard"); // simula una recarga a mitad: el POS la restaura en curso
        d.redsys_state = false;
        const r = await svc.recoverOrder(order, { silent: true });
        assert.equal(r[0].outcome.outcome, "not_charged");
        assert.equal(d.payment_status, "retry");
    });

    it("la consulta falla: unknown/force_done y queda bloqueado", async () => {
        const { addLine, transport, svc, order } = await fresh();
        const b = inFlight(addLine, "ODOO-A1B2C3D2");
        transport.forceNext("unknown_query_fails"); // no aplica a consulta; usamos failConsults directo
        transport._failConsults = 1;
        await svc.recoverOrder(order, { silent: true });
        assert.equal(b.redsys_state, "unknown");
        assert.equal(b.payment_status, "force_done");
    });

    it("la recuperación fija paymentTerminalInProgress mientras dura y lo restaura", async () => {
        const { addLine, svc, order, pos } = await fresh();
        inFlight(addLine);
        const p = svc.recoverOrder(order, { silent: true });
        assert.equal(pos.paymentTerminalInProgress, true);
        await p;
        assert.equal(pos.paymentTerminalInProgress, false);
    });

    it("QA-14 dos recuperaciones solapadas (arranque + PaymentScreen.onMounted) dejan paymentTerminalInProgress=true para siempre", async () => {
        const { addLine, svc, order, pos } = await fresh();
        inFlight(addLine);
        await Promise.all([svc.recoverOrder(order, { silent: true }), svc.recoverOrder(order, { silent: true })]);
        assert.equal(pos.paymentTerminalInProgress, false, "bloqueo permanente de cobros con terminal hasta recargar");
    });

    it("QA-15 recoverOrder (PaymentScreen.onMounted) sobre una línea cuyo cobro está EN CURSO en esta pestaña no debe marcarla 'unknown'", async () => {
        const { addLine, transport, svc, order } = await fresh();
        transport.setLatency({ cardRead: 60, process: 10, init: 0, consult: 0 });
        const line = addLine();
        transport.forceNext("denied");
        const p = line.pay();
        await tick(15);
        await svc.recoverOrder(order, { silent: true }); // el cajero vuelve a la pantalla de pago mientras el cliente pasa la tarjeta
        assert.notEqual(line.redsys_state, "unknown", "el servicio está ocupado: la consulta falla y se marca unknown");
        await p;
        assert.equal(line.payment_status, "retry", "denegada de verdad: debe poder reintentarse, no quedar en force_done");
    });
});

describe("QA-23 PaymentScreen.deletePaymentLine (override real sobre stub del core)", () => {
    async function screenFor(ctx) {
        const { PaymentScreen } = ctx.m.stubs;
        const screen = Object.create(PaymentScreen.prototype);
        screen.paymentLines = ctx.order.payment_ids;
        screen.redsys = ctx.svc;
        screen.dialog = ctx.pos.dialog;
        return screen;
    }

    it("unknown/force_done, authorized y en curso NO se borran y se explica; retry limpio y no Redsys sí", async () => {
        const ctx = await fresh();
        const screen = await screenFor(ctx);
        const unknown = ctx.addLine();
        ctx.transport.forceNext("unknown_query_fails");
        await unknown.pay();
        assert.equal(unknown.payment_status, "force_done");
        screen.deletePaymentLine(unknown.uuid);
        assert.equal(screen.removed, undefined, "una línea dudosa no se borra");
        assert.match(ctx.dialogs.at(-1).props.body, /puede haberse realizado/);

        const retry = ctx.addLine();
        retry.payment_status = "retry";
        screen.deletePaymentLine(retry.uuid);
        assert.deepEqual(screen.removed, [retry.uuid], "retry limpio (sin cobro) sí se borra");

        const other = { uuid: "zzz", payment_method_id: { use_payment_terminal: "adyen" }, redsys_state: "unknown" };
        ctx.order.payment_ids.push(other);
        screen.deletePaymentLine("zzz");
        assert.deepEqual(screen.removed, [retry.uuid, "zzz"]);
    });

    it("una línea autorizada o con el cobro en curso (doble clic + papelera) no se borra", async () => {
        const ctx = await fresh();
        const screen = await screenFor(ctx);
        ctx.transport.setLatency({ cardRead: 60, process: 10, init: 0 });
        const line = ctx.addLine();
        const p = line.pay();
        await tick(20);
        line.payment_status = "retry"; // peor caso: estado 'retry' con el cobro vivo
        screen.deletePaymentLine(line.uuid);
        assert.equal(screen.removed, undefined);
        await p;
        screen.deletePaymentLine(line.uuid);
        assert.equal(screen.removed, undefined, "authorized tampoco");
    });
});

describe("Devoluciones desde la PaymentInterface", () => {
    async function paidOriginal(ctx, amount = 20) {
        const orig = ctx.addLine({ amount });
        assert.equal(await orig.pay(), true);
        return orig;
    }
    const refundLine = (ctx, orig, amount) => {
        const line = ctx.addLine({ amount: -amount, uuid: `ff${Math.random().toString(16).slice(2, 10)}-0000-0000-0000-000000000009` });
        line.uiState.redsysRefund = {
            pedido: orig.transaction_id,
            rts: orig.redsys_rts,
            amount: orig.amount,
            paymentUuid: orig.uuid,
        };
        line.redsys_original_pedido = orig.transaction_id;
        return line;
    };

    it("total y parcial acumuladas: el límite se aplica en el cliente ANTES de llegar al datáfono", async () => {
        const ctx = await fresh();
        const orig = await paidOriginal(ctx, 20);
        const r1 = refundLine(ctx, orig, 5);
        assert.equal(await r1.pay(), true);
        assert.equal(r1.redsys_state, "refund");
        assert.equal(r1.redsys_original_pedido, orig.transaction_id);
        assert.equal(r1.transaction_id !== orig.transaction_id, true);
        assert.match(r1.ticket, /DEVOLUCION TARJETA/);
        const r2 = refundLine(ctx, orig, 5);
        assert.equal(await r2.pay(), true);
        const calls = ctx.transport.callLog.length;
        const over = refundLine(ctx, orig, 15); // 5+5+15 > 20
        assert.equal(await over.pay(), false);
        assert.equal(ctx.transport.callLog.length, calls, "rechazada sin tocar el datáfono");
        assert.match(ctx.dialogs.at(-1).props.body, /no queda importe|más de lo cobrado/);
        const rest = refundLine(ctx, orig, 10);
        assert.equal(await rest.pay(), true);
    });

    it("devolución excesiva de una vez y sin RTS/pedido: rechazada en el cliente", async () => {
        const ctx = await fresh();
        const orig = await paidOriginal(ctx, 20);
        const calls = ctx.transport.callLog.length;
        assert.equal(await refundLine(ctx, orig, 20.01).pay(), false);
        const noRts = refundLine(ctx, orig, 5);
        noRts.uiState.redsysRefund.rts = null;
        assert.equal(await noRts.pay(), false);
        const noPedido = refundLine(ctx, orig, 5);
        noPedido.uiState.redsysRefund.pedido = null;
        assert.equal(await noPedido.pay(), false);
        assert.equal(ctx.transport.callLog.length, calls);
    });

    it("devolución -2 + consulta fallida: unknown y estado 'unknown' con redsys_original_pedido (cuenta para el límite)", async () => {
        const ctx = await fresh();
        const orig = await paidOriginal(ctx, 20);
        const r = refundLine(ctx, orig, 8);
        ctx.transport.forceNext("unknown_charged");
        ctx.transport._failConsults = 1;
        assert.equal(await r.pay(), false);
        assert.equal(r.redsys_state, "unknown");
        assert.equal(r.redsys_original_pedido, orig.transaction_id);
        const next = refundLine(ctx, orig, 13); // 8 (dudosa) + 13 > 20
        assert.equal(await next.pay(), false);
    });
    it("QA-24 con varias tarjetas Redsys en el pedido original, tras recargar se devuelve a la MISMA que se eligió", async () => {
        const ctx = await fresh();
        const origA = await paidOriginal(ctx, 20);
        const origB = await paidOriginal(ctx, 30);
        const refundedOrder = { payment_ids: [origA, origB] };
        const reload = (line) => {
            line.uiState.redsysRefund = null; // la recarga pierde uiState
            line.pos_order_id = { ...ctx.order, lines: [{ refunded_orderline_id: { order_id: refundedOrder } }] };
            return ctx.iface.refundInfoFor(line);
        };
        const lineB = refundLine(ctx, origB, 5);
        const infoB = reload(lineB);
        assert.equal(infoB.pedido, origB.transaction_id, "no la primera tarjeta válida");
        assert.equal(infoB.amount, 30, "límite = importe de la tarjeta elegida");
        const lineA = refundLine(ctx, origA, 5);
        assert.equal(reload(lineA).pedido, origA.transaction_id);
        // sin elección persistida y con varias tarjetas: ambiguo => sin info (la devolución se rechaza)
        const anon = refundLine(ctx, origA, 5);
        anon.redsys_original_pedido = false;
        assert.equal(reload(anon), null);
        // con una sola tarjeta sí es inequívoco
        refundedOrder.payment_ids = [origA];
        assert.equal(reload(anon).pedido, origA.transaction_id);
        // el pedido persistido ya no está entre los cobros válidos: no se cae a otra tarjeta
        const lost = refundLine(ctx, origB, 5);
        assert.equal(reload(lost), null);
    });
});
