{
    'name': 'Luis Botello Orderpoint Rounding',
    'version': '19.0.1.0.0',
    'category': 'Inventory',
    'summary': 'Asistente de estacionalidad: cantidades enteras, sin líneas a cero y vista mejorada',
    'author': 'Xtendoo',
    'license': 'LGPL-3',
    'depends': ['xtendoo_stock_orderpoint_period', 'luis_botello_cost_price'],
    'data': [
        'views/seasonality_wizard_views.xml',
    ],
    'auto_install': True,
    'installable': True,
    'application': False,
}
