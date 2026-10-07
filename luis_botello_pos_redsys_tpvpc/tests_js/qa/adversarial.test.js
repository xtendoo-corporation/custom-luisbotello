// QA independiente: revisión adversaria (doble cobro, 'unknown', secretos, mock en producción,
// inyección con datos de Redsys, coherencia de importe).
//
// Convención: `test(..., { todo })` = HALLAZGO ABIERTO. Describe el comportamiento DESEADO; hoy
// falla y por eso el runner lo marca como "todo" (no rompe la suite). Cuando se corrija el
// código el test pasará solo: entonces hay que quitar la marca `todo`. Los IDs (QA-xx) remiten a
// docs/qa_report.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {inspect} from "node:util";
import {describe, it} from "node:test";
import {fileURLToPath} from "node:url";
import {MockTransport} from "../../static/src/app/redsys/mock/mock_transport.js";
import {SCENARIOS} from "../../static/src/app/redsys/mock/scenarios.js";
import {
  RedsysService,
  formatRedsysDate,
  makeReference,
} from "../../static/src/app/redsys/redsys_service.js";
import {RealHttpTransport} from "../../static/src/app/redsys/transports/real_http_transport.js";
import {
  isAuthorized,
  parsePayXml,
  parseQueryXml,
} from "../../static/src/app/redsys/xml_parser.js";
import {createRedsysEntry} from "../../static/src/app/utils/redsys_factory.js";
import {
  chooseTransportKind,
  interpretPayResult,
  interpretQuery,
  receiptText,
} from "../../static/src/app/utils/redsys_pos_logic.js";
import {isSimConsoleRequested} from "../../static/src/app/redsys/mock/sim_console.js";
import {AUTH_XML, FakeTransport, QUERY_XML} from "../fake_transport.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../static/src");
const KEY = "QA-SECRET-KEY-9f8e7d6c";
const REF = "ODOO-AAAA0001";
// It() con opciones al final (el runner de node exige (name, options, fn)); marca el hallazgo como todo.
const openIt = (name, fn, opts) => it(name, opts, fn);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const charges = (t) =>
  t.operations.filter(
    (o) => o.tipoOper === "Autorizacion" && o.resultado === "Autorizada"
  );

function mockSvc({latency = 0, svc = {}} = {}) {
  const transport = new MockTransport({latency, logger: () => {}});
  const s = new RedsysService({
    sleep: async () => {},
    initCooldownMs: 0,
    callTimeoutMs: 0,
    ...svc,
  });
  s.configure({
    merchant: "777888991",
    terminal: "1",
    signKey: KEY,
    port: "COM9:,19200,N,8,1",
    version: "6.1",
    transport,
  });
  return {s, transport};
}
async function fakeSvc(opts = {}) {
  const transport = new FakeTransport();
  const s = new RedsysService({
    sleep: async () => {},
    initCooldownMs: 0,
    callTimeoutMs: 0,
    ...opts,
  });
  s.configure({
    merchant: "777888991",
    terminal: "1",
    signKey: KEY,
    port: "COM9:,19200,N,8,1",
    version: "6.1",
    transport,
  });
  assert.equal((await s.init()).ok, true);
  return {s, transport};
}
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, f.name);
    f.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const luhn = (digits) => {
  let sum = 0;
  [...digits].reverse().forEach((d, i) => {
    let n = Number(d);
    if (i % 2) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  });
  return sum % 10 === 0;
};

