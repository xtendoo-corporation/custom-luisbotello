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
        # Aseguramos que nuestro override de add_product_by_barcode se cargue
        # después de los módulos POS convencionales de Xtendoo
        'pos_conventional_core',
        'pos_conventional_order_barcode',
        'pos_conventional_barcode_scanner',
    ],
    'data': [
        'views/account_move_views.xml',
        'views/pos_order_views.xml',
    ],
    'installable': True,
    'application': False,
}
