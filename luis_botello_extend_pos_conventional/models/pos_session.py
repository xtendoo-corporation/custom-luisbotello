# -*- coding: utf-8 -*-
from odoo import fields, models

class PosSession(models.Model):
    _inherit = "pos.session"

    qty_200 = fields.Integer(string="Cantidad 200€", default=0)
    qty_100 = fields.Integer(string="Cantidad 100€", default=0)
    qty_50 = fields.Integer(string="Cantidad 50€", default=0)
    qty_20 = fields.Integer(string="Cantidad 20€", default=0)
    qty_10 = fields.Integer(string="Cantidad 10€", default=0)
    qty_5 = fields.Integer(string="Cantidad 5€", default=0)
    qty_2 = fields.Integer(string="Cantidad 2€", default=0)
    qty_1 = fields.Integer(string="Cantidad 1€", default=0)
    qty_050 = fields.Integer(string="Cantidad 0,50€", default=0)
    qty_020 = fields.Integer(string="Cantidad 0,20€", default=0)
    qty_010 = fields.Integer(string="Cantidad 0,10€", default=0)
    qty_005 = fields.Integer(string="Cantidad 0,05€", default=0)

