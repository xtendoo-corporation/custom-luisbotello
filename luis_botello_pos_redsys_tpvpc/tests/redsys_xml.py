def redsys_xml(
    amount=10.0,
    pedido="123456789012",
    rts="070001070319153828378272",
    factura="ODOO-ABCD1234",
    estado="F",
    resultado="Autorizada",
    comercio="123456789",
    terminal="1",
):
    return (
        '<Operaciones version="6.0"><resultadoOperacion><tipoPago>PAGO</tipoPago>'
        f"<importe>{abs(amount):.2f}</importe><moneda>978</moneda>"
        f"<comercio>{comercio}</comercio><terminal>{terminal}</terminal>"
        f"<pedido>{pedido}</pedido><identificadorRTS>{rts}</identificadorRTS>"
        f"<factura>{factura}</factura><estado>{estado}</estado>"
        f"<resultado>{resultado}</resultado></resultadoOperacion></Operaciones>"
    )


def redsys_query_op_xml(
    amount=10.0,
    pedido="123456789012",
    rts="070001070319153828378272",
    factura="ODOO-ABCD1234",
    estado="F",
    resultado="AUTORIZADA",
    terminal="1",
    firma="0123456789ABCDEF0123456789ABCDEF01234567",
):
    """`redsys_xml` tal como lo guarda la recuperación por consulta (parseQueryXml().rawXml):
    el <operacion> de <resultadoConsulta> (ConsultasV2d2: resultado en MAYÚSCULAS, sin
    <comercio>) con la <firma> de la consulta. Formato idéntico al que emite el simulador."""
    sig = f"<firma>{firma}</firma>" if firma else ""
    return (
        "<operacion> <tipoOper>Autorizacion</tipoOper> <tarjeta>************0004</tarjeta> "
        "<caducidad>1230</caducidad> "
        f"<importe>{abs(amount):.2f}</importe> <moneda>978</moneda> <terminal>{terminal}</terminal> "
        f"<pedido>{pedido}</pedido> <identificadorRTS>{rts}</identificadorRTS> "
        "<fechaOperacion>2026-10-07 10:00:00.000</fechaOperacion> "
        f"<factura>{factura}</factura> <estado>{estado}</estado> <resultado>{resultado}</resultado> "
        f"<codigoRespuesta>0</codigoRespuesta> <numAutorizacion>123456</numAutorizacion> {sig}</operacion>"
    )
