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
    ],
    "data": [],
    "assets": {
        "web.assets_backend": [
            "luis_botello_stock_count_add/static/src/js/relational_model_similar_records_patch.js",
            "luis_botello_stock_count_add/static/src/js/record_merge_reload_patch.js",
        ],
    },
    "installable": True,
    "application": False,
}
