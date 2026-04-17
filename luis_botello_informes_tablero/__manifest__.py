# -*- coding: utf-8 -*-
{
    'name': 'Luis Botello - Informes TPV en Tableros',
    'version': '19.0.1.0.0',
    'category': 'Point of Sale/Reporting',
    'summary': 'Informes de pedidos TPV por día, caja y tramos horarios.',
    'author': 'Xtendoo',
    'license': 'AGPL-3',
    'depends': [
        'point_of_sale',
        'spreadsheet_dashboard',
    ],
    'data': [
        'security/ir.model.access.csv',
        'data/spreadsheet_dashboards.xml',
        'views/pos_daily_report_views.xml',
        'views/pos_hourly_report_views.xml',
        'views/menu_views.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}

