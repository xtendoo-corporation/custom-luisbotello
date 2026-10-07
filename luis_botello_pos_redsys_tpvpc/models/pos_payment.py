from lxml import etree
from psycopg2 import IntegrityError

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import SQL, float_compare

REDSYS_PROTECTED_STATES = ("authorized", "unknown", "refund", "not_charged")
# Estados que deben estar respaldados por una autorización de Redsys (QA-20).
REDSYS_CONFIRMED_STATES = ("authorized", "refund")
# Campos que no pueden cambiar una vez la línea tiene estado Redsys.
REDSYS_LOCKED_FIELDS = {
    "amount",
    "payment_method_id",
    "pos_order_id",
    "transaction_id",
    "payment_ref_no",
    "redsys_rts",
    "redsys_xml",
    "redsys_reference",
    "redsys_original_pedido",
}
# En una línea 'unknown' estos campos se pueden COMPLETAR (si están vacíos) al
# resolverla; nunca cambiar un valor ya presente.
REDSYS_FILLABLE_FROM_UNKNOWN = REDSYS_LOCKED_FIELDS - {
    "amount",
    "payment_method_id",
    "pos_order_id",
}
# Trazabilidad de la conciliación manual: solo las escribe `redsys_reconcile`.
REDSYS_RESOLUTION_FIELDS = {
    "redsys_resolution_note",
    "redsys_resolved_by_id",
    "redsys_resolved_date",
}


def redsys_bypass(env):
    """Solo código servidor con sudo: un contexto enviado por RPC no basta (D10)."""
    return bool(env.su and env.context.get("redsys_force_unlink"))


def _norm(value):
    return "" if value in (False, None) else value


