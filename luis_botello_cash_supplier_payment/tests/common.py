# -*- coding: utf-8 -*-
"""
Base común para los tests de luis_botello_cash_supplier_payment.

Proporciona:
- Compañía y partner de proveedor
- Diarios de efectivo y banco
- Configuración y sesión de TPV
- Helpers para crear facturas de proveedor y registrar pagos
"""
from uuid import uuid4

from odoo import fields
from odoo.tests.common import TransactionCase


class CashSupplierPaymentCommon(TransactionCase):
    """Clase base con fixtures compartidos para todos los tests del módulo."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.env = cls.env(context=dict(cls.env.context, tracking_disable=True))
        cls.company = cls.env.company

        cls.bank_journal = cls.env['account.journal'].search(
            [('type', '=', 'bank'), ('company_id', '=', cls.company.id)],
            limit=1,
        )
        if not cls.bank_journal:
            cls.bank_journal = cls.env['account.journal'].create({
                'name': 'Test Banco', 'code': 'TBNK', 'type': 'bank',
                'company_id': cls.company.id,
            })

        cls.purchase_journal = cls.env['account.journal'].search(
            [('type', '=', 'purchase'), ('company_id', '=', cls.company.id)],
            limit=1,
        )

        # ── Partner proveedor ─────────────────────────────────────────────────
        cls.supplier = cls.env['res.partner'].search(
            [('supplier_rank', '>', 0), ('company_id', 'in', [False, cls.company.id])],
            limit=1,
        )
        if not cls.supplier:
            cls.supplier = cls.env['res.partner'].create({
                'name': 'Proveedor Test',
                'supplier_rank': 1,
            })

        # ── Cuenta de gasto ───────────────────────────────────────────────────
        cls.expense_account = cls.env['account.account'].search(
            [
                ('account_type', 'in', ('expense', 'expense_direct_cost')),
                ('company_ids', 'in', cls.company.id),
            ],
            limit=1,
        )
        assert cls.expense_account, 'No expense account found in test company'

        cls.cash_account = cls.env['account.account'].search(
            [
                ('account_type', '=', 'asset_cash'),
                ('company_ids', 'in', cls.company.id),
            ],
            limit=1,
        )
        assert cls.cash_account, 'No cash account found in test company'

        # ── Diarios ────────────────────────────────────────────────────────────
        cls.cash_journal = cls.env['account.journal'].create({
            'name': 'Test Caja Pago Proveedor',
            'code': f"L{uuid4().hex[:4].upper()}",
            'type': 'cash',
            'company_id': cls.company.id,
            'default_account_id': cls.cash_account.id,
        })

        # ── Configuración POS ─────────────────────────────────────────────────
        cls.pos_payment_method = cls.env['pos.payment.method'].create({
            'name': 'Efectivo TPV Test Pago Proveedor',
            'journal_id': cls.cash_journal.id,
            'company_id': cls.company.id,
        })

        cls.pos_config = cls.env['pos.config'].sudo().create({
            'name': f'TPV Test - Pago proveedor cash {uuid4().hex[:6]}',
            'company_id': cls.company.id,
            'invoice_journal_id': cls.env['account.journal'].search(
                [('type', '=', 'sale'), ('company_id', '=', cls.company.id)],
                limit=1,
            ).id,
            'payment_method_ids': [(6, 0, [cls.pos_payment_method.id])],
        })

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _create_supplier_invoice(self, amount=500.0):
        """Crea y valida una factura de proveedor por el importe indicado."""
        invoice = self.env['account.move'].create({
            'move_type': 'in_invoice',
            'partner_id': self.supplier.id,
            'journal_id': self.purchase_journal.id if self.purchase_journal else False,
            'invoice_date': fields.Date.today(),
            'invoice_line_ids': [(0, 0, {
                'name': 'Servicio de prueba',
                'quantity': 1,
                'price_unit': amount,
                'account_id': self.expense_account.id,
            })],
        })
        invoice.action_post()
        return invoice

    def _open_pos_session(self, pos_config=None):
        """Abre una sesión POS y la devuelve de forma ultra-robusta para tests."""
        config = (pos_config or self.pos_config).sudo()
        if not config.payment_method_ids.filtered('is_cash_count'):
            raise AssertionError('El TPV de prueba debe tener al menos un método de pago en efectivo.')

        # Crear y forzar apertura de sesión
        session = self.env['pos.session'].sudo().create({
            'config_id': config.id,
            'user_id': self.env.uid,
            'company_id': self.company.id,
        })
        session.write({'state': 'opened'})
        # Flush para asegurar que la DB vea el estado antes del search del wizard
        session.flush_recordset()
        return session

    def _create_cash_journal(self, name, code):
        """Crea un diario de caja adicional para pruebas."""
        return self.env['account.journal'].create({
            'name': name,
            'code': code,
            'type': 'cash',
            'company_id': self.company.id,
            'default_account_id': self.cash_account.id,
        })

    def _create_pos_config_for_cash_journal(self, journal, name):
        """Crea una configuración POS con un método de pago cash ligado al diario indicado."""
        payment_method = self.env['pos.payment.method'].create({
            'name': f'{name} - Efectivo',
            'journal_id': journal.id,
            'company_id': self.company.id,
        })
        config = self.env['pos.config'].sudo().create({
            'name': name,
            'company_id': self.company.id,
            'invoice_journal_id': self.env['account.journal'].search(
                [('type', '=', 'sale'), ('company_id', '=', self.company.id)],
                limit=1,
            ).id,
            'payment_method_ids': [(6, 0, [payment_method.id])],
        })
        return config, payment_method

    def _close_pos_session(self, session):
        """Cierra la sesión POS indicada."""
        session.action_pos_session_closing_control()

    def _register_payment(self, invoice, journal=None, create_pos_cash_out=True):
        """
        Registra un pago para la factura usando el wizard estándar.

        Args:
            invoice: account.move factura de proveedor.
            journal: account.journal a usar (por defecto cash_journal).
            create_pos_cash_out: valor del check del módulo.

        Returns:
            El resultado de action_create_payments().
        """
        journal = journal or self.cash_journal
        wizard = self.env['account.payment.register'].with_context(
            active_model='account.move',
            active_ids=invoice.ids,
        ).create({
            'amount': invoice.amount_residual,
            'journal_id': journal.id,
            'create_pos_cash_out': create_pos_cash_out,
        })
        return wizard.action_create_payments()

    def _get_payment_for_invoice(self, invoice):
        """Devuelve el/los pagos reconciliados con la factura."""
        payments = self.env['account.payment']
        payable_lines = invoice.line_ids.filtered(
            lambda l: l.account_id.account_type == 'liability_payable'
        )
        for line in payable_lines:
            for partial in (line.matched_debit_ids | line.matched_credit_ids):
                counterpart = (
                    partial.debit_move_id
                    if partial.credit_move_id == line
                    else partial.credit_move_id
                )
                if counterpart.payment_id:
                    payments |= counterpart.payment_id
        return payments
