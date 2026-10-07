/** @odoo-module */
// Parser mínimo de los XML de TPV-PC Implantado (respuesta de pago/devolución
// y respuesta de consulta). Los XML de Redsys son planos, así que se extraen
// etiquetas sin DOMParser: funciona igual en navegador y en Node (tests).
// Nunca devuelve ni registra PAN completo (Redsys solo envía PAN enmascarado).

export const CARD_BRANDS = {
  1: "VISA",
  2: "MASTERCARD",
  6: "DINERS",
  8: "AMEX",
  9: "JCB",
  22: "CUP",
  97: "BIZUM",
};

const ENTITIES = {"&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&"};

function decode(text) {
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m]);
}

/** Texto de la primera etiqueta `tag` en `xml` (null si no existe). */
export function extractTag(xml, tag) {
  if (typeof xml !== "string") {
    return null;
  }
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(xml);
  if (!m) {
    return null;
  }
  return decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

/** Todos los bloques `<tag>…</tag>` (contenido interno). */
function extractBlocks(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function last4(masked) {
  if (!masked) {
    return null;
  }
  const digits = String(masked).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Normaliza texto de resultado para comparar ("AUTORIZADA" == "Autorizada"). */
function norm(value) {
  return (value || "").trim().toLowerCase();
}

/**
 * `isAuthorized(xml) ⇔ estado=="F" && resultado.toLowerCase()=="autorizada"`.
 * Acepta el XML (string) o un objeto ya parseado con `estado`/`resultado`.
 * Todo lo demás (incluido XML ausente o inválido) NO autoriza.
 */
export function isAuthorized(xmlOrParsed) {
  let estado;
  let resultado;
  if (typeof xmlOrParsed === "string") {
    estado = extractTag(xmlOrParsed, "estado");
    resultado = extractTag(xmlOrParsed, "resultado");
  } else if (xmlOrParsed && typeof xmlOrParsed === "object") {
    estado = xmlOrParsed.estado;
    resultado = xmlOrParsed.resultado;
  }
  return (
    (estado || "").trim().toUpperCase() === "F" && norm(resultado) === "autorizada"
  );
}

/** Error de negocio de Redsys: <Error><codigo/><mensaje/><descripcion/></Error>. */
export function parseErrorXml(xml) {
  const block = extractBlocks(xml || "", "Error")[0];
  if (block === undefined) {
    return null;
  }
  return {
    codigo: extractTag(block, "codigo"),
    mensaje: extractTag(block, "mensaje"),
    descripcion: extractTag(block, "descripcion"),
  };
}

/**
 * Parsea la respuesta de fnDllOperPinPad / fnDllOperComContable.
 * kind: 'operation' (hay resultadoOperacion), 'error' (<Error>) o 'invalid'.
 */
export function parsePayXml(xml) {
  const empty = {
    kind: "invalid",
    authorized: false,
    estado: null,
    resultado: null,
    codigoRespuesta: null,
    pedido: null,
    rts: null,
    factura: null,
    importe: null,
    fecha: null,
    cardBrand: null,
    cardBrandCode: null,
    maskedPan: null,
    last4: null,
    dcc: false,
    error: null,
    rawXml: typeof xml === "string" ? xml : null,
  };
  if (typeof xml !== "string" || !xml.trim()) {
    return empty;
  }
  const err = parseErrorXml(xml);
  const block = extractBlocks(xml, "resultadoOperacion")[0];
  if (block === undefined) {
    return err ? {...empty, kind: "error", error: err} : empty;
  }
  const brandCode = extractTag(block, "marcaTarjeta");
  const masked =
    extractTag(block, "tarjetaClienteRecibo") ||
    extractTag(block, "tarjetaComercioRecibo");
  const parsed = {
    ...empty,
    kind: "operation",
    estado: extractTag(block, "estado"),
    resultado: extractTag(block, "resultado"),
    codigoRespuesta: extractTag(block, "codigoRespuesta"),
    pedido: extractTag(block, "pedido"),
    rts: extractTag(block, "identificadorRTS"),
    factura: extractTag(block, "factura"),
    importe: extractTag(block, "importe"),
    fecha: extractTag(block, "fechaOperacion"),
    cardBrandCode: brandCode,
    cardBrand: brandCode
      ? CARD_BRANDS[Number(brandCode)] || `MARCA_${brandCode}`
      : null,
    maskedPan: masked,
    last4: last4(masked),
    dcc: extractTag(block, "codigoDivisa") !== null, // DCC fuera de MVP: solo se detecta (S7)
    error: err,
  };
  parsed.authorized = isAuthorized(parsed);
  return parsed;
}

/**
 * Parsea la respuesta de fnDllOperConsulta (<consultas><resultadoConsulta>).
 * Devuelve { operations:[{estado,resultado,pedido,rts,factura,importe,fecha,tipo,maskedPan,last4,codigoRespuesta}],
 *            page, totalPages, error }.
 * `resultado` se conserva tal cual (en consultas viene en MAYÚSCULAS).
 */
export function parseQueryXml(xml) {
  const out = {operations: [], page: 0, totalPages: 0, error: null};
  if (typeof xml !== "string" || !xml.trim()) {
    out.error = {codigo: null, mensaje: "XML vacío", descripcion: null};
    return out;
  }
  out.error = parseErrorXml(xml);
  // La firma de la consulta cuelga de <resultadoConsulta>, no de <operacion>: se copia al XML de cada
  // operación para que el servidor vea la misma marca (p. ej. MOCK del simulador).
  const signature = extractTag(xml, "firma");
  for (const block of extractBlocks(xml, "operacion")) {
    const masked = extractTag(block, "tarjeta");
    out.operations.push({
      estado: extractTag(block, "estado"),
      resultado: extractTag(block, "resultado"),
      pedido: extractTag(block, "pedido"),
      rts: extractTag(block, "identificadorRTS"),
      factura: extractTag(block, "factura"),
      importe: extractTag(block, "importe"),
      fecha: extractTag(block, "fechaOperacion"),
      tipo: extractTag(block, "tipoOper"),
      maskedPan: masked,
      last4: last4(masked),
      codigoRespuesta: extractTag(block, "codigoRespuesta"),
      // XML de la operación tal como la devolvió la consulta: es lo que guarda la recuperación en
      // redsys_xml (el servidor lo valida igual que el XML de un cobro normal).
      rawXml: `<operacion>${block}${
        signature ? `<firma>${signature}</firma>` : ""
      }</operacion>`,
    });
  }
  out.page = Number(extractTag(xml, "numpagina")) || 0;
  out.totalPages = Number(extractTag(xml, "totalpaginas")) || 0;
  return out;
}
