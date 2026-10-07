// Harness QA del POS: carga el servicio OWL `redsys_tpvpc`, la PaymentInterface y el
// parche de PosPayment REALES sobre stubs de Odoo, con el MockTransport detrás.
import { register } from "node:module";

export const KEY = "QA-SECRET-KEY-9f8e7d6c";
export const METHOD_ID = 7;

class FakeEl {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.style = {};
        this.attrs = {};
        this.parentNode = null;
    }
    setAttribute(k, v) {
        this.attrs[k] = v;
    }
    appendChild(c) {
        c.parentNode = this;
        this.children.push(c);
        return c;
    }
    removeChild(c) {
        this.children = this.children.filter((x) => x !== c);
        c.parentNode = null;
    }
}

let loaded = null;

/** Carga (una vez por proceso) los módulos reales con los stubs de Odoo. */
export async function loadPos() {
    if (loaded) {
        return loaded;
    }
    register("./loader.mjs", import.meta.url);
    // El servicio crea un setInterval de 45 s: no debe mantener vivo el proceso de test.
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = (fn, ms) => {
        const t = realSetInterval(fn, ms);
        t.unref?.();
        return t;
    };
    globalThis.window = {
        location: { search: "?redsys_sim=1", hash: "" },
        document: { createElement: (t) => new FakeEl(t), body: new FakeEl("body") },
        addEventListener() {},
    };
    const root = "../../../static/src/app/";
    const stubs = await import("./stubs.mjs");
    const mock = await import(root + "redsys/mock/mock_transport.js");
    // Latencia 0 por defecto en cualquier MockTransport creado por la fábrica.
    const origSetLatency = mock.MockTransport.prototype.setLatency;
    mock.MockTransport.prototype.setLatency = function (l) {
        return origSetLatency.call(this, l ?? 0);
    };
    await import(root + "overrides/pos_payment.js");
    const payment = await import(root + "payment/payment_redsys_tpvpc.js");
    const service = await import(root + "services/redsys_tpvpc_service.js");
    const logic = await import(root + "utils/redsys_pos_logic.js");
    loaded = { stubs, mock, payment, service, logic };
    return loaded;
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Crea un POS falso + servicio real + PaymentInterface real.
 * @param {Object} [o]
 * @param {boolean} [o.boot=false] deja que el servicio haga su boot() al arrancar
 * @param {boolean} [o.simulation=true] método con redsys_simulation
 */
export async function makePos({ boot = false, simulation = true } = {}) {
    const m = await loadPos();
    const { PosPayment } = m.stubs;
    const method = {
        id: METHOD_ID,
        use_payment_terminal: "redsys_tpvpc",
        payment_method_type: "terminal",
        redsys_merchant_code: "777888991",
        redsys_terminal_number: "1",
        redsys_com_port: "COM9:,19200,N,8,1",
        redsys_protocol_version: "6.1",
        redsys_transport: "js",
        redsys_simulation: simulation,
    };
    const orders = [];
    const lines = [];
    const dialogs = [];
    const notifications = [];
    const rpc = [];
    const pos = {
        // Sin boot, la lista está vacía mientras el servicio programa su boot() (setTimeout 0).
        config: { id: 1, payment_method_ids: boot ? [method] : [] },
        models: {
            "pos.order": { filter: (fn) => orders.filter(fn) },
            "pos.payment": {
                getBy: (f, v) => lines.find((l) => l[f] === v),
                getAll: () => lines,
            },
        },
        dialog: { add: (cls, props) => dialogs.push({ cls, props }) },
        notification: { add: (msg, o) => notifications.push({ msg, o }) },
        paymentTerminalInProgress: false,
        env: { services: {} },
    };
    const orm = {
        call: async (model, fn, args) => {
            rpc.push({ model, fn, args });
            return { [method.id]: KEY };
        },
    };
    const svc = m.service.redsysTpvpcService.start(pos.env, { pos, orm });
    pos.env.services.redsys_tpvpc = svc;
    if (!boot) {
        await tick(5); // deja pasar el boot() vacío del servicio
        pos.config.payment_method_ids = [method];
    }
    const iface = new m.payment.PaymentRedsysTpvpc(pos, method);
    method.payment_terminal = iface;
    let n = 0;
    const order = { uuid: "order-1", finalized: false, payment_ids: [], lines: [] };
    orders.push(order);
    const addLine = (vals = {}) => {
        n += 1;
        const uuid = vals.uuid || `a1b2c3d${n}-0000-0000-0000-00000000000${n}`;
        const line = new PosPayment({
            uuid,
            payment_method_id: method,
            pos_order_id: order,
            amount: 12.34,
            payment_date: new Date(),
            ...vals,
        });
        order.payment_ids.push(line);
        lines.push(line);
        return line;
    };
    return { m, pos, svc, iface, method, order, addLine, dialogs, notifications, rpc, orm };
}

/** Transporte mock del método (se crea tras ensureReady). */
export async function transportOf(ctx) {
    const got = await ctx.svc.getEntry(ctx.method);
    return got.entry.transport;
}
