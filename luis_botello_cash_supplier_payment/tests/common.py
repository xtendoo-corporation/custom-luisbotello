# -*- coding: utf-8 -*-
"""
Base común para los tests de luis_botello_cash_supplier_payment.

Proporciona:
- Compañía y partner de proveedor
- Diarios de efectivo y banco
- Configuración y sesión de TPV
- Helpers para crear facturas de proveedor y registrar pagos
"""
from odoo import fields
from odoo.tests.common import TransactionCase
from odoo.exceptions import UserError


class CashSupplierPaymentCommon(TransactionCase):
    """Clase base con fixtures compartidos para todos los tests del módulo."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.env = cls.env(context=dict(cls.env.context, tracking_disable=True))
        cls.company = cls.env.company

        # ── Diarios ────────────────────────────────────────────────────────────
        cls.cash_journal = cls.env['account.journal'].search(
            [('type', '=', 'cash'), ('company_id', '=', cls.company.id)],
            limit=1,
        )
        if not cls.cash_journal:
            cls.cash_journal = cls.env['account.journal'].create({
                'name': 'Test Caja', 'code': 'TCAJ', 'type': 'cash',
                'company_id': cls.company.id,
            })

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

        # ── Configuración POS ─────────────────────────────────────────────────
        cls.pos_config = cls.env['pos.config'].search(
            [('company_id', '=', cls.company.id)],
            limit=1,
        )
        # Crear un método de pago para el TPV vinculado al diario de caja
        cls.pos_payment_method = cls.env['pos.payment.method'].create({
            'name': 'Efectivo TPV',
            'journal_id': cls.cash_journal.id,
            'company_id': cls.company.id,
        })

        if not cls.pos_config:
            cls.pos_config = cls.env['pos.config'].create({
                'name': 'TPV Test',
                'company_id': cls.company.id,
                'invoice_journal_id': cls.env['account.journal'].search(
                    [('type', '=', 'sale'), ('company_id', '=', cls.company.id)],
                    limit=1,
                ).id,
                'payment_method_ids': [(6, 0, [cls.pos_payment_method.id])],
            })
        else:
            cls.pos_config.write({
                'payment_method_ids': [(4, cls.pos_payment_method.id)],
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
        
        # Asegurar que el config tiene el diario de caja correcto
        if not config.journal_id or config.journal_id.id != self.cash_journal.id:
            config.write({'journal_id': self.cash_journal.id})

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
