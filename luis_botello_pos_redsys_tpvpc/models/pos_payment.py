from lxml import etree

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import float_compare

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
    redsys_resolution_note = fields.Text(
        string="Reconciliation note", copy=False, readonly=True
    )
    redsys_resolved_by_id = fields.Many2one(
        "res.users", string="Reconciled by", copy=False, readonly=True
    )
    redsys_resolved_date = fields.Datetime(
        string="Reconciled on", copy=False, readonly=True
    )

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
        parser = etree.XMLParser(
            resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False
        )
        try:
            root = etree.fromstring(xml.strip().encode(), parser)
        except etree.XMLSyntaxError as err:
            raise ValueError(str(err)) from err
        values = {}
        for node in root.iter():
            if isinstance(node.tag, str) and node.text and node.text.strip():
                values.setdefault(node.tag.lower(), node.text.strip())
        return values

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
                raise ValidationError(
                    _("Redsys payment %s has no valid Redsys XML.", ref)
                ) from None
            errors = []
            if xml.get("estado") != "F" or (xml.get("resultado") or "").lower() != (
                "autorizada"
            ):
                errors.append(_("the operation is not Authorized (state F)"))
            try:
                xml_amount = float((xml.get("importe") or "").replace(",", "."))
            except ValueError:
                xml_amount = None
            if xml_amount is None or float_compare(
                abs(pay.amount), xml_amount, precision_digits=2
            ):
                errors.append(_("the amount does not match the Redsys XML"))
            if not pay.transaction_id or xml.get("pedido") != pay.transaction_id:
                errors.append(_("the order number (pedido) does not match"))
            if not pay.redsys_rts or xml.get("identificadorrts") != pay.redsys_rts:
                errors.append(_("the RTS identifier does not match"))
            if (
                pay.redsys_reference
                and xml.get("factura")
                and xml["factura"] != pay.redsys_reference
            ):
                errors.append(_("the reference (factura) does not match"))
            method = pay.payment_method_id
            # QA-10 (servidor): la firma MOCK solo la genera el simulador.
            if (xml.get("firma") or "").upper().startswith("MOCK") and not (
                method.sudo().redsys_simulation
            ):
                errors.append(
                    _("the signature is a simulator (MOCK) one but the method is not in simulation")
                )
            if xml.get("comercio") and xml["comercio"] != method.sudo().redsys_merchant_code:
                errors.append(_("the merchant does not match the payment method"))
            if xml.get("terminal") and xml["terminal"] != method.sudo().redsys_terminal_number:
                errors.append(_("the terminal does not match the payment method"))
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
                        ("payment_method_id", "=", method.id),
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
                        "Redsys order %(pedido)s / RTS %(rts)s is already registered "
                        "in another payment.",
                        pedido=pay.transaction_id,
                        rts=pay.redsys_rts,
                    )
                )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if REDSYS_RESOLUTION_FIELDS & vals.keys() and not self.env.su:
                raise UserError(
                    _("Reconciliation data can only be set by the reconcile action.")
                )
        if not self.env.su and any(
            v.get("redsys_state") == "not_charged" for v in vals_list
        ):
            raise UserError(_("Use the reconcile action to resolve unknown payments."))
        records = super().create(vals_list)
        records.filtered(
            lambda p: p.redsys_state in REDSYS_CONFIRMED_STATES
        )._redsys_validate_authorization()
        return records

    # ------------------------------------------------------------------ protección (D10)

    def _redsys_bypass(self):
        # Solo código servidor con sudo: un contexto enviado por RPC no basta.
        return self.env.su and self.env.context.get("redsys_force_unlink")

    def unlink(self):
        if not self._redsys_bypass():
            locked = self.filtered(lambda p: p.redsys_state in REDSYS_PROTECTED_STATES)
            if locked:
                raise UserError(
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
                if not (
                    pay.redsys_state == "unknown"
                    and key in REDSYS_FILLABLE_FROM_UNKNOWN
                    and not _norm(pay[key])
                ):
                    forbidden.add(key)
            if "redsys_state" in vals and not self._redsys_value_equals(
                pay, "redsys_state", vals["redsys_state"]
            ):
                changed = True
                # única transición permitida: unknown -> otro estado
                if pay.redsys_state != "unknown":
                    forbidden.add("redsys_state")
        return forbidden, changed

    def write(self, vals):
        if self._redsys_bypass():
            return super().write(vals)
        if REDSYS_RESOLUTION_FIELDS & vals.keys() and not self.env.su:
            raise UserError(
                _("Reconciliation data can only be set by the reconcile action.")
            )
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
        result = super().write(vals)
        if changed:
            self.filtered(
                lambda p: p.redsys_state in REDSYS_CONFIRMED_STATES
            )._redsys_validate_authorization()
        return result

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
            super(PosPayment, pay).write(
                {
                    "redsys_state": state,
                    "redsys_resolution_note": note,
                    "redsys_resolved_by_id": self.env.user.id,
                    "redsys_resolved_date": fields.Datetime.now(),
                }
            )
        return True
