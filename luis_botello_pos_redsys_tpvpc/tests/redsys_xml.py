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
