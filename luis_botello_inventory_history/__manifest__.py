{
    'name': 'Luis Botello - Histórico de inventarios',
    'version': '19.0.1.0.0',
    'category': 'Inventory/Reporting',
    'summary': 'Guarda un documento de conteo por almacén cada vez que se aplica '
               'un inventario, con cantidad teórica, contada y diferencia.',
    'author': 'Xtendoo',
    'license': 'AGPL-3',
    'depends': ['stock'],
    'data': [
        'security/ir.model.access.csv',
        'security/stock_inventory_history_security.xml',
        'data/ir_sequence_data.xml',
        'report/stock_inventory_history_report.xml',
        'views/stock_inventory_history_views.xml',
    ],
    'installable': True,
    'application': False,
}
