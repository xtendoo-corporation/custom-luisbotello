"""QA independiente (backend). Ver docs/qa_report.md.

Convención: los tests `test_qa_*` DOCUMENTAN un hallazgo abierto afirmando el
comportamiento ACTUAL (inseguro o incorrecto). Cuando se corrija el hallazgo el test fallará a
propósito: entonces hay que invertir la aserción (el docstring indica el comportamiento deseado).
El resto son comprobaciones de seguridad que hoy se cumplen y deben seguir cumpliéndose.
"""
import json
import re
from pathlib import Path

from odoo import Command
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged
from odoo.addons.point_of_sale.tests.common import TestPoSCommon

from .redsys_xml import redsys_xml

KEY = "QA-SECRET-KEY-9f8e7d6c"
MODULE = Path(__file__).resolve().parent.parent


@tagged("post_install", "-at_install")
class TestRedsysQA(TestPoSCommon):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.config = cls.basic_config
        cls.method = cls._method("1")
        cls.config.write({"payment_method_ids": [(4, cls.method.id)]})
        group_user = cls.env.ref("point_of_sale.group_pos_user")
        group_manager = cls.env.ref("point_of_sale.group_pos_manager")
        cls.cashier = cls.env["res.users"].create(
            {"name": "QA cashier", "login": "qa_cashier", "group_ids": [(6, 0, [group_user.id])]}
        )
        cls.manager = cls.env["res.users"].create(
            {"name": "QA manager", "login": "qa_manager", "group_ids": [(6, 0, [group_manager.id])]}
        )

    @classmethod
    def _method(cls, terminal, merchant="123456789", key=KEY):
        return cls.env["pos.payment.method"].create(
            {
                "name": f"QA Redsys {merchant}/{terminal}",
                "payment_method_type": "terminal",
                "use_payment_terminal": "redsys_tpvpc",
                "redsys_merchant_code": merchant,
                "redsys_terminal_number": terminal,
                "redsys_signature_key": key,
            }
        )

    def _payment(self, state="authorized", amount=10.0, xml=None, **extra):
        self.open_new_session()
        order = self.env["pos.order"].create(
            {
                "session_id": self.pos_session.id,
                "config_id": self.config.id,
                "lines": [],
                "amount_tax": 0,
                "amount_total": amount,
                "amount_paid": 0,
                "amount_return": 0,
            }
        )
        vals = {
            "pos_order_id": order.id,
            "payment_method_id": self.method.id,
            "amount": amount,
            "transaction_id": "123456789012",
            "payment_ref_no": "ODOO-ABCD1234",
            "redsys_state": state,
            "redsys_reference": "ODOO-ABCD1234",
            "redsys_rts": "070001070319153828378272",
            "redsys_xml": xml if xml is not None else redsys_xml(amount),
        }
        vals.update(extra)
        return self.env["pos.payment"].create(vals)

    # ------------------------------------------------------------------ secretos (OK hoy)

    def test_qa_key_absent_from_full_pos_payload(self):
        """La clave de firma no viaja en la carga completa del POS (load_data)."""
        self.open_new_session()
        data = self.pos_session.with_user(self.cashier).load_data([])
        blob = json.dumps(data, default=str)
        self.assertNotIn(KEY, blob)
        self.assertNotIn("redsys_signature_key", blob)
        self.assertIn("redsys_merchant_code", blob)

    def test_qa_key_not_in_view_as_plain_and_is_password_widget(self):
        view = self.env.ref("luis_botello_pos_redsys_tpvpc.pos_payment_method_view_form_inherit_redsys_tpvpc")
        self.assertRegex(view.arch_db, r'redsys_signature_key"[^>]*password="True"')

    def test_qa_no_logging_or_print_in_python(self):
        for f in (MODULE / "models").glob("*.py"):
            text = f.read_text()
            self.assertNotRegex(text, r"\b(print|_logger\.\w+)\(", f.name)

    def test_qa_simulation_flag_requires_manager_on_create_and_write(self):
        Method = self.env["pos.payment.method"]
        vals = {
            "name": "QA sim",
            "payment_method_type": "terminal",
            "use_payment_terminal": "redsys_tpvpc",
            "redsys_merchant_code": "555555555",
            "redsys_terminal_number": "1",
            "redsys_simulation": True,
        }
        with self.assertRaises(AccessError):
            Method.with_user(self.cashier).create(vals)
        created = Method.with_user(self.manager).create(vals)
        self.assertTrue(created.redsys_simulation)
        self.assertFalse(created.copy({"name": "copia"}).redsys_simulation, "copy=False")
        with self.assertRaises(AccessError):
            created.with_user(self.cashier).write({"redsys_simulation": False})

    def test_qa_signature_rpc_without_key_or_unknown_config(self):
        method = self._method("7", merchant="222222222", key=False)
        self.config.write({"payment_method_ids": [(4, method.id)]})
        self.open_new_session()
        self.pos_session.user_id = self.cashier
        keys = self.env["pos.payment.method"].with_user(self.cashier).redsys_get_signature_key(self.config.id)
        self.assertEqual(keys[method.id], "")
        self.assertEqual(
            self.env["pos.payment.method"].with_user(self.cashier).redsys_get_signature_key(999999), {}
        )

    def test_qa_unique_merchant_terminal_includes_archived(self):
        dup = self._method("9", merchant="333333333")
        dup.active = False
        with self.assertRaises(Exception):
            self._method("9", merchant="333333333")

    # ------------------------------------------------------- hallazgos abiertos (documentados)

    def test_qa_16_key_not_readable_by_cashier_but_rpc_works(self):
        """QA-16: el campo solo lo lee group_pos_manager; el RPC (sudo) sigue entregándola."""
        Method = self.env["pos.payment.method"]
        with self.assertRaises(AccessError):
            Method.with_user(self.cashier).search_read(
                [("id", "=", self.method.id)], ["redsys_signature_key"]
            )
        rows = Method.with_user(self.manager).search_read(
            [("id", "=", self.method.id)], ["redsys_signature_key"]
        )
        self.assertEqual(rows[0]["redsys_signature_key"], KEY)
        self.open_new_session()
        self.pos_session.user_id = self.cashier
        keys = Method.with_user(self.cashier).redsys_get_signature_key(self.config.id)
        self.assertEqual(keys, {self.method.id: KEY})

    def test_qa_17_key_rpc_only_own_open_session(self):
        """QA-17: sin sesión abierta del usuario en esa config no se entrega la clave."""
        other_method = self._method("2", merchant="444444444", key="OTHER-CASH-DESK-KEY")
        other = self.env["pos.config"].create(
            {"name": "Otra caja", "payment_method_ids": [(4, other_method.id)]}
        )
        Method = self.env["pos.payment.method"].with_user(self.cashier)
        with self.assertRaises(AccessError):  # config sin sesión abierta
            Method.redsys_get_signature_key(other.id)
        self.open_new_session()  # sesión de self.config, abierta por otro usuario
        with self.assertRaises(AccessError):
            Method.redsys_get_signature_key(self.config.id)
        with self.assertRaises(AccessError):  # y la otra caja sigue vetada
            Method.redsys_get_signature_key(other.id)

    def test_qa_19_resync_with_same_values_is_idempotent(self):
        """QA-19: reenviar [1, id, todos los campos] con los mismos valores no falla; un cambio real sí."""
        payment = self._payment("authorized")
        vals = {
            "amount": payment.amount,
            "payment_method_id": payment.payment_method_id.id,
            "pos_order_id": payment.pos_order_id.id,
            "transaction_id": payment.transaction_id,
            "payment_ref_no": payment.payment_ref_no,
            "redsys_rts": payment.redsys_rts,
            "redsys_xml": payment.redsys_xml,
            "redsys_reference": payment.redsys_reference,
            "redsys_state": "authorized",
            "redsys_original_pedido": False,
            "card_brand": "MASTERCARD",
        }
        payment.pos_order_id.write({"payment_ids": [Command.update(payment.id, vals)]})
        self.assertEqual(payment.card_brand, "MASTERCARD")
        for key, bad in (("amount", 5.0), ("transaction_id", "999"), ("redsys_state", False)):
            with self.assertRaises(UserError, msg=key):
                payment.write({**vals, key: bad})

    def test_qa_19_unknown_can_be_completed_from_empty_fields(self):
        """Una línea unknown (sin pedido/RTS/XML) se completa al resolverla; lo ya escrito no cambia."""
        payment = self._payment(
            "unknown", transaction_id=False, redsys_rts=False, redsys_xml=False
        )
        payment.write(
            {
                "redsys_state": "authorized",
                "transaction_id": "123456789012",
                "redsys_rts": "070001070319153828378272",
                "redsys_xml": redsys_xml(10.0),
            }
        )
        self.assertEqual(payment.redsys_state, "authorized")

    def test_qa_18_unknown_can_be_cleared_and_deleted(self):
        """QA-18 (BAJO, ABIERTO a propósito): unknown -> False sigue permitido porque el
        cliente lo usa con 'not_charged'. La conciliación auditada es la vía recomendada."""
        payment = self._payment("unknown")
        payment.write({"redsys_state": False})
        payment.unlink()
        self.assertFalse(payment.exists())

    def test_qa_20_server_validates_authorization_against_line(self):
        """QA-20: authorized/refund exigen XML coherente; unknown no lo exige; unicidad pedido/RTS."""
        bad_xmls = {
            "empty": "",
            "garbage": "<xml/",
            "denied": redsys_xml(500.0, estado="T", resultado="Denegada"),
            "denied_f": redsys_xml(500.0, resultado="Denegada"),
            "amount": redsys_xml(0.01),
            "pedido": redsys_xml(500.0, pedido="999"),
            "rts": redsys_xml(500.0, rts="OTHER"),
            "merchant": redsys_xml(500.0, comercio="000000000"),
            "terminal": redsys_xml(500.0, terminal="9"),
            "factura": redsys_xml(500.0, factura="OTRA"),
        }
        for name, xml in bad_xmls.items():
            with self.subTest(name), self.assertRaises(ValidationError):
                self._payment("authorized", amount=500.0, xml=xml)
        # unknown sin XML: permitido
        self._payment("unknown", amount=500.0, xml=False)
        good = self._payment("authorized", amount=500.0)
        self.assertEqual(good.redsys_state, "authorized")
        # mismo pedido/RTS en otro pedido POS: rechazado
        with self.assertRaises(ValidationError):
            self._payment("authorized", amount=500.0)
        # promover un unknown con XML falso también se valida
        unk = self._payment("unknown", amount=20.0, transaction_id="777", redsys_rts="R7", xml="")
        with self.assertRaises(ValidationError):
            unk.write({"redsys_state": "authorized"})

    def test_qa_20_refund_with_original_pedido_may_share_ids(self):
        charge = self._payment("authorized", amount=50.0)
        refund = self._payment(
            "refund",
            amount=-20.0,
            xml=redsys_xml(-20.0),
            redsys_original_pedido=charge.transaction_id,
        )
        self.assertEqual(refund.redsys_state, "refund")
        with self.assertRaises(ValidationError):  # sin original: no se admite duplicado
            self._payment("refund", amount=-20.0, xml=redsys_xml(-20.0))

    def test_qa_21_view_to_reconcile_unknown_payments(self):
        """QA-21: filtro/acción/menú para líneas unknown y conciliación auditada solo para managers."""
        action = self.env.ref("luis_botello_pos_redsys_tpvpc.action_pos_payment_redsys_unknown")
        self.assertIn("redsys_unknown", action.context)
        unknown = self._payment("unknown", xml=False)
        found = self.env["pos.payment"].search([("redsys_state", "=", "unknown")])
        self.assertIn(unknown, found)
        with self.assertRaises(AccessError):
            unknown.with_user(self.cashier).redsys_reconcile("charged", "intento")
        unknown.with_user(self.manager).redsys_reconcile("not_charged", "Sin cargo en portal")
        self.assertEqual(unknown.redsys_state, "not_charged")
        self.assertEqual(unknown.redsys_resolved_by_id, self.manager)
        self.assertNotIn(unknown, self.env["pos.payment"].search([("redsys_state", "=", "unknown")]))
