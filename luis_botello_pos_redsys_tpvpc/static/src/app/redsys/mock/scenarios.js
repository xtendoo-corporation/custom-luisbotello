/** @odoo-module */
/**
 * Escenarios y constructores de XML del simulador Redsys TPV-PC Implantado.
 *
 * Lógica pura (sin Odoo, sin DOM). Las estructuras XML están copiadas de los
 * ejemplos reales de los manuales:
 *  - IntegracionTpvpcImplantado v2.52, 3.8 (pago), 3.11 (devolución), 3.14 (consulta),
 *    Anexo VI (XML de error) y Anexo VII (códigos de denegación).
 *  - ConsultasV2d2 (campos de <operacion>, numAutorizacion).
 * Nunca se genera PAN completo (solo "************NNNN") ni se usa la clave de firma:
 * el campo <firma> es un hash falso determinista, no una firma válida.
 */

// ---------------------------------------------------------------------------
// Latencias por defecto (ms). Todas inyectables; ver MockTransport.
// ---------------------------------------------------------------------------
export const DEFAULT_LATENCY = Object.freeze({
  init: 300,
  check: 100,
  cardRead: 15000, // Lectura de tarjeta, 10-40 s en la realidad
  process: 1500, // Autorización tras leer la tarjeta
  refund: 2500,
  consult: 600,
  timeout: 40000, // [SUPUESTO-HW] S8: tiempo tras el que la DLL devuelve -2
  instant: 20, // Errores inmediatos (-1, -99, parámetros...)
});

// ---------------------------------------------------------------------------
// Códigos de denegación reales (Anexo VII, "códigos más comunes").
// ---------------------------------------------------------------------------
export const DENIAL_CODES = Object.freeze({
  101: "La tarjeta está caducada",
  102: "Tarjeta bloqueada por el banco emisor",
  104: "Operación no permitida para esa tarjeta o terminal",
  106: "Intentos de PIN excedidos",
  107: "Por favor, contacte con el banco emisor de la tarjeta",
  109: "Identificación inválida de terminal o establecimiento",
  110: "Importe inválido",
  112: "Se requiere PIN obligatorio",
  114: "Tarjeta no soporta el tipo de operación solicitado",
  116: "Disponible insuficiente",
  117: "PIN incorrecto",
  118: "Tarjeta no registrada",
  119: "Desconocido",
  120: "Operaciones denegadas por SIS",
  125: "Tarjeta no efectiva",
  129: "Tarjeta no operativa (error en CVC2)",
  130: "Moneda no soportada por el emisor",
  180: "Tarjeta no soportada por el sistema",
  184: "Error en autenticación",
  190: "Denegada por el banco emisor de la tarjeta, por diversos motivos",
  191: "Fecha de caducidad errónea",
  195: "Obligatorio insertar Chip",
  202: "Tarjeta bloqueada por el banco emisor. Orden de retirar la tarjeta",
  290: "Denegada por diversos motivos. Orden de retirar la tarjeta",
  912: "Número de tarjeta inexistente",
});
export const DEFAULT_DENIAL_CODE = "190";

// Códigos de retorno de fnDllIniTpvpcLatente (§4.9 del plan / manual).
export const INIT_ERROR_CODES = Object.freeze({
  "-1": "error interno (reiniciar librería)",
  "-3": "falta comercio",
  "-4": "falta terminal",
  "-5": "falta clave",
  "-13": "timeout descubriendo pinpad",
  "-14": "no arranca la interfaz",
  "-16": "sin conexión al servicio web de Redsys",
  "-18": "datos incorrectos (comercio/terminal/clave)",
  "-19": "pinpad mal configurado",
  "-20": "puerto COM incorrecto",
  "-21": "versión incompatible con el pinpad",
  "-40": "la librería ha caducado",
});

export const VALID_VERSIONS = Object.freeze(["5.1", "6.1", "8.1"]);

// Marca de tarjeta (§4.3): 1=VISA, 2=MASTERCARD, 6=DINERS, 8=AMEX, 9=JCB, 22=CUP.
export const BRANDS = Object.freeze({
  VISA: 1,
  MASTERCARD: 2,
  DINERS: 6,
  AMEX: 8,
  JCB: 9,
  CUP: 22,
});

