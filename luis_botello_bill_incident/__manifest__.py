{
    'name': 'Luis Botello - Incidencias en facturas de proveedor',
    'version': '19.0.1.0.0',
    'category': 'Accounting',
    'summary': 'Campo «Incidencias» en facturas de proveedor, con aviso '
               'emergente al abrir la factura.',
    'author': 'Xtendoo',
    'license': 'LGPL-3',
    'depends': ['account'],
    'data': [
        'views/account_move_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'luis_botello_bill_incident/static/src/js/incident_alert.js',
        ],
        'web.assets_tests': [
            'luis_botello_bill_incident/static/tests/tours/*.js',
        ],
    },
    'installable': True,
    'application': False,
}
