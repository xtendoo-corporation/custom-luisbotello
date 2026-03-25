# -*- coding: utf-8 -*-
from odoo import models, fields


class AccountBankStatementLine(models.Model):
    """
    Extensión de account.bank.statement.line para registrar trazabilidad
    cuando una línea es generada como salida de caja POS desde el pago
    de una factura de proveedor en efectivo.
    """
    _inherit = 'account.bank.statement.line'

    supplier_invoice_id = fields.Many2one(
        comodel_name='account.move',
        string='Factura de proveedor',
        readonly=True,
        copy=False,
        domain=[('move_type', 'in', ('in_invoice', 'in_refund'))],
        help='Factura de proveedor que originó esta salida de caja en el TPV.',
    )
    supplier_payment_id = fields.Many2one(
        comodel_name='account.payment',
        string='Pago de proveedor',
        readonly=True,
        copy=False,
        help='Pago contable que originó esta salida de caja en el TPV.',
    )
