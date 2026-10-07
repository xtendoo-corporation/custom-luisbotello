// Transporte fake mínimo para los tests del servicio (el mock completo es del
// Simulador, en static/src/app/redsys/mock/). Respuestas por cola por comando.
export const AUTH_XML = (o = {}) =>
    `<Operaciones version="6.0"><resultadoOperacion><tipoPago>PAGO</tipoPago><importe>${o.importe || "12.34"}</importe>` +
    `<moneda>978</moneda><tarjetaClienteRecibo>************0018</tarjetaClienteRecibo><marcaTarjeta>2</marcaTarjeta>` +
    `<comercio>777888991</comercio><terminal>1</terminal><pedido>${o.pedido || "10549"}</pedido>` +
    `<identificadorRTS>${o.rts || "070001070319153828378272"}</identificadorRTS><factura>${o.factura || "ODOO-AAAA1111"}</factura>` +
    `<fechaOperacion>2026-10-07 10:00:00.0</fechaOperacion><estado>${o.estado || "F"}</estado>` +
    `<resultado>${o.resultado || "Autorizada"}</resultado><codigoRespuesta>${o.codigo || "080922"}</codigoRespuesta>` +
    `</resultadoOperacion></Operaciones>`;

export const QUERY_XML = (ops = [], totalPages = 1) =>
    `<consultas version="2.1"><resultadoConsulta>` +
    ops
        .map(
            (o) =>
                `<operacion><tipoOper>Autorizacion</tipoOper><tarjeta>************5532</tarjeta><importe>12.34</importe>` +
                `<pedido>${o.pedido || "1110"}</pedido><identificadorRTS>${o.rts || "RTS1"}</identificadorRTS>` +
                `<fechaOperacion>2026-10-07 10:00:00.0</fechaOperacion><factura>${o.factura}</factura>` +
                `<estado>${o.estado || "F"}</estado><resultado>${o.resultado || "AUTORIZADA"}</resultado>` +
                `<codigoRespuesta>0</codigoRespuesta></operacion>`
        )
        .join("") +
    `<numoperaciones>${ops.length}</numoperaciones><numpagina>1</numpagina><totalpaginas>${totalPages}</totalpaginas>` +
    `</resultadoConsulta></consultas>`;

export class FakeTransport {
    constructor() {
        this.queues = {}; // command -> [ret | fn]
        this.calls = []; // {command, args}
        this.handlers = {};
        this.initQueue = [];
    }
    queue(command, ...rets) {
        (this.queues[command] ||= []).push(...rets);
        return this;
    }
    initFnDll(args, cb) {
        this.calls.push({ command: "init", args });
        const ret = this.initQueue.length ? this.initQueue.shift() : { Response: 0, Result: null };
        Promise.resolve().then(() => cb(ret));
    }
    execFnDll(command, args, cb) {
        this.calls.push({ command, args });
        const q = this.queues[command] || [];
        let ret = q.length ? q.shift() : { Response: 0, Result: null };
        if (typeof ret === "function") {
            ret = ret(args);
        }
        if (ret && ret.never) {
            return; // nunca responde
        }
        if (ret && ret.throws) {
            throw new Error("boom");
        }
        Promise.resolve().then(() => cb(ret));
    }
    subscribeEvent(name, cb) {
        this.handlers[name] = cb;
    }
    count(command) {
        return this.calls.filter((c) => c.command === command).length;
    }
    EnableLog() {}
    DisableLog() {}
}
