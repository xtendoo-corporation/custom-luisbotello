# -*- coding: utf-8 -*-
from odoo import models, fields, api


class AccountMove(models.Model):
    """
    Extensión de account.move para ofrecer trazabilidad hacia las salidas
    de caja POS generadas desde pagos vinculados a esta factura de proveedor.
    """
    _inherit = 'account.move'

    pos_cash_out_count = fields.Integer(
        string='Salidas POS',
        compute='_compute_pos_cash_out_count',
        help='Número de salidas de caja POS generadas desde pagos de esta factura.',
    )

    @api.depends('invoice_payments_widget')
    def _compute_pos_cash_out_count(self):
        """
        Cuenta las salidas de caja POS vinculadas a los pagos reconciliados
        con esta factura.
        """
        for move in self:
            if move.move_type not in ('in_invoice', 'in_refund'):
                move.pos_cash_out_count = 0
                continue
            payments = self._get_reconciled_payments(move)
            move.pos_cash_out_count = len(
                payments.filtered(lambda p: p.pos_cash_out_id)
                .mapped('pos_cash_out_id')
            )

    def _get_reconciled_payments(self, move):
        """Devuelve los pagos reconciliados con el asiento."""
        reconciled_lines = move.line_ids.filtered(
            lambda l: l.account_id.account_type in (
                'liability_payable', 'asset_receivable'
            )
        )
        payments = self.env['account.payment']
        for line in reconciled_lines:
            matched = line.matched_debit_ids | line.matched_credit_ids
            for partial in matched:
                counterpart = (
                    partial.debit_move_id
                    if partial.credit_move_id == line
                    else partial.credit_move_id
                )
                if counterpart.payment_id:
                    payments |= counterpart.payment_id
        return payments

    def action_view_pos_cash_outs(self):
        """Smart button en la factura de proveedor → salidas de caja POS."""
        self.ensure_one()
        payments = self._get_reconciled_payments(self)
        cash_out_lines = payments.filtered(
            lambda p: p.pos_cash_out_id
        ).mapped('pos_cash_out_id')
        return cash_out_lines.action_open_pos_cash_outs('Salidas de caja POS')