// ---------------------------------------------------------------------------
// Catálogo de escenarios. `ops` indica qué llamada consume el escenario forzado:
//   init | pay (fnDllOperPinPad) | refund (fnDllOperComContable) | check (fnDllCheckStatus)
// ---------------------------------------------------------------------------
export const SCENARIOS = Object.freeze({
  authorized: {ops: ["pay", "refund"], label: "Autorizado"},
  denied: {ops: ["pay", "refund"], label: "Denegado (estado F, resultado Denegada)"},
  denied_g: {ops: ["pay"], label: "Denegado con estado G (variante del manual 3.x)"},
  unknown_charged: {ops: ["pay", "refund"], label: "-2 con operación cobrada"},
  unknown_not_charged: {ops: ["pay", "refund"], label: "-2 sin cobro"},
  unknown_query_fails: {
    ops: ["pay"],
    label: "-2 cobrado y la consulta posterior también da -2",
  },
  reinit_1: {ops: ["pay", "refund"], label: "-1 (no inicializado, requiere re-init)"},
  reinit_99: {ops: ["pay", "refund"], label: "-99 (HTTP, requiere re-init)"},
  return_code: {
    ops: ["pay", "refund"],
    label: "Código de retorno arbitrario (params.code)",
  },
  malformed_xml: {ops: ["pay", "refund"], label: "Respuesta XML malformada"},
  truncated_xml: {ops: ["pay", "refund"], label: "Respuesta XML cortada"},
  init_error: {
    ops: ["init"],
    label: "Error de init (params.code, p. ej. -16, -20, -40)",
  },
  check_terminal_fail: {ops: ["check"], label: "CheckStatus -2 (fallo con terminal)"},
  check_server_fail: {
    ops: ["check"],
    label: "CheckStatus -3 (fallo con servidor Redsys)",
  },
});