// ---------------------------------------------------------------------------------------------
describe("Secretos: clave de firma y PAN", () => {
  it("la clave no aparece en logs (servicio, mock, consola), resultados, callLog ni serialización", async () => {
    const captured = [];
    const origConsole = {};
    for (const m of ["log", "info", "warn", "error", "debug"]) {
      origConsole[m] = console[m];
      console[m] = (...a) =>
        captured.push(
          a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")
        );
    }
    const logs = [];
    try {
      const transport = new MockTransport({latency: 0}); // Logger por defecto = console.debug
      transport.EnableLog();
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: 0,
        logger: (m, d) => logs.push(m + JSON.stringify(d || {})),
      });
      s.configure({
        merchant: "777888991",
        terminal: "1",
        signKey: KEY,
        port: "COM9:,19200,N,8,1",
        version: "6.1",
        transport,
      });
      await s.init();
      const results = [];
      results.push(await s.pay({amount: 12.34, reference: REF}));
      transport.forceNext("unknown_charged");
      results.push(await s.pay({amount: 5, reference: "ODOO-AAAA0002"}));
      transport.forceNext("denied");
      results.push(await s.pay({amount: 5, reference: "ODOO-AAAA0003"}));
      results.push(
        await s.refund({
          pedido: results[0].pedido,
          rts: results[0].rts,
          amount: 2,
          reference: "ODOO-AAAA0004",
        })
      );
      transport.setDefaultScenario({name: "init_error", code: -18});
      await s.stop();
      results.push(await s.init());
      const blob = JSON.stringify([
        results,
        logs,
        captured,
        transport.callLog,
        transport.eventLog,
        transport.operations,
        s,
      ]);
      assert.ok(
        captured.length > 0,
        "el mock debería haber registrado algo con EnableLog (prueba válida)"
      );
      assert.ok(!blob.includes(KEY), "la clave de firma se ha filtrado");
      assert.ok(!String(s).includes(KEY));
    } finally {
      Object.assign(console, origConsole);
    }
  });

  it("RealHttpTransport: la clave solo viaja en el cuerpo hacia localhost y no vuelve en resultados/errores", async () => {
    const seen = [];
    const fetchImpl = async (url, opts) => {
      seen.push({url, body: opts.body});
      if (seen.length === 2) throw new Error("network down");
      return {json: async () => ({Type: "response", Response: 0, Result: null})};
    };
    const t = new RealHttpTransport({fetchImpl});
    const out = [];
    await new Promise((r) =>
      t.initFnDll(
        ["777888991", "1", KEY, "COM9:,19200,N,8,1", "6.1"],
        (x) => (out.push(x), r())
      )
    );
    await new Promise((r) =>
      t.execFnDll("fnDllCheckStatus", [], (x) => (out.push(x), r()))
    );
    assert.match(seen[0].url, /^http:\/\/localhost:10305/);
    assert.ok(seen[0].body.includes(KEY), "init lleva la clave (necesario, D4)");
    assert.ok(!JSON.stringify(out).includes(KEY));
    assert.ok(
      !seen[1].body.includes(KEY),
      "las operaciones posteriores no reenvían la clave"
    );
  });

  it("nunca hay PAN completo: solo máscara ************NNNN, en ningún escenario, comando ni XML guardado", async () => {
    const names = Object.keys(SCENARIOS).filter((n) =>
      SCENARIOS[n].ops.some((o) => o === "pay" || o === "refund")
    );
    const xmls = [];
    for (const name of names) {
      const transport = new MockTransport({latency: 0, logger: () => {}});
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: 0,
      });
      s.configure({
        merchant: "777888991",
        terminal: "1",
        signKey: KEY,
        port: "COM9:,19200,N,8,1",
        version: "6.1",
        transport,
      });
      await s.init();
      transport.forceNext(name === "return_code" ? {name, code: -3} : name);
      const r = await s.pay({amount: 10, reference: REF});
      if (r.rawXml) xmls.push(r.rawXml);
      const now = Date.now();
      transport.execFnDll(
        "fnDllOperConsulta",
        [
          null,
          null,
          null,
          formatRedsysDate(new Date(now - 6e5)),
          formatRedsysDate(new Date(now + 6e5)),
          null,
          null,
          "0",
        ],
        (x) => x.Result && xmls.push(x.Result)
      );
      await sleep(5);
    }
    assert.ok(xmls.length >= 5);
    for (const xml of xmls) {
      for (const [, text] of xml.matchAll(/>([0-9*\s]{13,24})</g)) {
        const digits = text.replace(/\D/g, "");
        const masked =
          /^\*{12}\d{4}$/.test(text.trim()) || /^\d{8} \d{6}$/.test(text.trim()); // Máscara o timestamp "YYYYMMdd HHmmss"
        if (!masked && digits.length >= 13 && digits.length <= 19) {
          assert.ok(!luhn(digits), `posible PAN completo en XML: ${text}`);
        }
      }
      for (const tag of ["tarjetaClienteRecibo", "tarjetaComercioRecibo", "tarjeta"]) {
        for (const [, v] of xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))) {
          assert.match(v, /^\*{12}\d{4}$/, `${tag} no está enmascarado`);
        }
      }
    }
  });

  openIt(
    "QA-12: inspect(servicio) / console.log(servicio) no debe mostrar la clave",
    () => {
      const {s} = mockSvc();
      assert.ok(!inspect(s, {depth: 5}).includes(KEY));
    },
    {
      todo: "QA-12 la clave vive en this.config.signKey: toJSON la oculta, pero util.inspect/console.log (y Vue/OWL devtools) la muestran",
    }
  );

  it("higiene estática: sin localStorage/sessionStorage/indexedDB, sin console.log/warn/error, sin eval/innerHTML/document.write", () => {
    const forbidden = [
      [/\b(localStorage|sessionStorage|indexedDB)\b/, "almacenamiento del navegador"],
      [
        /console\.(log|info|warn|error|trace)\b/,
        "console.* (solo console.debug del mock bajo EnableLog)",
      ],
      [
        /\beval\s*\(|new\s+Function\s*\(|\.innerHTML\b|\.outerHTML\b|document\.write|insertAdjacentHTML|t-raw|\bmarkup\s*\(/,
        "inyección HTML/JS",
      ],
      [/\bfetch\s*\(\s*["'`]https?:\/\/(?!localhost)/, "petición a host externo"],
    ];
    // Única excepción: marcas de inicio de cobro (QA-01), sin secretos: clave "redsys_start:<referencia>" => instante.
    const storageOk = new Set(["app/services/redsys_tpvpc_service.js"]);
    for (const file of walk(SRC).filter((f) => /\.(js|xml)$/.test(f))) {
      const text = fs
        .readFileSync(file, "utf8")
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const rel = path.relative(SRC, file).replaceAll(path.sep, "/");
      for (const [re, what] of forbidden) {
        if (storageOk.has(rel) && what === "almacenamiento del navegador") {
          assert.equal(
            (text.match(/localStorage/g) || []).length,
            1,
            "un único acceso, a localStorage"
          );
          assert.ok(!/sessionStorage|indexedDB/.test(text));
          assert.ok(
            !/localStorage[\s\S]{0,200}(signKey|keys\b)/.test(text),
            "la clave no se guarda"
          );
          continue;
        }
        assert.ok(!re.test(text), `${path.relative(SRC, file)} contiene ${what}`);
      }
    }
  });

  it("la clave solo se menciona en los ficheros esperados (fábrica, servicio, lógica de validación, RPC)", () => {
    const allowed = new Set([
      "app/redsys/redsys_service.js",
      "app/utils/redsys_factory.js",
      "app/utils/redsys_pos_logic.js",
      "app/services/redsys_tpvpc_service.js",
    ]);
    for (const file of walk(SRC).filter((f) => f.endsWith(".js"))) {
      const rel = path.relative(SRC, file).replaceAll(path.sep, "/");
      const text = fs.readFileSync(file, "utf8");
      if (
        /signKey|signature_key/.test(
          text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
        )
      ) {
        assert.ok(
          allowed.has(rel) || rel.startsWith("app/redsys/mock/"),
          `${rel} maneja la clave y no está en la lista`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("'unknown' nunca es éxito ni fallo", () => {
  it("interpretPayResult(unknown) no es done ni retry; persiste estado y referencia", () => {
    const d = interpretPayResult({status: "unknown", reference: REF});
    assert.equal(d.outcome, "unknown");
    assert.equal(d.vals.redsys_state, "unknown");
    assert.equal(d.vals.redsys_reference, REF);
    assert.equal(d.receipt, null);
  });

  it("todo lo que no es estado F + Autorizada exacta NO autoriza (variantes hostiles)", () => {
    const mk = (estado, resultado) =>
      `<Operaciones><resultadoOperacion><estado>${estado}</estado><resultado>${resultado}</resultado></resultadoOperacion></Operaciones>`;
    for (const [e, r] of [
      ["P", "Autorizada"],
      ["T", "Autorizada"],
      ["G", "Autorizada"],
      ["", "Autorizada"],
      ["F", ""],
      ["F", "No autorizada"],
      ["F", "Autorizada parcialmente"],
      ["F", "Denegada"],
      ["FF", "Autorizada"],
      ["F", "Autorizadaа"],
      ["F", "Autorizada-"],
      ["F", "Autorizad a"],
    ]) {
      assert.equal(isAuthorized(mk(e, r)), false, `${e}/${r}`);
      assert.equal(parsePayXml(mk(e, r)).authorized, false);
    }
    assert.equal(isAuthorized(null), false);
    assert.equal(isAuthorized(undefined), false);
    assert.equal(isAuthorized(""), false);
    assert.equal(isAuthorized("<Error><codigo>TPV-PC0074</codigo></Error>"), false);
    assert.equal(isAuthorized(mk(" F ", " AUTORIZADA ")), true);
  });

  it("retorno 0 con XML vacío / sin resultadoOperacion / con <Error>: nunca authorized; vacío => consulta", async () => {
    for (const result of [
      "",
      "   ",
      "<Operaciones/>",
      "<html>502</html>",
      null,
      "<Error><codigo>TPV-PC0030</codigo></Error>",
    ]) {
      const {s, transport} = await fakeSvc();
      transport.queue("fnDllOperPinPad", {Response: 0, Result: result});
      transport.queue("fnDllOperConsulta", {Response: 0, Result: QUERY_XML([])});
      const r = await s.pay({amount: 12.34, reference: REF});
      assert.notEqual(r.status, "authorized", JSON.stringify(result));
      assert.equal(transport.count("fnDllOperPinPad"), 1);
    }
  });

  it("consulta posterior con operaciones de OTRA referencia o de otro tipo no autoriza", async () => {
    const {s, transport} = await fakeSvc();
    transport.queue("fnDllOperPinPad", {Response: -2, Result: null});
    transport.queue("fnDllOperConsulta", {
      Response: 0,
      Result: QUERY_XML([
        {factura: "ODOO-AAAA0009"},
        {factura: "ODOO-AAAA0001-X"},
        {factura: "odoo-aaaa0001"},
      ]),
    });
    const r = await s.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "error");
    assert.equal(r.errorCode, "NOT_CHARGED");
  });

  it("consulta con P (en proceso) o DENEGADA+AUTORIZADA mezcladas: P => unknown; autorizada gana a denegada", async () => {
    const {s, transport} = await fakeSvc();
    transport.queue("fnDllOperPinPad", {Response: -2, Result: null});
    transport.queue("fnDllOperConsulta", {
      Response: 0,
      Result: QUERY_XML([{factura: REF, estado: "P", resultado: "PENDIENTE"}]),
    });
    assert.equal((await s.pay({amount: 12.34, reference: REF})).status, "unknown");
    transport.queue("fnDllOperPinPad", {Response: -2, Result: null});
    transport.queue("fnDllOperConsulta", {
      Response: 0,
      Result: QUERY_XML([
        {factura: REF, estado: "F", resultado: "DENEGADA"},
        {factura: REF, pedido: "77"},
      ]),
    });
    const r = await s.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "authorized");
    assert.equal(r.pedido, "77");
  });

  it("interpretQuery (recarga): sin operación => not_charged es SOLO tan fiable como la consulta; P/ error => unknown", () => {
    assert.equal(
      interpretQuery(
        {operations: []},
        {reference: REF, amount: 5, startedAt: 0, now: 1e7}
      ).outcome,
      "not_charged"
    );
    assert.equal(
      interpretQuery({operations: []}, {reference: REF, amount: 5}).outcome,
      "unknown",
      "QA-01: sin gracia cumplida no se concluye"
    );
    assert.equal(
      interpretQuery(
        {operations: [{factura: REF, estado: "P"}]},
        {reference: REF, amount: 5}
      ).outcome,
      "unknown"
    );
    assert.equal(
      interpretQuery({error: {message: "x"}}, {reference: REF}).outcome,
      "unknown"
    );
    assert.equal(interpretQuery(null, {reference: REF}).outcome, "unknown");
  });

  it("QA-01 recarga mientras el datáfono AÚN procesa: la consulta no debe concluir 'no cobrado' (cobro huérfano)", async () => {
    const {s: a, transport} = mockSvc({
      latency: {cardRead: 60, process: 10, init: 0, consult: 0},
    });
    await a.init();
    const inflight = a.pay({amount: 12.34, reference: REF}); // La pestaña original se pierde (F5)
    await sleep(10);
    const b = new RedsysService({
      sleep: async () => {},
      initCooldownMs: 0,
      callTimeoutMs: 0,
    });
    b.configure({
      merchant: "777888991",
      terminal: "1",
      signKey: KEY,
      port: "COM9:,19200,N,8,1",
      version: "6.1",
      transport,
    });
    await b.init();
    const now = Date.now();
    const q = await b.query({
      reference: REF,
      from: new Date(now - 6e5),
      to: new Date(now + 6e5),
      type: "PAGO",
    });
    const outcome = interpretQuery(q, {reference: REF, amount: 12.34});
    await inflight;
    assert.equal(charges(transport).length, 1, "el cobro original terminó autorizado");
    assert.notEqual(
      outcome.outcome,
      "not_charged",
      "se declaró 'no cobrado' y el cargo apareció después => reintento = doble cobro"
    );
  });

  it("QA-02 timeout de llamada (callTimeoutMs) menor que la duración real: queda UNKNOWN (nunca NOT_CHARGED) y el servicio sigue ocupado", async () => {
    const {s, transport} = mockSvc({
      latency: {cardRead: 120, process: 10, init: 0, consult: 0},
      svc: {callTimeoutMs: 40},
    });
    await s.init();
    const r = await s.pay({amount: 12.34, reference: REF});
    await sleep(200);
    const chargedLater = charges(transport).length;
    assert.equal(chargedLater, 1);
    assert.notEqual(
      r.errorCode,
      "NOT_CHARGED",
      "NOT_CHARGED retryable + cargo posterior = doble cobro si el cajero reintenta"
    );
    assert.equal(r.status, "unknown");
    assert.ok(!r.retryable);
  });

  it("QA-02 tras el timeout local el servicio sigue ocupado hasta el retorno tardío de la DLL (isBusy coherente)", async () => {
    const {s} = mockSvc({
      latency: {cardRead: 120, process: 10, init: 0, consult: 0},
      svc: {callTimeoutMs: 40},
    });
    await s.init();
    const r = await s.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "unknown");
    assert.equal(s.isBusy(), true, "la DLL puede seguir esperando la tarjeta");
    const second = await s.pay({amount: 12.34, reference: "ODOO-AAAA0002"});
    assert.equal(second.errorCode, "BUSY");
    await sleep(200); // Retorno tardío de la DLL
    assert.equal(s.isBusy(), false);
  });

  it("QA-02 con orphanMs vencido sin retorno tardío el servicio vuelve a estar libre", async () => {
    let t = 1000;
    const {s, transport} = await fakeSvc({
      callTimeoutMs: 20,
      orphanMs: 500,
      now: () => new Date(t),
    });
    transport.queue("fnDllOperPinPad", {never: true});
    transport.queue("fnDllOperConsulta", {Response: 0, Result: QUERY_XML([])});
    const r = await s.pay({amount: 5, reference: REF});
    assert.equal(r.status, "unknown");
    assert.equal(s.isBusy(), true);
    t += 600;
    assert.equal(s.isBusy(), false);
  });

  it("tras un timeout local, un segundo cobro NO llega al datáfono (BUSY) y no cobra dos veces", async () => {
    const {s, transport} = mockSvc({
      latency: {cardRead: 120, process: 10, init: 0, consult: 0},
      svc: {callTimeoutMs: 40},
    });
    await s.init();
    await s.pay({amount: 12.34, reference: REF});
    const second = await s.pay({amount: 12.34, reference: "ODOO-AAAA0002"});
    assert.equal(second.status, "error");
    assert.equal(second.errorCode, "BUSY");
    assert.equal(
      transport.busyViolations,
      0,
      "ya no depende del guardián del datáfono (S8f)"
    );
    await sleep(200);
    assert.equal(charges(transport).length, 1);
  });

  openIt(
    "QA-03 init que nunca responde deja el servicio ocupado para siempre (sin timeout en _initCall)",
    async () => {
      const transport = new FakeTransport();
      transport.initFnDll = () => {}; // Nunca llama al callback
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: 30,
      });
      s.configure({
        merchant: "1",
        terminal: "1",
        signKey: KEY,
        port: "COM1",
        version: "6.1",
        transport,
      });
      s.init();
      await sleep(100);
      const r = await s.pay({amount: 5, reference: REF});
      assert.notEqual(
        r.errorCode,
        "BUSY",
        "init colgado => BUSY permanente hasta recargar el POS"
      );
    },
    {
      todo: "QA-03: _initCall no aplica callTimeoutMs (a diferencia de _exec); la caja queda inutilizable (disponibilidad, no doble cobro)",
    }
  );

  it("dos pestañas del POS contra el mismo servicio local: el único freno es el guardián del datáfono (-3)", async () => {
    const transport = new MockTransport({
      latency: {cardRead: 40, process: 10, init: 0, consult: 0},
      logger: () => {},
    });
    const tab = () => {
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: 0,
      });
      s.configure({
        merchant: "777888991",
        terminal: "1",
        signKey: KEY,
        port: "COM9:,19200,N,8,1",
        version: "6.1",
        transport,
      });
      return s;
    };
    const [a, b] = [tab(), tab()];
    await a.init();
    await b.init();
    const [ra, rb] = await Promise.all([
      a.pay({amount: 12.34, reference: "ODOO-TABA0001"}),
      b.pay({amount: 12.34, reference: "ODOO-TABB0002"}),
    ]);
    assert.equal([ra, rb].filter((r) => r.status === "authorized").length, 1);
    assert.equal(
      transport.busyViolations,
      1,
      "[SUPUESTO-HW] S8f: la 2ª operación simultánea la rechaza el servicio real"
    );
    assert.equal(charges(transport).length, 1);
  });

  it("QA-22 exclusión entre pestañas: la fábrica enlaza navigator.locks (Web Locks) al servicio", () => {
    const text = fs
      .readFileSync(path.join(SRC, "app/utils/redsys_factory.js"), "utf8")
      .replace(/\/\/.*$/gm, "");
    assert.match(text, /navigator\.locks/);
    assert.match(text, /new RedsysService\(\{\s*locks/);
  });

  describe("QA-22 Web Locks (cerrojo por comercio/terminal)", () => {
    // Réplica mínima de navigator.locks.request(name, {ifAvailable:true}, cb) con cerrojos compartidos.
    const makeLocks = () => {
      const held = new Set();
      return {
        held,
        request(name, opts, cb) {
          if (held.has(name)) {
            return Promise.resolve(cb(null));
          }
          held.add(name);
          return Promise.resolve(cb({name})).finally(() => held.delete(name));
        },
      };
    };
    const tab = (locks, transport) => {
      const s = new RedsysService({
        sleep: async () => {},
        initCooldownMs: 0,
        callTimeoutMs: 0,
        locks,
      });
      s.configure({
        merchant: "777888991",
        terminal: "1",
        signKey: KEY,
        port: "COM9:,19200,N,8,1",
        version: "6.1",
        transport,
      });
      return s;
    };

    it("la 2ª pestaña recibe BUSY SIN tocar el datáfono mientras la 1ª cobra; luego se libera", async () => {
      const locks = makeLocks();
      const transport = new MockTransport({
        latency: {cardRead: 40, process: 10, init: 0, consult: 0},
        logger: () => {},
      });
      const [a, b] = [tab(locks, transport), tab(locks, transport)];
      await a.init();
      await b.init();
      const [ra, rb] = await Promise.all([
        a.pay({amount: 12.34, reference: "ODOO-TABA0001"}),
        (async () => {
          await sleep(5);
          return b.pay({amount: 12.34, reference: "ODOO-TABB0002"});
        })(),
      ]);
      assert.equal(ra.status, "authorized");
      assert.equal(rb.status, "error");
      assert.equal(rb.errorCode, "BUSY");
      assert.match(rb.userMessage, /otra (ventana|pestaña)/i);
      assert.equal(transport.busyViolations, 0, "no llegó al datáfono");
      assert.equal(charges(transport).length, 1);
      assert.equal(locks.held.size, 0, "cerrojo liberado");
      assert.equal(b.isBusy(), false);
      const again = await b.pay({amount: 12.34, reference: "ODOO-TABB0003"});
      assert.equal(again.status, "authorized");
    });

    it("la consulta pública también respeta el cerrojo y las devoluciones lo liberan", async () => {
      const locks = makeLocks();
      const transport = new MockTransport({
        latency: {cardRead: 40, process: 10, init: 0, consult: 0},
        logger: () => {},
      });
      const [a, b] = [tab(locks, transport), tab(locks, transport)];
      await a.init();
      await b.init();
      const p = a.pay({amount: 5, reference: "ODOO-TABA0001"});
      await sleep(5);
      const q = await b.query({
        reference: "ODOO-TABA0001",
        from: new Date(Date.now() - 6e5),
        to: new Date(Date.now() + 6e5),
        type: "PAGO",
      });
      assert.equal(q.error.code, "BUSY");
      await p;
      assert.equal(locks.held.size, 0);
    });

    it("degradación segura: sin locks, o si request lanza, se opera como antes", async () => {
      const transport = new MockTransport({latency: 0, logger: () => {}});
      const none = tab(null, transport);
      await none.init();
      assert.equal(
        (await none.pay({amount: 5, reference: "ODOO-TABA0001"})).status,
        "authorized"
      );
      const broken = tab(
        {
          request() {
            throw new Error("SecurityError");
          },
        },
        transport
      );
      await broken.init();
      assert.equal(
        (await broken.pay({amount: 5, reference: "ODOO-TABB0002"})).status,
        "authorized"
      );
      assert.equal(broken.isBusy(), false);
    });
  });

  it("un callback duplicado o tardío del transporte se ignora", async () => {
    const {s, transport} = await fakeSvc();
    let saved;
    transport.queue("fnDllOperPinPad", (args) => {
      return {Response: 0, Result: AUTH_XML({factura: REF})};
    });
    const origExec = transport.execFnDll.bind(transport);
    transport.execFnDll = (c, a, cb) =>
      origExec(c, a, (r) => {
        cb(r);
        cb({Response: -2, Result: null});
      });
    const r = await s.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "authorized");
    assert.equal(saved, undefined);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Coherencia del importe autorizado vs línea POS", () => {
  const xmlWith = (extra) => AUTH_XML({factura: REF, ...extra});

  it("importe distinto en la respuesta => warning AMOUNT_MISMATCH y el POS NO lo da por cobrado", async () => {
    const {s, transport} = await fakeSvc();
    transport.queue("fnDllOperPinPad", {
      Response: 0,
      Result: xmlWith({importe: "5.00"}),
    });
    const r = await s.pay({amount: 12.34, reference: REF});
    assert.equal(r.warning, "AMOUNT_MISMATCH");
    assert.equal(interpretPayResult(r).outcome, "unknown");
  });

  openIt(
    "QA-05 importe con coma decimal ('99,00') no dispara AMOUNT_MISMATCH",
    async () => {
      const {s, transport} = await fakeSvc();
      transport.queue("fnDllOperPinPad", {
        Response: 0,
        Result: xmlWith({importe: "99,00"}),
      });
      const r = await s.pay({amount: 12.34, reference: REF});
      assert.equal(r.warning, "AMOUNT_MISMATCH");
    },
    {
      todo: "QA-05: Number('99,00') = NaN => la comparación NaN > 0.001 es false y se autoriza sin aviso",
    }
  );

  openIt(
    "QA-05 respuesta autorizada SIN <importe> se acepta como cobro limpio",
    async () => {
      const {s, transport} = await fakeSvc();
      transport.queue("fnDllOperPinPad", {
        Response: 0,
        Result: xmlWith({}).replace(/<importe>[^<]*<\/importe>/, ""),
      });
      const r = await s.pay({amount: 12.34, reference: REF});
      assert.ok(
        r.status !== "authorized" || r.warning,
        "un XML autorizado sin importe no se puede cotejar"
      );
    },
    {todo: "QA-05: _authorized solo compara si parsed.importe existe"}
  );

  openIt(
    "QA-06 la respuesta de OTRA operación (factura/comercio/terminal/moneda distintos) no debe aceptarse",
    async () => {
      for (const [what, xml] of [
        ["factura", xmlWith({factura: "ODOO-ZZZZ9999"})],
        ["comercio", xmlWith({}).replace("<comercio>777888991", "<comercio>111111111")],
        ["terminal", xmlWith({}).replace("<terminal>1<", "<terminal>9<")],
        ["moneda", xmlWith({}).replace("<moneda>978", "<moneda>840")],
      ]) {
        const {s, transport} = await fakeSvc();
        transport.queue("fnDllOperPinPad", {Response: 0, Result: xml});
        const r = await s.pay({amount: 12.34, reference: REF});
        assert.ok(
          r.status !== "authorized" || r.warning,
          `${what} distinto aceptado como cobro limpio`
        );
      }
    },
    {
      todo: "QA-06: parsePayXml extrae factura/comercio/terminal/moneda pero _authorized no los coteja con la petición",
    }
  );

  it("QA-04 recuperación por consulta (-2): un cargo con importe distinto bajo la misma referencia se da por bueno", async () => {
    const {s, transport} = mockSvc();
    await s.init();
    transport.seedOperation({cents: 100, factura: REF}); // 1,00 EUR cobrado antes con la misma referencia (reintento tras editar importe)
    transport.forceNext("unknown_not_charged");
    const r = await s.pay({amount: 50, reference: REF});
    assert.equal(r.status, "authorized");
    assert.equal(
      r.warning,
      "AMOUNT_MISMATCH",
      "se cobró 1,00 y la línea POS quedaría pagada con 50,00"
    );
  });

  it("recarga: interpretQuery con importe distinto o varias autorizadas => unknown (revisión humana)", () => {
    const op = {
      factura: REF,
      estado: "F",
      resultado: "AUTORIZADA",
      pedido: "1",
      rts: "R",
      importe: "1.00",
      last4: "0018",
    };
    assert.equal(
      interpretQuery({operations: [op]}, {reference: REF, amount: 50}).outcome,
      "unknown"
    );
    assert.equal(
      interpretQuery(
        {
          operations: [
            {...op, importe: "50.00"},
            {...op, pedido: "2", importe: "50.00"},
          ],
        },
        {reference: REF, amount: 50}
      ).outcome,
      "unknown"
    );
    assert.equal(
      interpretQuery(
        {operations: [{...op, importe: "50.00"}]},
        {reference: REF, amount: 50}
      ).outcome,
      "authorized"
    );
    // Devolución: el importe del almacén es positivo, la línea es negativa
    assert.equal(
      interpretQuery(
        {operations: [{...op, importe: "5.00"}]},
        {reference: REF, amount: -5, isRefund: true}
      ).outcome,
      "authorized"
    );
  });

  openIt(
    "QA-07 los errores de negocio con retorno -3 + <Error> pierden el texto del Anexo VI",
    async () => {
      const {s, transport} = await fakeSvc();
      transport.queue("fnDllOperComContable", {
        Response: -3,
        Result: "<Error><codigo>TPV-PC0100</codigo><mensaje>x</mensaje></Error>",
      });
      const r = await s.refund({pedido: "1", rts: "R", amount: 5, reference: REF});
      assert.match(r.userMessage, /No se puede devolver/);
    },
    {
      todo: "QA-07: _handleResponse solo mira Result si Response==0; el simulador (S8b) devuelve -3 + XML y el cajero lee 'Parámetros incorrectos'",
    }
  );
});

// ---------------------------------------------------------------------------------------------
describe("Datos de Redsys en DOM/recibo (XSS / inyección)", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const evilXml = AUTH_XML({factura: REF})
    .replace(
      "<codigoRespuesta>080922",
      `<codigoRespuesta>&lt;img src=x onerror=alert(1)&gt;`
    )
    .replace("<pedido>10549", "<pedido><![CDATA[<script>alert(1)</script>]]>")
    .replace("<marcaTarjeta>2", "<marcaTarjeta>99<b>")
    .replace(
      "<fechaOperacion>2026-10-07 10:00:00.0",
      "<fechaOperacion>2026\nTOTAL: 0,01 EUR"
    );

  it("los datos viajan como strings (nunca HTML marcado): el ticket usa <pre t-esc> y los diálogos t-out de string", async () => {
    const {s, transport} = await fakeSvc();
    transport.queue("fnDllOperPinPad", {Response: 0, Result: evilXml});
    const r = await s.pay({amount: 12.34, reference: REF});
    assert.equal(r.status, "authorized");
    for (const v of [r.authCode, r.pedido, r.cardBrand, r.date])
      assert.equal(typeof v, "string");
    assert.equal(
      r.authCode,
      evil,
      "el texto llega tal cual (decodificado): depende del escapado del renderizador"
    );
    const ticket = receiptText(r);
    assert.ok(ticket.includes(evil));
    // El renderizador del core (order_receipt.xml:107) usa t-esc sobre un <pre>: se verifica por fichero
    const coreXml = path.resolve(
      here,
      "../../../../odoo/addons/point_of_sale/static/src/app/screens/receipt_screen/receipt/order_receipt.xml"
    );
    if (fs.existsSync(coreXml)) {
      assert.match(fs.readFileSync(coreXml, "utf8"), /<pre t-esc="line\.ticket"/);
    }
    assert.equal(
      interpretPayResult(r).vals.transaction_id,
      "<script>alert(1)</script>"
    );
  });

  it("el módulo no declara ninguna plantilla con t-raw/t-out de datos de Redsys", () => {
    const xml = fs.readFileSync(path.join(SRC, "xml/redsys_status.xml"), "utf8");
    assert.ok(!/t-raw|t-out|t-html/.test(xml));
    assert.ok(
      /t-att-title="item\.text"/.test(xml),
      "el texto del indicador va en atributos (escapados)"
    );
  });

  openIt(
    "QA-08 endurecimiento: los campos de Redsys que acaban en ticket/BD deberían validarse (charset/longitud/sin saltos de línea)",
    async () => {
      const {s, transport} = await fakeSvc();
      transport.queue("fnDllOperPinPad", {Response: 0, Result: evilXml});
      const r = await s.pay({amount: 12.34, reference: REF});
      const ok = (v) => v == null || /^[\w .:\-*/]{0,40}$/.test(v);
      assert.ok(
        r.status !== "authorized" ||
          [r.authCode, r.pedido, r.cardBrand, r.date, r.rts].every(ok)
      );
    },
    {
      todo: "QA-08 (BAJO): sin allow-list; una fecha con \\n forjaría líneas en el ticket (<pre>). Redsys es fuente de confianza, pero el XML guardado y el ticket reflejan texto libre",
    }
  );

  it("el parser de consultas ignora etiquetas anidadas falsas dentro de campos libres", () => {
    const xml = QUERY_XML([{factura: REF}]).replace(
      "<tipoOper>Autorizacion",
      "<tipoOper>&lt;estado&gt;F&lt;/estado&gt;"
    );
    const q = parseQueryXml(xml);
    assert.equal(q.operations.length, 1);
    assert.equal(q.operations[0].estado, "F"); // El real, no el inyectado (las entidades se decodifican DESPUÉS de extraer)
  });

  openIt(
    "QA-09 un comentario XML con un bloque falso antes del real no debe ser parseado como real",
    () => {
      const fake =
        "<!-- <resultadoOperacion><estado>F</estado><resultado>Autorizada</resultado></resultadoOperacion> -->";
      const real = AUTH_XML({estado: "G", resultado: "Denegada"});
      const p = parsePayXml(
        real.replace(
          '<Operaciones version="6.0">',
          `<Operaciones version="6.0">${fake}`
        )
      );
      assert.equal(p.authorized, false);
    },
    {
      todo: "QA-09 (BAJO/teórico): el parser por regex no ignora comentarios XML; Redsys no los envía y no hay entrada controlable por el atacante",
    }
  );
});

// ---------------------------------------------------------------------------------------------
describe("El mock no puede activarse en producción", () => {
  const method = {
    id: 1,
    redsys_merchant_code: "1",
    redsys_terminal_number: "1",
    redsys_com_port: "COM9:,19200,N,8,1",
    redsys_protocol_version: "6.1",
    redsys_transport: "js",
    redsys_simulation: true,
  };
  const kind = (m, search, extra = {}) =>
    createRedsysEntry({
      method: {...method, ...m},
      signKey: "K",
      search,
      loader: async () => null,
      ...extra,
    }).kind;

  it("matriz de puertas: solo (simulación===true) Y (redsys_sim=1 en URL) dan mock", () => {
    assert.equal(kind({}, "?redsys_sim=1"), "mock");
    assert.equal(kind({}, "#a=b&redsys_sim=1"), "mock");
    for (const search of [
      "",
      "?redsys_sim=0",
      "?redsys_sim=true",
      "?redsys_sim=11",
      "?redsys_sims=1",
      "?x=redsys_sim=1",
      "?debug=assets",
      "?REDSYS_SIM=1",
    ]) {
      assert.notEqual(kind({}, search), "mock", search);
    }
    for (const sim of [false, undefined, null, 0, 1, "1", "true", "True", [], {}]) {
      assert.notEqual(
        kind({redsys_simulation: sim}, "?redsys_sim=1"),
        "mock",
        String(sim)
      );
    }
    assert.equal(
      chooseTransportKind({
        transport: "http",
        simulation: false,
        search: "?redsys_sim=1",
        flagCheck: isSimConsoleRequested,
      }),
      "http"
    );
    assert.equal(
      chooseTransportKind({transport: "js", simulation: true, search: "?redsys_sim=1"}),
      "js",
      "sin flagCheck no hay mock"
    );
  });

  it("`new MockTransport` solo se instancia en la fábrica (única puerta) y nadie lee el flag fuera de ella", () => {
    const offenders = walk(SRC)
      .filter((f) => f.endsWith(".js") && !f.includes(`${path.sep}mock${path.sep}`))
      .filter((f) => /new\s+MockTransport\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f).replaceAll(path.sep, "/"));
    assert.deepEqual(offenders, ["app/utils/redsys_factory.js"]);
    const flagReaders = walk(SRC)
      .filter((f) => f.endsWith(".js") && !f.includes(`${path.sep}mock${path.sep}`))
      .filter((f) => /redsys_simulation|redsys_sim\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f).replaceAll(path.sep, "/"))
      .sort();
    const allowed = [
      "app/utils/redsys_factory.js",
      "app/utils/redsys_pos_logic.js",
      "app/services/redsys_tpvpc_service.js" /* solo comentarios */,
    ];
    assert.deepEqual(
      flagReaders.filter((f) => !allowed.includes(f)),
      []
    );
  });

  it("QA-10 el mock activo no deja marca en el cobro: una línea 'authorized' simulada es indistinguible de una real en BD", async () => {
    const e = createRedsysEntry({method, signKey: "K", search: "?redsys_sim=1"});
    assert.equal(e.kind, "mock");
    e.transport.setLatency(0);
    await e.redsys.init();
    const r = await e.redsys.pay({amount: 5, reference: REF});
    assert.equal(r.status, "authorized");
    const marked =
      /mock|simul/i.test(JSON.stringify(interpretPayResult(r).vals)) ||
      /mock|simul/i.test(r.rawXml);
    assert.ok(
      marked,
      "ni transaction_id, ni redsys_xml, ni redsys_state delatan que es simulado"
    );
  });

  it("la referencia se deriva del uuid y es única por línea (<=20 car.)", () => {
    const a = makeReference("a1b2c3d4-0000-0000-0000-000000000001");
    const b = makeReference("a1b2c3d5-0000-0000-0000-000000000001");
    assert.notEqual(a, b);
    assert.ok(a.length <= 20);
    assert.equal(makeReference("zz"), null);
  });
});
