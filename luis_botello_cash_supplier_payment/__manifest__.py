# -*- coding: utf-8 -*-
{
    'name': 'Luis Botello - Pago proveedor en efectivo → Salida POS',
    'version': '19.0.1.0.0',
    'category': 'Accounting/Point of Sale',
    'summary': (
        'Al pagar una factura de proveedor en efectivo, crea automáticamente '
        'una salida de caja en la sesión de TPV activa.'
    ),
    'author': 'Xtendoo',
    'license': 'AGPL-3',
    'depends': [
        'account',
        'point_of_sale',
    ],
    'data': [
        'security/ir.model.access.csv',
        'views/account_payment_register_views.xml',
        'views/account_payment_views.xml',
        'views/account_move_views.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
