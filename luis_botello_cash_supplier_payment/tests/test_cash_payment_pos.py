# -*- coding: utf-8 -*-
from odoo import fields
from odoo.exceptions import UserError
from odoo.tests.common import tagged
from .common import CashSupplierPaymentCommon

@tagged('post_install', '-at_install', 'luis_botello')
class TestCashPaymentPos(CashSupplierPaymentCommon):
    """Suite de tests robusta para luis_botello_cash_supplier_payment."""

    def test_01_happy_path_single_session(self):
        """Pago en efectivo con una sesión abierta -> Salida POS creada."""
        session = self._open_pos_session()
        invoice = self._create_supplier_invoice(amount=300.0)
        
        self._register_payment(invoice, journal=self.cash_journal, create_pos_cash_out=True)
        
        payments = self._get_payment_for_invoice(invoice)
        self.assertEqual(len(payments), 1)
        payment = payments[0]
        
        self.assertTrue(payment.pos_cash_out_id, "Debe existir salida POS")
        self.assertAlmostEqual(abs(payment.pos_cash_out_id.amount), 300.0)
        self.assertEqual(payment.pos_cash_out_id.supplier_invoice_id, invoice)

    def test_02_no_session_error(self):
        """Pago en efectivo sin sesiones abiertas -> UserError."""
        # Asegurar cero sesiones abiertas
        self.env['pos.session'].search([('state', '=', 'opened'), ('company_id', '=', self.company.id)]).sudo().write({'state': 'closed'})
        
        invoice = self._create_supplier_invoice(amount=100.0)
        with self.assertRaises(UserError):
            self._register_payment(invoice, create_pos_cash_out=True)

    def test_03_multiple_sessions_error(self):
        """Más de una sesión abierta -> UserError."""
        self._open_pos_session()
        other_config = self.env['pos.config'].sudo().create({
            'name': 'TPV 2', 'company_id': self.company.id, 'journal_id': self.cash_journal.id
        })
        self._open_pos_session(pos_config=other_config)
        
        invoice = self._create_supplier_invoice(amount=100.0)
        with self.assertRaises(UserError):
            self._register_payment(invoice, create_pos_cash_out=True)

    def test_04_check_unchecked_no_out(self):
        """Check desmarcado -> No se crea salida POS."""
        self._open_pos_session()
        invoice = self._create_supplier_invoice(amount=100.0)
        self._register_payment(invoice, create_pos_cash_out=False)
        
        payment = self._get_payment_for_invoice(invoice)
        self.assertFalse(payment.pos_cash_out_id)

    def test_05_bank_payment_no_out(self):
        """Pago por banco -> No se crea salida POS (aunque check=True)."""
        self._open_pos_session()
        invoice = self._create_supplier_invoice(amount=100.0)
        self._register_payment(invoice, journal=self.bank_journal, create_pos_cash_out=True)
        
        payment = self._get_payment_for_invoice(invoice)
        self.assertFalse(payment.pos_cash_out_id)

    def test_07_anti_duplicate(self):
        """Un pago no debe tener dos salidas."""
        self._open_pos_session()
        invoice = self._create_supplier_invoice(amount=100.0)
        self._register_payment(invoice, create_pos_cash_out=True)
        
        payment = self._get_payment_for_invoice(invoice)
        self.assertTrue(payment.pos_cash_out_id)
        
        # Intentar forzar otra salida vía wizard sobre el mismo invoice (residual será 0)
        with self.assertRaises(UserError):
            self.env['account.payment.register'].with_context(
                active_model='account.move', active_ids=invoice.ids
            ).create({
                'journal_id': self.cash_journal.id,
                'create_pos_cash_out': True
            }).action_create_payments()

    def test_08_partial_payment(self):
        """Pago parcial -> Salida por importe parcial."""
        self._open_pos_session()
        invoice = self._create_supplier_invoice(amount=100.0)
        
        self.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=invoice.ids
        ).create({
            'amount': 40.0,
            'journal_id': self.cash_journal.id,
            'create_pos_cash_out': True
        }).action_create_payments()
        
        payment = self._get_payment_for_invoice(invoice)
        self.assertAlmostEqual(abs(payment.pos_cash_out_id.amount), 40.0)

    def test_09_multi_invoice(self):
        """Pago en lote -> Una salida por el total."""
        self._open_pos_session()
        inv1 = self._create_supplier_invoice(amount=10.0)
        inv2 = self._create_supplier_invoice(amount=20.0)
        
        self.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=[inv1.id, inv2.id]
        ).create({
            'journal_id': self.cash_journal.id,
            'create_pos_cash_out': True,
            'group_payment': True
        }).action_create_payments()
        
        payment = self._get_payment_for_invoice(inv1)
        self.assertAlmostEqual(abs(payment.pos_cash_out_id.amount), 30.0)

    def test_10_refund_safe(self):
        """Abonos (Refunds) -> Check desmarcado por defecto/seguro."""
        self._open_pos_session()
        refund = self.env['account.move'].sudo().create({
            'move_type': 'in_refund',
            'partner_id': self.supplier.id,
            'invoice_date': fields.Date.today(),
            'invoice_line_ids': [(0, 0, {'name': 'x', 'quantity': 1, 'price_unit': 10.0, 'account_id': self.expense_account.id})],
        })
        refund.action_post()
        
        wizard = self.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=refund.ids
        ).create({'journal_id': self.cash_journal.id})
        
        self.assertFalse(wizard.create_pos_cash_out)

    def test_11_closed_session(self):
        """Sesión cerrando/cerrada -> UserError."""
        session = self._open_pos_session()
        session.sudo().write({'state': 'closing_control'})
        session.flush_recordset()
        
        invoice = self._create_supplier_invoice(amount=100.0)
        with self.assertRaises(UserError):
            self._register_payment(invoice, create_pos_cash_out=True)
