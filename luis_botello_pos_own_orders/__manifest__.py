{
    'name': 'Luis Botello - TPV: cada usuario ve solo sus pedidos',
    'version': '19.0.1.0.0',
    'category': 'Point of Sale',
    'summary': 'Los usuarios de TPV (sin rol responsable) solo ven los pedidos que han realizado ellos.',
    'author': 'Xtendoo',
    'license': 'AGPL-3',
    'depends': ['point_of_sale'],
    'data': [
        'security/pos_order_rules.xml',
    ],
    'installable': True,
    'application': False,
}
