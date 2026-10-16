{
    'name': 'Luis Botello Purchase Line Location',
    'version': '19.0.1.0.0',
    'category': 'Inventory/Purchase',
    'summary': 'Ubicación de destino por línea de compra y descuento de '
               'proveedor según la cantidad total del producto en el pedido',
    'author': 'Xtendoo',
    'license': 'LGPL-3',
    'depends': ['purchase_stock'],
    'data': [
        'views/purchase_order_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'luisbotello_purchase_line_location/static/src/**/*',
        ],
    },
    'installable': True,
    'application': False,
}
