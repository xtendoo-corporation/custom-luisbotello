{
    'name': 'Luis Botello - Beneficio TPV por periodo',
    'version': '19.0.1.2.0',
    'category': 'Point of Sale/Reporting',
    'summary': 'Informe de beneficio (margen) del TPV agrupado por periodo.',
    'author': 'Xtendoo',
    'license': 'AGPL-3',
    'depends': ['point_of_sale'],
    'data': [
        'views/pos_order_report_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'luis_botello_pos_margin_report/static/src/pivot/pivot_model.js',
        ],
    },
    'installable': True,
    'application': False,
}