class PosPayment(models.Model):
    _inherit = "pos.payment"

    redsys_rts = fields.Char(string="Redsys RTS identifier", copy=False)
    redsys_xml = fields.Text(string="Redsys raw XML", copy=False)
    redsys_state = fields.Selection(
        [
            ("authorized", "Authorized"),
            ("unknown", "Unknown"),
            ("refund", "Refund"),
            ("not_charged", "Reconciled: not charged"),
        ],
        string="Redsys state",
        copy=False,
        index="btree_not_null",
    )
    redsys_reference = fields.Char(string="Redsys reference", copy=False, index=True)
    redsys_original_pedido = fields.Char(
        string="Redsys original order",
        copy=False,
        index="btree_not_null",
        help="Redsys order number (pedido) of the original charge this refund "
        "belongs to. Lets the POS add up previous refunds against one charge.",
    )
    redsys_resolution_note = fields.Text(string="Reconciliation note", copy=False, readonly=True)
    redsys_resolved_by_id = fields.Many2one("res.users", string="Reconciled by", copy=False, readonly=True)
    redsys_resolved_date = fields.Datetime(string="Reconciled on", copy=False, readonly=True)

    def init(self):
        """QA2-17: unicidad también en BD (dos sincronizaciones concurrentes podrían pasar la búsqueda
        Python a la vez). Índices únicos PARCIALES: solo cobros `authorized` (las devoluciones comparten
        pedido/RTS con el cobro original y las líneas unknown aún no tienen identificadores)."""
        res = super().init()
        cr = self.env.cr
        for column in ("transaction_id", "redsys_rts"):
            name = f"pos_payment_redsys_{column}_authorized_uniq"
            try:
                with cr.savepoint():
                    cr.execute(
                        SQL(
                            "CREATE UNIQUE INDEX IF NOT EXISTS %(name)s ON pos_payment "
                            "(payment_method_id, %(column)s) "
                            "WHERE redsys_state = 'authorized' "
                            "AND %(column)s IS NOT NULL AND %(column)s <> ''",
                            name=SQL.identifier(name),
                            column=SQL.identifier(column),
                        )
                    )
            except Exception:  # noqa: BLE001
                # Datos previos duplicados: no impedir la actualización; queda la comprobación Python.
                # (Sin logging: política del módulo, ver test_qa_no_logging_or_print_in_python.)
                continue
        return res

    # ------------------------------------------------------------------ validación (QA-20)

    @staticmethod
    def _redsys_parse_xml(xml):
        """Devuelve {etiqueta_en_minúsculas: texto} del primer valor de cada
        etiqueta del XML de Redsys. Sirve para los dos formatos que guarda el
        cliente en `redsys_xml`: el de un cobro/devolución (`<Operaciones><resultadoOperacion>`)
        y el de una operación recuperada por consulta (`<operacion>` de
        `<resultadoConsulta>`, con `resultado` en MAYÚSCULAS y `firma` copiada de la
        consulta); en ambos están pedido, identificadorRTS, factura, importe, estado
        y resultado. Sin entidades ni red. Lanza ValueError si no es XML parseable."""
        if not (xml or "").strip():
            raise ValueError("empty")
        parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
        try:
            root = etree.fromstring(xml.strip().encode(), parser)
        except etree.XMLSyntaxError as err:
            raise ValueError(str(err)) from err
        values = {}
        for node in root.iter():
            if isinstance(node.tag, str) and node.text and node.text.strip():
                values.setdefault(node.tag.lower(), node.text.strip())
        return values

    def _redsys_xml_errors(self, xml):
        """Incoherencias entre la línea y el XML de Redsys ya parseado (lista de textos)."""
        self.ensure_one()
        errors = []
        if xml.get("estado") != "F" or (xml.get("resultado") or "").lower() != "autorizada":
            errors.append(_("the operation is not Authorized (state F)"))
        try:
            xml_amount = float((xml.get("importe") or "").replace(",", "."))
        except ValueError:
            xml_amount = None
        if xml_amount is None or float_compare(abs(self.amount), xml_amount, precision_digits=2):
            errors.append(_("the amount does not match the Redsys XML"))
        if not self.transaction_id or xml.get("pedido") != self.transaction_id:
            errors.append(_("the order number (pedido) does not match"))
        if not self.redsys_rts or xml.get("identificadorrts") != self.redsys_rts:
            errors.append(_("the RTS identifier does not match"))
        if self.redsys_reference and xml.get("factura") and xml["factura"] != self.redsys_reference:
            errors.append(_("the reference (factura) does not match"))
        method = self.payment_method_id.sudo()
        # QA-10 (servidor): la firma MOCK solo la genera el simulador.
        if (xml.get("firma") or "").upper().startswith("MOCK") and not method.redsys_simulation:
            errors.append(_("the signature is a simulator (MOCK) one but the method is not in simulation"))
        if xml.get("comercio") and xml["comercio"] != method.redsys_merchant_code:
            errors.append(_("the merchant does not match the payment method"))
        if xml.get("terminal") and xml["terminal"] != method.redsys_terminal_number:
            errors.append(_("the terminal does not match the payment method"))
        # QA2-06: el signo debe corresponder al estado (una devolución es negativa, un cobro positivo)
        if self.redsys_state == "refund" and self.amount >= 0:
            errors.append(_("a refund must have a negative amount"))
        if self.redsys_state == "authorized" and self.amount <= 0:
            errors.append(_("a charge must have a positive amount"))
        if self.redsys_state == "refund" and self.redsys_original_pedido and not errors:
            errors.extend(self._redsys_refund_errors())
        return errors

    def _redsys_validate_authorization(self):
        """Una línea authorized/refund exige un XML de Redsys coherente con la línea
        y pedido/RTS únicos (salvo devoluciones con redsys_original_pedido)."""
        for pay in self:
            if pay.redsys_state not in REDSYS_CONFIRMED_STATES:
                continue
            ref = pay.redsys_reference or pay.transaction_id or "-"
            try:
                xml = self._redsys_parse_xml(pay.redsys_xml)
            except ValueError:
                raise ValidationError(_("Redsys payment %s has no valid Redsys XML.", ref)) from None
            errors = pay._redsys_xml_errors(xml)
            if errors:
                raise ValidationError(
                    _(
                        "Redsys payment %(ref)s rejected: %(errors)s.",
                        ref=ref,
                        errors="; ".join(errors),
                    )
                )
            if pay.redsys_state == "refund" and pay.redsys_original_pedido:
                continue  # una devolución puede compartir pedido/RTS con el cobro
            duplicate = (
                self.sudo()
                .with_context(active_test=False)
                .search(
                    [
                        ("id", "!=", pay.id),
                        ("payment_method_id", "=", pay.payment_method_id.id),
                        ("redsys_state", "in", ("authorized", "refund")),
                        # las devoluciones con pedido original pueden compartir ids
                        "|",
                        ("redsys_state", "=", "authorized"),
                        ("redsys_original_pedido", "in", (False, "")),
                        "|",
                        ("transaction_id", "=", pay.transaction_id),
                        ("redsys_rts", "=", pay.redsys_rts),
                    ],
                    limit=1,
                )
            )
            if duplicate:
                raise ValidationError(
                    _(
                        "Redsys order %(pedido)s / RTS %(rts)s is already registered in another payment.",
                        pedido=pay.transaction_id,
                        rts=pay.redsys_rts,
                    )
                )

    @staticmethod
    def _redsys_integrity_error(err):
        """QA2-17: el índice único de BD rechazó un duplicado concurrente: mismo mensaje que la comprobación
        Python; cualquier otra violación de integridad se propaga tal cual."""
        if "pos_payment_redsys_" in str(err):
            return ValidationError(_("Redsys order / RTS is already registered in another payment."))
        return err

    def _redsys_refund_errors(self):
        """QA2-06: una devolución con `redsys_original_pedido` debe colgar de un cobro `authorized` del
        mismo método con ese pedido, no repetir otra devolución ya registrada (misma referencia o mismos
        pedido+RTS sin referencias distintas) y no superar, junto con las anteriores, el importe cobrado."""
        self.ensure_one()
        errors = []
        method = self.payment_method_id
        Payment = self.sudo().with_context(active_test=False)
        original = Payment.search(
            [
                ("id", "!=", self.id),
                ("payment_method_id", "=", method.id),
                ("redsys_state", "=", "authorized"),
                ("transaction_id", "=", self.redsys_original_pedido),
            ],
            limit=1,
        )
        if not original:
            return [
                _(
                    "the original charge %s is not registered",
                    self.redsys_original_pedido,
                )
            ]
        others = Payment.search(
            [
                ("id", "!=", self.id),
                ("payment_method_id", "=", method.id),
                ("redsys_state", "=", "refund"),
                ("redsys_original_pedido", "=", self.redsys_original_pedido),
            ]
        )
        for other in others:
            same_ref = (
                other.redsys_reference and self.redsys_reference and other.redsys_reference == self.redsys_reference
            )
            no_refs = not (other.redsys_reference and self.redsys_reference)
            same_ids = other.transaction_id == self.transaction_id and other.redsys_rts == self.redsys_rts
            if same_ref or (no_refs and same_ids):
                errors.append(_("this refund is already registered in another payment"))
                break
        refunded = sum(abs(o.amount) for o in others)
        if float_compare(refunded + abs(self.amount), original.amount, precision_digits=2) > 0:
            errors.append(
                _(
                    "the refunds exceed the original charge (%(orig)s)",
                    orig=original.amount,
                )
            )
        return errors

    def _redsys_check_terminal_flow(self):
        """R3-01: un cobro de un método Redsys solo puede venir del flujo del datáfono (el POS le da un
        `redsys_state`). Sin él y dado por bueno (`done` o sin estado de pago) significaría una tarjeta
        registrada sin cobro (p. ej. desde el popup/wizard de pago de `pos_conventional_payment_wizard`).
        Las líneas en curso o denegadas del POS (`pending/waiting*/retry`) siguen sincronizándose; un método
        en simulación queda fuera."""
        for pay in self:
            method = pay.payment_method_id.sudo()
            if (
                method.use_payment_terminal == "redsys_tpvpc"
                and not method.redsys_simulation
                and not pay.redsys_state
                and pay.payment_status in (False, "", "done")
            ):
                raise UserError(
                    _(
                        "Payments with the Redsys method '%(method)s' can only be registered through the "
                        "card terminal from the Point of Sale. Use the POS to charge the card, or choose "
                        "another payment method.",
                        method=method.name,
                    )
                )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if REDSYS_RESOLUTION_FIELDS & vals.keys() and not self.env.su:
                raise UserError(_("Reconciliation data can only be set by the reconcile action."))
        if not self.env.su and any(v.get("redsys_state") == "not_charged" for v in vals_list):
            raise UserError(_("Use the reconcile action to resolve unknown payments."))
        try:
            with self.env.cr.savepoint():
                records = super().create(vals_list)
        except IntegrityError as err:
            raise self._redsys_integrity_error(err) from err
        if not redsys_bypass(self.env):
            records._redsys_check_terminal_flow()
        records.filtered(lambda p: p.redsys_state in REDSYS_CONFIRMED_STATES)._redsys_validate_authorization()
        return records

    # ------------------------------------------------------------------ protección (D10)

    def _redsys_bypass(self):
        return redsys_bypass(self.env)

    @staticmethod
    def _redsys_removable(pay):
        """QA2-04/05: una línea `not_charged` (conciliada o liberada con auditoría: NO hubo cargo) puede
        eliminarse mientras su pedido siga en borrador (aún no hay contabilidad). En un pedido ya pagado
        se queda: borrarla desbarataría el pedido (ver DECISIONS, QA2-05)."""
        return pay.redsys_state == "not_charged" and pay.pos_order_id.state == "draft"

    def unlink(self):
        # Decisión de diseño D6/D10: el borrado de un cobro con tarjeta se rechaza con UserError.
        if not self._redsys_bypass():
            locked = self.filtered(
                lambda p: p.redsys_state in REDSYS_PROTECTED_STATES and not self._redsys_removable(p)
            )
            for pay in self - locked:
                if pay.redsys_state == "not_charged":
                    pay.pos_order_id.sudo().message_post(
                        body=_(
                            "Redsys payment %(ref)s (reconciled: not charged) removed from the draft order.",
                            ref=pay.redsys_reference or "-",
                        )
                    )
            if locked:
                raise UserError(  # pylint: disable=no-raise-unlink
                    _(
                        "Card payments confirmed through Redsys cannot be deleted "
                        "(reference: %s). Refund them from the terminal instead.",
                        ", ".join(locked.mapped(lambda p: p.redsys_reference or "-")),
                    )
                )
        return super().unlink()

    def _redsys_value_equals(self, pay, key, new):
        field = pay._fields[key]
        current = pay[key]
        if field.type == "many2one":
            return (current.id or False) == (new or False)
        if field.type == "float":
            return not float_compare(current, new or 0.0, precision_digits=4)
        return _norm(current) == _norm(new)

    def _redsys_changed_locked(self, vals):
        """Devuelve (conjunto de campos con cambio real prohibido, hay_cambio_real)
        para las líneas protegidas. Reenviar los mismos valores es idempotente (QA-19)."""
        forbidden = set()
        changed = False
        for pay in self.filtered(lambda p: p.redsys_state in REDSYS_PROTECTED_STATES):
            for key in REDSYS_LOCKED_FIELDS & vals.keys():
                if self._redsys_value_equals(pay, key, vals[key]):
                    continue
                changed = True
                if not (pay.redsys_state == "unknown" and key in REDSYS_FILLABLE_FROM_UNKNOWN and not _norm(pay[key])):
                    forbidden.add(key)
            if "redsys_state" in vals and not self._redsys_value_equals(pay, "redsys_state", vals["redsys_state"]):
                changed = True
                # única transición permitida: unknown -> otro estado
                if pay.redsys_state != "unknown":
                    forbidden.add("redsys_state")
        return forbidden, changed

    def write(self, vals):
        if self._redsys_bypass():
            return super().write(vals)
        if vals.get("redsys_state") == "unknown":
            # QA2-09: copia obsoleta del POS (la línea ya la resolvió un manager o un reenvío anterior): el
            # reenvío de `unknown` es un no-op para los campos Redsys; el resto de campos de UI sí se guardan.
            stale = self.filtered(lambda p: p.redsys_state in ("authorized", "refund", "not_charged"))
            if stale:
                ignored = REDSYS_LOCKED_FIELDS | {"redsys_state", "payment_status"}
                clean = {k: v for k, v in vals.items() if k not in ignored}
                if clean:
                    stale.write(clean)
                rest = self - stale
                return rest.write(vals) if rest else True
        if REDSYS_RESOLUTION_FIELDS & vals.keys() and not self.env.su:
            raise UserError(_("Reconciliation data can only be set by the reconcile action."))
        if vals.get("redsys_state") == "not_charged" and not self.env.su:
            raise UserError(_("Use the reconcile action to resolve unknown payments."))
        forbidden, changed = self._redsys_changed_locked(vals)
        if forbidden:
            raise UserError(
                _(
                    "Payments confirmed through Redsys cannot be modified (%s).",
                    ", ".join(sorted(forbidden)),
                )
            )
        try:
            with self.env.cr.savepoint():
                result = super().write(vals)
        except IntegrityError as err:
            raise self._redsys_integrity_error(err) from err
        if {"payment_method_id", "redsys_state", "payment_status"} & vals.keys():
            self._redsys_check_terminal_flow()
        if changed:
            self.filtered(lambda p: p.redsys_state in REDSYS_CONFIRMED_STATES)._redsys_validate_authorization()
        return result

    def redsys_release_unknown(self):
        """QA2-04: liberación por el CAJERO de una línea `unknown` ya sincronizada (el POS no puede
        modificarla ni borrarla, D10). Solo si el pedido sigue en borrador y la línea NO tiene ningún
        rastro de Redsys (ni pedido, ni RTS, ni XML): las dudosas con XML (importe distinto, varias
        autorizadas) las concilia un manager. Queda `not_charged` auditada (usuario, fecha, nota) y se
        anota en el pedido; el POS la borra después y el cajero añade un pago nuevo."""
        if not self.env.user.has_group("point_of_sale.group_pos_user"):
            raise AccessError(_("Only Point of Sale users can release payments."))
        if not self:
            raise UserError(_("No payment to release."))
        self.check_access("write")
        user = self.env.user
        for pay in self.sudo():
            if pay.redsys_state != "unknown":
                raise UserError(_("Only payments in Redsys state 'Unknown' can be released."))
            if pay.pos_order_id.state != "draft":
                raise UserError(_("The order is already paid: ask a manager to reconcile the payment."))
            if pay.transaction_id or pay.redsys_rts or (pay.redsys_xml or "").strip():
                raise UserError(
                    _(
                        "This payment has Redsys data (order/RTS/XML): ask a manager to reconcile it "
                        "against the Redsys portal."
                    )
                )
            note = _("Released by the cashier from the POS after checking that no charge exists.")
            super(PosPayment, pay).write(
                {
                    "redsys_state": "not_charged",
                    "redsys_resolution_note": note,
                    "redsys_resolved_by_id": user.id,
                    "redsys_resolved_date": fields.Datetime.now(),
                }
            )
            pay.pos_order_id.message_post(
                body=_(
                    "Redsys payment %(ref)s released by %(user)s (no charge).",
                    ref=pay.redsys_reference or "-",
                    user=user.name,
                )
            )
        return True

    # ------------------------------------------------------------------ conciliación (QA-21)

    def redsys_reconcile(self, resolution, note):
        """Resuelve líneas 'unknown' (solo group_pos_manager).

        resolution: 'charged' -> authorized / refund (según el signo del importe),
        'not_charged' -> not_charged. Exige nota y deja usuario y fecha. No pasa
        por la validación de XML (la conciliación se hace contra el portal de
        Redsys); el estado inicial 'unknown' es la única transición permitida.
        """
        if not self.env.user.has_group("point_of_sale.group_pos_manager"):
            raise AccessError(_("Only Point of Sale managers can reconcile payments."))
        if resolution not in ("charged", "not_charged"):
            raise UserError(_("Unknown resolution."))
        note = (note or "").strip()
        if not note:
            raise UserError(_("A reconciliation note is required."))
        wrong = self.filtered(lambda p: p.redsys_state != "unknown")
        if wrong or not self:
            raise UserError(_("Only payments in Redsys state 'Unknown' can be reconciled."))
        for pay in self:
            if resolution == "charged":
                state = "refund" if pay.amount < 0 else "authorized"
            else:
                state = "not_charged"
            # write del ORM base: salta el control D10 (solo esta vía puede hacerlo)
            try:
                with self.env.cr.savepoint():
                    super(PosPayment, pay).write(
                        {
                            "redsys_state": state,
                            "redsys_resolution_note": note,
                            "redsys_resolved_by_id": self.env.user.id,
                            "redsys_resolved_date": fields.Datetime.now(),
                        }
                    )
                    self.env.flush_all()
            except IntegrityError as err:
                # R3-05: índice único de BD (mismo pedido/RTS ya autorizado): error legible
                raise self._redsys_integrity_error(err) from err
            pay.pos_order_id.sudo().message_post(
                body=_(
                    "Redsys payment %(ref)s reconciled as %(state)s by %(user)s: %(note)s",
                    ref=pay.redsys_reference or "-",
                    state=state,
                    user=self.env.user.name,
                    note=note,
                )
            )
        return True
