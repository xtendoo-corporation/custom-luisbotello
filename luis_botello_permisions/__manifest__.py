{
    "name": "Luis Botello Permissions",
    "version": "1.0",
    "category": "Security",
    "summary": "Gestión de permisos para márgenes y costes",
    "author": "Xtendoo",
    "depends": [
        "base",
        "sale_margin",
        "point_of_sale",
        "account",
        "account_invoice_margin",
        "product",
        "pos_conventional_core"
    ],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
        "views/sale_order_views.xml",
        "views/account_move_views.xml",
        "views/product_views.xml",
        "views/pos_order_views.xml",
        "wizard/pos_category_to_product_views.xml",
    ],
    "installable": True,
    "license": "LGPL-3",
}

