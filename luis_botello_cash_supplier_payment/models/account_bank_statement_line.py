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

    def action_open_pos_cash_outs(self, action_name=None):
        """Abre las salidas POS en las vistas compactas del módulo."""
        action_name = action_name or 'Salidas de caja POS'
        list_view = self.env.ref(
            'luis_botello_cash_supplier_payment.view_account_bank_statement_line_pos_cash_out_list'
        )
        form_view = self.env.ref(
            'luis_botello_cash_supplier_payment.view_account_bank_statement_line_pos_cash_out_form'
        )

        action = {
            'type': 'ir.actions.act_window',
            'name': action_name,
            'res_model': 'account.bank.statement.line',
            'target': 'current',
            'context': {
                'create': False,
                'edit': False,
                'delete': False,
            },
        }
        if len(self) == 1:
            action.update({
                'view_mode': 'form',
                'views': [(form_view.id, 'form')],
                'res_id': self.id,
            })
        else:
            action.update({
                'view_mode': 'list,form',
                'views': [(list_view.id, 'list'), (form_view.id, 'form')],
                'domain': [('id', 'in', self.ids)],
            })
        return action

