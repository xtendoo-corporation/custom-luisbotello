{
    "name": "Luis Botello - Conteo aditivo de inventario",
    "version": "19.0.1.0.0",
    "summary": (
        "Asistente de conteo de inventario ADITIVO: suma sobre lo ya contado "
        "en la misma sesión sin tocar el stock real."
    ),
    "author": "Xtendoo",
    "license": "AGPL-3",
    "category": "Inventory",
    "depends": [
        "stock",
        # Recomendado: bloquea el conteo si hay movimientos hechos y sin validar
        # sobre el producto/ubicacion/lote. No disponible en el checkout 19.0 de
        # OCA/stock-logistics-warehouse; activar cuando exista la rama 19.0.
        # "stock_quant_safe_inventory",
    ],
    "data": [
        "security/ir.model.access.csv",
        "views/stock_count_add_session_views.xml",
        "views/stock_count_add_menus.xml",
    ],
    "installable": True,
    "application": False,
}
