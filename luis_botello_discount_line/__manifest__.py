{
    'name': 'Luis Botello Discount Line',
    'version': '19.0.1.0.0',
    'category': 'Sales/Sales',
    'summary': 'Descuento en línea (Desc. Lin) para POS y facturas',
    'author': 'Xtendoo',
    'license': 'LGPL-3',
    'depends': [
        'account',
        'point_of_sale',
    ],
    'data': [
        'views/account_move_views.xml',
        'views/pos_order_views.xml',
    ],
    'installable': True,
    'application': False,
}
