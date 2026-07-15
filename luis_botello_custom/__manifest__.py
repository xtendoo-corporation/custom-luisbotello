{
    'name': 'Luis Botello Customizations',
    'version': '19.0.1.0.0',
    'category': 'Sales/Sales',
    'summary': 'Personalizaciones para Luis Botello: Descuento en línea (Desc. Lin)',
    'author': 'Xtendoo',
    'license': 'LGPL-3',
    'depends': [
        'sale',
        'account',
        'point_of_sale',
    ],
    'data': [
        'views/sale_order_views.xml',
        'views/account_move_views.xml',
        'views/pos_order_views.xml',
    ],
    'installable': True,
    'application': False,
}
