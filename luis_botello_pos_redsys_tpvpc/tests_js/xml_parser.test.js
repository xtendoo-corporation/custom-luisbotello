import test from "node:test";
import assert from "node:assert/strict";
import { parsePayXml, parseQueryXml, isAuthorized, parseErrorXml } from "../static/src/app/redsys/xml_parser.js";
import { describeTpvpc, describeReturn, normalizeTpvpcCode } from "../static/src/app/redsys/errors.js";
import { AUTH_XML, QUERY_XML } from "./fake_transport.js";

test("isAuthorized exige estado F y resultado autorizada (sin distinguir mayúsculas)", () => {
    assert.equal(isAuthorized(AUTH_XML()), true);
    assert.equal(isAuthorized(AUTH_XML({ resultado: "AUTORIZADA" })), true);
    assert.equal(isAuthorized(AUTH_XML({ estado: "P" })), false);
    assert.equal(isAuthorized(AUTH_XML({ estado: "G", resultado: "Denegada" })), false);
    assert.equal(isAuthorized(AUTH_XML({ resultado: "Denegada" })), false);
    assert.equal(isAuthorized(""), false);
    assert.equal(isAuthorized(null), false);
    assert.equal(isAuthorized("<basura>"), false);
});

test("parsePayXml: XML real del manual v2.52 (Visa/MC, pedido y RTS)", () => {
    const xml =
        "<Operaciones version=\"6.0\"> <resultadoOperacion> <tipoPago>PAGO</tipoPago> <importe>1.01</importe> <moneda>978</moneda> " +
        "<tarjetaComercioRecibo>************0018</tarjetaComercioRecibo> <tarjetaClienteRecibo>************0018</tarjetaClienteRecibo> " +
        "<marcaTarjeta>2</marcaTarjeta> <caducidad>1210</caducidad> <comercio>777888991</comercio> <terminal>1</terminal> <pedido>10549</pedido> " +
        "<tipoTasaAplicada>DEB</tipoTasaAplicada> <identificadorRTS>070001070319153828378272</identificadorRTS> <factura>FAC-LATENTE</factura> " +
        "<fechaOperacion>2007-03-19 15:38:28.484</fechaOperacion> <estado>F</estado> <resultado>Autorizada</resultado> <codigoRespuesta>080922</codigoRespuesta> " +
        "<Literales> <literal>NO REFUND</literal> </Literales> <firma>664AD</firma> <operacionemv>true</operacionemv> </resultadoOperacion> </Operaciones>";
    const p = parsePayXml(xml);
    assert.equal(p.kind, "operation");
    assert.equal(p.authorized, true);
    assert.equal(p.pedido, "10549");
    assert.equal(p.rts, "070001070319153828378272");
    assert.equal(p.cardBrand, "MASTERCARD");
    assert.equal(p.last4, "0018");
    assert.equal(p.factura, "FAC-LATENTE");
    assert.equal(p.dcc, false);
});

test("parsePayXml: Error, vacío y basura", () => {
    const err = parsePayXml("<Operaciones><Error><codigo>TPV-PC_EMV0002</codigo><mensaje>Operación CANCELADA. Código de Error [0002]</mensaje><descripcion>XXX-XXX</descripcion></Error></Operaciones>");
    assert.equal(err.kind, "error");
    assert.equal(err.error.codigo, "TPV-PC_EMV0002");
    assert.equal(parsePayXml("").kind, "invalid");
    assert.equal(parsePayXml(null).kind, "invalid");
    assert.equal(parsePayXml("hola").authorized, false);
    assert.equal(parseErrorXml("<x/>"), null);
});

test("parseQueryXml: operaciones, paginación y no confunde <operaciones>", () => {
    const q = parseQueryXml(QUERY_XML([{ factura: "A", pedido: "1" }, { factura: "B", pedido: "2", resultado: "DENEGADA" }], 3));
    assert.equal(q.operations.length, 2);
    assert.equal(q.operations[0].factura, "A");
    assert.equal(q.operations[0].rts, "RTS1");
    assert.equal(q.operations[1].resultado, "DENEGADA");
    assert.equal(q.operations[0].last4, "5532");
    assert.equal(q.totalPages, 3);
    assert.equal(parseQueryXml(QUERY_XML([])).operations.length, 0);
    assert.ok(parseQueryXml("").error);
});

test("errors: normalización y catálogo Anexo VI", () => {
    assert.equal(normalizeTpvpcCode("TPV-PC_EMV0002"), "TPVPCEMV0002");
    assert.match(describeTpvpc("TPV-PC0074"), /CVC2/);
    assert.match(describeTpvpc("TPVPC0074"), /CVC2/);
    assert.match(describeTpvpc("SOAP-TPVPC0002"), /Firma/);
    assert.equal(describeTpvpc("TPV-PC9999"), null);
});

test("errors: retornos §4.9 en español", () => {
    assert.match(describeReturn("fnDllIniTpvpcLatente", -16), /Internet/);
    assert.match(describeReturn("fnDllIniTpvpcLatente", -20), /COM/);
    assert.match(describeReturn("fnDllIniTpvpcLatente", -21), /versión/i);
    assert.match(describeReturn("fnDllIniTpvpcLatente", -40), /caducado/);
    assert.match(describeReturn("fnDllOperPinPad", -2), /consultar|comprobar/i);
    assert.match(describeReturn("fnDllOperPinPad", -18), /importe/);
    assert.match(describeReturn("fnDllOperComContable", -12), /interno/);
    assert.match(describeReturn("fnDllOperPinPad", -777), /777/);
});
