# -*- coding: utf-8 -*-
{
    "name": "Luis Botello - Stock consolidado (todos los almacenes)",
    "version": "19.0.1.0.0",
    "summary": "Informe que muestra el stock total de productos sumando todos los almacenes",
    "description": "Reporte de stock consolidado.",
    "author": "xtendoo / luis_botello",
    "category": "Inventory/Reporting",
    "license": "LGPL-3",
    "depends": ["stock", "product"],
    "data": [
        "security/ir.model.access.csv",
        "views/luis_botello_stock_report_views.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}

