# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class AccountPaymentRegister(models.TransientModel):
    """
    Extensión del wizard estándar de registro de pago para facturas de proveedor.

    Añade el campo `create_pos_cash_out` que, cuando está marcado y el pago
    es en efectivo sobre una factura de proveedor, crea automáticamente una
    salida de caja en la sesión de TPV activa de la misma compañía.

    Estrategia transaccional:
    - Si el check está marcado y la salida no puede crearse correctamente
      (sin sesión, múltiples sesiones, etc.) se lanza UserError y toda la
      operación de pago se revierte. Esto garantiza consistencia contable y
      de caja: o se registran ambos movimientos o ninguno.
    """
    _inherit = 'account.payment.register'

    is_cash_payment = fields.Boolean(
        string='Es pago en efectivo',
        compute='_compute_is_cash_payment',
        help='Verdadero si el diario seleccionado es de tipo Efectivo.',
    )
    is_supplier_invoice = fields.Boolean(
        string='Es factura de proveedor',
        compute='_compute_is_supplier_invoice',
        help='Verdadero si todos los documentos son facturas de proveedor.',
    )
    create_pos_cash_out = fields.Boolean(
        string='Crear salida en la sesión actual',
        default=False,
        help=(
            'Si está marcado, al registrar el pago en efectivo se generará '
            'una salida de caja en la sesión de TPV abierta de la misma compañía.'
        ),
    )

    # ── Computed fields ───────────────────────────────────────────────────────

    @api.depends('journal_id')
    def _compute_is_cash_payment(self):
        for wizard in self:
            wizard.is_cash_payment = (
                wizard.journal_id and wizard.journal_id.type == 'cash'
            )

    @api.depends('line_ids.move_id.move_type')
    def _compute_is_supplier_invoice(self):
        for wizard in self:
            moves = wizard.line_ids.move_id
            wizard.is_supplier_invoice = bool(moves) and all(
                move.move_type == 'in_invoice' for move in moves
            )

    # ── Default logic ─────────────────────────────────────────────────────────

    @api.model
    def default_get(self, fields_list):
        vals = super().default_get(fields_list)
        # Pre-calcular el valor por defecto de create_pos_cash_out.
        # Cuando el contexto proviene de una factura de proveedor y el diario
        # por defecto es de tipo cash, el check se marca automáticamente.
        if 'create_pos_cash_out' in fields_list:
            journal_id = vals.get('journal_id')
            if journal_id:
                journal = self.env['account.journal'].browse(journal_id)
                if journal.type == 'cash':
                    moves = self._get_moves_from_context()
                    if moves and all(m.move_type == 'in_invoice' for m in moves):
                        vals['create_pos_cash_out'] = True
        return vals

    @api.model
    def _get_moves_from_context(self):
        """Recupera los account.move activos del contexto del wizard."""
        if self.env.context.get('active_model') != 'account.move':
            return self.env['account.move']
        return self.env['account.move'].browse(
            self.env.context.get('active_ids', [])
        )

    # ── Onchange para actualizar el default al cambiar de diario ─────────────

    @api.onchange('journal_id')
    def _onchange_journal_create_pos_cash_out(self):
        """
        Cuando el usuario cambia de diario en el wizard:
        - si el nuevo diario es efectivo y es factura de proveedor → marcar True;
        - en cualquier otro caso → desmarcar.
        """
        if self.is_cash_payment and self.is_supplier_invoice:
            self.create_pos_cash_out = True
        else:
            self.create_pos_cash_out = False

    # ── POS session helper ────────────────────────────────────────────────────

    def _get_open_pos_session(self, company):
        """
        Busca la sesión de TPV abierta válida para la compañía indicada.

        Política:
        - Exactamente 1 sesión abierta → devuelve la sesión.
        - 0 sesiones abiertas → UserError.
        - >1 sesiones abiertas → UserError (para evitar imputar a caja incorrecta).

        Args:
            company: res.company de la factura/pago.

        Returns:
            pos.session (singleton)

        Raises:
            UserError: si no hay sesión abierta o hay más de una.
        """
        open_sessions = self.env['pos.session'].search([
            ('state', '=', 'opened'),
            ('company_id', '=', company.id),
        ])
        if not open_sessions:
            raise UserError(_(
                'No se puede crear la salida de caja: no existe ninguna sesión '
                'de TPV abierta en la empresa "%s".\n\n'
                'Abre una sesión de TPV e intenta registrar el pago de nuevo, '
                'o desmarca la opción "Crear salida en la sesión actual".'
            ) % company.name)
        if len(open_sessions) > 1:
            session_names = ', '.join(open_sessions.mapped('name'))
            raise UserError(_(
                'No se puede crear la salida de caja: existe más de una sesión '
                'de TPV abierta en la empresa "%s" (%s).\n\n'
                'Cierra las sesiones sobrantes hasta dejar solo una abierta '
                'e intenta registrar el pago de nuevo.'
            ) % (company.name, session_names))
        return open_sessions

    # ── POS cash-out creation ─────────────────────────────────────────────────

    def _build_cash_out_description(self, invoice, payment):
        """
        Genera el texto descriptivo de la salida de caja POS.
        Incluye número de factura, proveedor y fecha para facilitar la auditoría.
        """
        parts = [_('Pago factura proveedor')]
        if invoice.name and invoice.name != '/':
            parts.append(invoice.name)
        if invoice.partner_id:
            parts.append(invoice.partner_id.display_name)
        if invoice.invoice_date:
            parts.append(invoice.invoice_date.strftime('%d/%m/%Y'))
        payment_ref = getattr(payment, 'ref', '') or getattr(payment, 'memo', '')
        if payment_ref:
            parts.append(payment_ref)
        return ' | '.join(parts)

    def _create_pos_cash_statement_line(self, payment, session, invoice):
        """
        Crea la línea de salida de caja (account.bank.statement.line) en la
        sesión POS indicada.

        El importe se registra como NEGATIVO en el extracto porque representa
        una SALIDA de efectivo (cash out), conforme al funcionamiento estándar
        del TPV de Odoo donde las salidas se registran con amount < 0.

        Args:
            payment: account.payment recién creado.
            session: pos.session abierta válida.
            invoice: account.move (factura de proveedor origen).

        Returns:
            account.bank.statement.line creada.
        """
        description = self._build_cash_out_description(invoice, payment)

        # El diario de la sesión POS contiene la cuenta de efectivo
        statement_line = self.env['account.bank.statement.line'].create({
            'journal_id': session.cash_journal_id.id,
            'amount': -abs(payment.amount),          # salida → negativo
            'date': payment.date or fields.Date.today(),
            'payment_ref': description,
            'pos_session_id': session.id,
            'supplier_invoice_id': invoice.id,
            'supplier_payment_id': payment.id,
        })
        return statement_line

    # ── Override principal ────────────────────────────────────────────────────

    def action_create_payments(self):
        """
        Override del método principal de creación de pagos.

        Flujo:
        1. Validar condiciones previas (si aplica).
        2. Llamar al super() → crea los pagos contables estándar.
        3. Si `create_pos_cash_out` está activo y las condiciones se cumplen,
           crear la salida de caja en la sesión POS.
        4. Si la creación de la salida falla, la excepción propaga el rollback
           completo de la transacción (no quedan pagos sin salida de caja).
        """
        # Determinar si debemos crear la salida antes de llamar al super(),
        # para poder validar la sesión y abortar inmediatamente si hay problema.
        should_create_pos_out = (
            self.create_pos_cash_out
            and self.is_cash_payment
            and self.is_supplier_invoice
        )

        # Obtener la sesión y la factura antes de crear el pago para que,
        # si hay error, no se haya procesado nada.
        pos_session = None
        invoice = None
        if should_create_pos_out:
            invoice = self.line_ids.move_id.filtered(
                lambda m: m.move_type == 'in_invoice'
            )[:1]
            pos_session = self._get_open_pos_session(self.env.company)

        # Crear los pagos contables (super)
        result = super().action_create_payments()

        if should_create_pos_out and pos_session and invoice:
            # Recuperar el pago recién creado vinculado a la factura
            payments = self._get_created_payments(invoice)
            for payment in payments:
                # Anti-duplicado: si ya tiene salida POS, no crear otra
                if payment.pos_cash_out_id:
                    continue
                cash_out = self._create_pos_cash_statement_line(
                    payment, pos_session, invoice
                )
                payment.pos_cash_out_id = cash_out.id

        return result

    def _get_created_payments(self, invoice):
        """
        Recupera los pagos account.payment que han sido reconciliados
        con la factura indicada tras llamar al super().

        Utiliza las líneas de conciliación de las líneas de deudor/acreedor
        de la factura para localizar los pagos creados.
        """
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
                if counterpart.payment_id and counterpart.payment_id not in payments:
                    payments |= counterpart.payment_id
        return payments
