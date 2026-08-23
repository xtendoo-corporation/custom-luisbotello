{
    "name": "luis_botello_extend_pos_conventional",
    "summary": (
        "Extend POS Conventional receipt to show POS name instead of "
        "company name (OWL and QWeb)"
    ),
    "version": "19.0.1.0.0",
    "author": "Luis Botello",
    "category": "Point of Sale",
    "license": "OPL-1",
    "depends": [
        "pos_conventional_receipt",
        "pos_conventional_receipt_custom",
        "pos_conventional_session_management",
        "pos_conventional_cash_calculator",
        "pos_conventional_config_user_filter",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "luis_botello_extend_pos_conventional/static/src/xml/receipt_templates.xml",
            "luis_botello_extend_pos_conventional/static/src/js/orderline_patch.js",
            "luis_botello_extend_pos_conventional/static/src/js/hide_return_button.js",
        ],
        "web.assets_backend": [
            "luis_botello_extend_pos_conventional/static/src/js/closing_popup_patch.js",
            "luis_botello_extend_pos_conventional/static/src/xml/closing_popup_patch.xml",
            "luis_botello_extend_pos_conventional/static/src/js/hide_return_button_backend.js",
        ],
    },
    "data": [
        "report/pos_order_report_inherit.xml",
        "views/pos_config_views.xml",
        "views/res_config_settings_views.xml",
        "views/pos_order_hide_return_button.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
