{
    "name": "Luis Botello POS Redsys TPV-PC",
    "summary": "Cobro con datáfono Verifone P400 (Redsys TPV-PC Implantado) en el POS",
    "version": "19.0.1.0.0",
    "author": "Luis Botello",
    "category": "Point of Sale",
    "license": "OPL-1",
    "depends": ["point_of_sale"],
    "data": [
        "security/ir.model.access.csv",
        "views/pos_payment_method_views.xml",
        "views/pos_payment_views.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "luis_botello_pos_redsys_tpvpc/static/src/**/*",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
