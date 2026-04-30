{
    'name': 'luis_botello_extend_pos_conventional',
    'summary': 'Extend POS Conventional receipt to show POS name instead of company name (OWL and QWeb)',
    'version': '19.0.1.0.0',
    'author': 'Luis Botello',
    'category': 'Point of Sale',
    'license': 'OPL-1',
    'depends': [
        'pos_conventional_receipt',
        'pos_conventional_receipt_custom'
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'luis_botello_extend_pos_conventional/static/src/xml/receipt_templates.xml',
        ],
    },
    'data': [
        'report/pos_order_report_inherit.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