/** Normaliza string | {name, ...params} a {name, ...params} y valida el nombre. */
export function normalizeScenario(spec) {
  const s = typeof spec === "string" ? {name: spec} : {...spec};
  // Atajos: init_minus16, init_minus20, init_minus40...
  const m = /^init_minus(\d+)$/.exec(s.name || "");
  if (m) {
    s.name = "init_error";
    s.code = -Number(m[1]);
  }
  if (s.name === "reinit_1" || s.name === "reinit_99") {
    s.code = s.name === "reinit_1" ? -1 : -99;
  }
  if (!SCENARIOS[s.name]) {
    throw new Error(`Escenario desconocido: ${s.name}`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
const pad = (n, w = 2) => String(n).padStart(w, "0");

/** "12.34" -> 1234 (céntimos) o null si el formato no es válido (punto, 2 decimales). */
export function parseAmountToCents(str) {
  if (typeof str !== "string" || !/^\d{1,9}\.\d{2}$/.test(str)) {
    return null;
  }
  const [e, c] = str.split(".");
  return Number(e) * 100 + Number(c);
}

export function formatCents(cents) {
  return `${Math.floor(cents / 100)}.${pad(cents % 100)}`;
}

/** "2007-03-19 15:38:28.484" (hora local de la máquina, como la DLL). */
export function formatOperationDate(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
      d.getMilliseconds(),
      3
    )}`
  );
}

/** "YYYYMMdd HHmmss" (parámetros de fnDllOperConsulta y <timestamp>). */
export function formatQueryDate(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Inversa de formatQueryDate; devuelve ms o null. */
export function parseQueryDate(str) {
  const m = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})$/.exec(str || "");
  if (!m) {
    return null;
  }
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  ).getTime();
}

/** Identificador RTS con la forma del manual: 070001 + yymmdd + hhmmss + 6 dígitos. */
export function buildRts(ms, seq) {
  const d = new Date(ms);
  return (
    "070001" +
    pad(d.getFullYear() % 100) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) +
    pad(seq % 1000000, 6)
  );
}

export function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Hash falso de 40 caracteres, determinista, con prefijo "MOCK" (QA-10: marca inequívoca de operación
 * simulada en el XML que se guarda en BD). NO es una firma Redsys y no usa la clave.
 */
export function fakeSignature(seed) {
  let h = 0x811c9dc5;
  let out = "";
  const str = String(seed);
  for (let i = 0; out.length < 40; i++) {
    h ^= str.charCodeAt(i % str.length) + i;
    h = Math.imul(h, 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return ("MOCK" + out.slice(0, 36)).toUpperCase();
}

const maskedPan = (last4) => `************${last4}`;

// ---------------------------------------------------------------------------
// XML (estructura idéntica a los ejemplos reales)
// ---------------------------------------------------------------------------

/** Respuesta de fnDllOperPinPad (manual 3.8, <Operaciones version="6.0"><resultadoOperacion>). */
export function buildPayXml(op) {
  const pan = maskedPan(op.last4);
  return (
    `<Operaciones version="6.0"> <resultadoOperacion> <tipoPago>PAGO</tipoPago> ` +
    `<importe>${formatCents(op.cents)}</importe> <moneda>978</moneda> ` +
    `<tarjetaComercioRecibo>${pan}</tarjetaComercioRecibo> ` +
    `<tarjetaClienteRecibo>${pan}</tarjetaClienteRecibo> ` +
    `<marcaTarjeta>${op.marca}</marcaTarjeta> <caducidad>${op.caducidad}</caducidad> ` +
    `<comercio>${escapeXml(op.comercio)}</comercio> <terminal>${escapeXml(
      op.terminal
    )}</terminal> ` +
    `<pedido>${op.pedido}</pedido> <tipoTasaAplicada>DEB</tipoTasaAplicada> ` +
    `<identificadorRTS>${op.rts}</identificadorRTS> <factura>${escapeXml(
      op.factura
    )}</factura> ` +
    `<fechaOperacion>${formatOperationDate(op.fechaMs)}</fechaOperacion> ` +
    `<estado>${op.estado}</estado> <resultado>${op.resultado}</resultado> ` +
    `<codigoRespuesta>${op.codigoRespuesta}</codigoRespuesta> ` +
    `<Literales> <literal>NO REFUND</literal> </Literales> ` +
    `<firma>${fakeSignature(
      op.rts + op.estado
    )}</firma> <operacionemv>true</operacionemv> ` +
    `<conttrans>${pad(op.seq % 1000000, 6)}</conttrans> <sectarjeta>00</sectarjeta> ` +
    `<idapp>A0000000043060</idapp> <codrespauto>00</codrespauto> ` +
    `</resultadoOperacion> </Operaciones>`
  );
}

/** Respuesta de fnDllOperComContable DEVOLUCION (manual 3.11, version 6.0). */
export function buildRefundXml(op) {
  return (
    `<Operaciones version="6.0"> <comunicacionContable tipo="DEVOLUCION"> <resultadoComunicacion> ` +
    `<importe>${formatCents(op.cents)}</importe> <moneda>978</moneda> ` +
    `<comercio>${escapeXml(op.comercio)}</comercio> <terminal>${escapeXml(
      op.terminal
    )}</terminal> ` +
    `<pedido>${op.pedido}</pedido> <factura>${escapeXml(op.factura)}</factura> ` +
    `<identificadorRTS>${op.rts}</identificadorRTS> <pedidoBase>${op.pedidoBase}</pedidoBase> ` +
    `<fechaOperacion>${formatOperationDate(op.fechaMs).slice(
      0,
      19
    )}</fechaOperacion> ` +
    `<estado>${op.estado}</estado> <resultado>${op.resultado}</resultado> ` +
    `<firma>${fakeSignature(op.rts + op.estado)}</firma> ` +
    `</resultadoComunicacion> </comunicacionContable> </Operaciones>`
  );
}

/** Respuesta de fnDllOperConsulta (manual 3.14 / ConsultasV2d2, <consultas><resultadoConsulta>). */
export function buildQueryXml(
  ops,
  {page = 0, totalPages = 1, total = ops.length, comercio, nowMs}
) {
  const items = ops
    .map((op) => {
      const isRefund = op.tipoOper === "Devolucion";
      const lines = [
        `<operacion> <tipoOper>${op.tipoOper}</tipoOper>`,
        `<tarjeta>${maskedPan(op.last4)}</tarjeta> <caducidad>${
          op.caducidad
        }</caducidad>`,
      ];
      if (isRefund) {
        lines.push(`<pedidoBase>${op.pedidoBase}</pedidoBase>`);
      }
      lines.push(
        `<importe>${formatCents(op.cents)}</importe> <moneda>978</moneda>`,
        `<terminal>${escapeXml(op.terminal)}</terminal> <pedido>${op.pedido}</pedido>`,
        `<identificadorRTS>${op.rts}</identificadorRTS>`,
        `<fechaOperacion>${formatOperationDate(op.fechaMs)}</fechaOperacion>`,
        `<factura>${escapeXml(op.factura)}</factura>`,
        `<estado>${
          op.estado
        }</estado> <resultado>${op.resultado.toUpperCase()}</resultado>`
      );
      if (!isRefund) {
        // En consultas, autorizada => codigoRespuesta 0 (ConsultasV2d2, campo 21).
        const authorized = op.resultado === "Autorizada";
        lines.push(
          `<codigoRespuesta>${authorized ? "0" : op.codigoRespuesta}</codigoRespuesta>`
        );
        if (authorized) {
          lines.push(`<numAutorizacion>${op.authCode}</numAutorizacion>`);
        }
      }
      lines.push("</operacion>");
      return lines.join(" ");
    })
    .join(" ");
  return (
    `<consultas version="2.1"> <resultadoConsulta> ${items}${items ? " " : ""}` +
    `<numoperaciones>${ops.length}</numoperaciones> <numpagina>${page}</numpagina> ` +
    `<totalpaginas>${totalPages}</totalpaginas> <comercio>${escapeXml(
      comercio
    )}</comercio> ` +
    `<timestamp>${formatQueryDate(nowMs)}</timestamp> <firma>${fakeSignature(
      "Q" + total + nowMs
    )}</firma> ` +
    `</resultadoConsulta> </consultas>`
  );
}

/** XML de error del Anexo VI: <Operaciones><Error><codigo/><mensaje/><descripcion/></Error></Operaciones>. */
export function buildErrorXml(codigo, mensaje, descripcion = "") {
  return (
    `<Operaciones> <Error> <codigo>${escapeXml(codigo)}</codigo> ` +
    `<mensaje>${escapeXml(mensaje)}</mensaje> <descripcion>${escapeXml(
      descripcion
    )}</descripcion> ` +
    `</Error> </Operaciones>`
  );
}

/** Corta el XML a mitad de un elemento (buffer cortado). */
export function truncateXml(xml, ratio = 0.55) {
  return xml.slice(0, Math.max(1, Math.floor(xml.length * ratio)));
}

/** Rompe el XML: cierre de etiqueta desparejado y contenido basura (no parseable). */
export function malformXml(xml) {
  return xml
    .replace("</estado>", "</estdo")
    .replace("</Operaciones>", "<<//Operaciones");
}
