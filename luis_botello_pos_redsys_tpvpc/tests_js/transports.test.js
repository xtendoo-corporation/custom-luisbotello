import test from "node:test";
import assert from "node:assert/strict";
import { RealJsTransport } from "../static/src/app/redsys/transports/real_js_transport.js";
import { RealHttpTransport } from "../static/src/app/redsys/transports/real_http_transport.js";
import { RedsysService } from "../static/src/app/redsys/redsys_service.js";

class FakeImpl {
    constructor() {
        this.log = [];
        this.subs = {};
    }
    initFnDll(args, cb) {
        this.log.push(["init", args]);
        setTimeout(() => cb({ Response: 0, Result: null }), 0);
    }
    execFnDll(name, args, cb) {
        this.log.push([name, args]);
        setTimeout(() => cb({ Response: 0, Result: "<x/>" }), 0);
    }
    subscribeEvent(n, cb) {
        this.subs[n] = cb;
    }
    EnableLog() {
        this.log.push(["EnableLog"]);
    }
    DisableLog() {
        this.log.push(["DisableLog"]);
    }
}

test("RealJs: delega en tpvpc-impl, log desactivado por defecto, suscripciones diferidas", async () => {
    const impl = new FakeImpl();
    const t = new RealJsTransport({ loader: async () => impl });
    const got = [];
    t.subscribeEvent("pinpadImplantadoEvent_1", (p) => got.push(p)); // antes de cargar
    const ret = await new Promise((r) => t.execFnDll("fnDllCheckStatus", [], r));
    assert.equal(ret.Response, 0);
    impl.subs["pinpadImplantadoEvent_1"]("hola");
    assert.deepEqual(got, ["hola"]);
    assert.ok(impl.log.some((l) => l[0] === "DisableLog"));
    assert.ok(!impl.log.some((l) => l[0] === "EnableLog"));
});

test("RealJs: librería ausente => -98 (transporte), no excepción", async () => {
    const t = new RealJsTransport({ globalObject: {} });
    const ret = await new Promise((r) => t.initFnDll(["a"], r));
    assert.equal(ret.Response, -98);
});

test("RealJs: el callback se invoca una sola vez aunque la librería lo duplique", async () => {
    const impl = new FakeImpl();
    impl.execFnDll = (n, a, cb) => {
        cb({ Response: 0, Result: "a" });
        cb({ Response: -5, Result: "b" });
    };
    const t = new RealJsTransport({ impl });
    let n = 0;
    await new Promise((r) =>
        t.execFnDll("x", [], () => {
            n += 1;
            setTimeout(r, 5);
        })
    );
    assert.equal(n, 1);
});

test("RealJs integrado con el servicio", async () => {
    const impl = new FakeImpl();
    const svc = new RedsysService({ callTimeoutMs: 0, sleep: async () => {} });
    svc.configure({ merchant: "1", terminal: "1", signKey: "K", port: "COM1:", version: "6.1", transport: new RealJsTransport({ impl }) });
    assert.equal((await svc.init()).ok, true);
    assert.deepEqual((await svc.checkStatus()).code, 0);
});

test("RealHttp: formato JSON documentado y normalización de respuesta", async () => {
    const sent = [];
    const fetchImpl = async (url, opts) => {
        sent.push([url, opts]);
        return { json: async () => ({ Type: "response", Command: "fnDllOperPinPad", Response: 0, Result: "<x/>" }) };
    };
    const t = new RealHttpTransport({ fetchImpl });
    const ret = await new Promise((r) => t.execFnDll("fnDllOperPinPad", ["12.34", "ODOO-A", "PAGO"], r));
    assert.deepEqual(ret, { Response: 0, Result: "<x/>" });
    assert.equal(sent[0][0], "http://localhost:10305/");
    assert.deepEqual(JSON.parse(sent[0][1].body), { Type: "func", PinpadId: "1", Command: "fnDllOperPinPad", Args: ["12.34", "ODOO-A", "PAGO"] });
});

test("RealHttp: init usa fnDllIniTpvpcLatente; -99 se propaga; {} y fallos => -98", async () => {
    const replies = [{ Response: -99, Result: null }, {}];
    const cmds = [];
    const fetchImpl = async (u, o) => {
        cmds.push(JSON.parse(o.body).Command);
        const r = replies.shift();
        if (!r) {
            throw new TypeError("Failed to fetch");
        }
        return { json: async () => r };
    };
    const t = new RealHttpTransport({ fetchImpl });
    const a = await new Promise((r) => t.initFnDll(["1", "1", "K"], r));
    const b = await new Promise((r) => t.execFnDll("fnDllCheckStatus", [], r));
    const c = await new Promise((r) => t.execFnDll("fnDllCheckStatus", [], r));
    assert.equal(a.Response, -99);
    assert.equal(b.Response, -98);
    assert.equal(c.Response, -98);
    assert.equal(cmds[0], "fnDllIniTpvpcLatente");
});
