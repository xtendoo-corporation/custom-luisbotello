"""QA independiente (backend). Ver docs/qa_report.md.

Convención: los tests `test_qa_known_issue_*` DOCUMENTAN un hallazgo abierto afirmando el
comportamiento ACTUAL (inseguro o incorrecto). Cuando se corrija el hallazgo el test fallará a
propósito: entonces hay que invertir la aserción (el docstring indica el comportamiento deseado).
El resto son comprobaciones de seguridad que hoy se cumplen y deben seguir cumpliéndose.
"""
import json
import re
from pathlib import Path

from odoo import Command
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged
from odoo.addons.point_of_sale.tests.common import TestPoSCommon

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

    def _payment(self, state="authorized", amount=10.0, xml="<xml/>", **extra):
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
            "redsys_xml": xml,
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

    def test_qa_known_issue_key_readable_by_any_pos_user(self):
        """QA-16 (ALTO). DESEADO: solo group_pos_manager lee el campo (el RPC usa sudo y no lo necesita).

        Hoy `groups='point_of_sale.group_pos_user'`: cualquier cajero lee la clave de TODOS los
        métodos Redsys de la compañía con un search_read/read normal, sin pasar por el RPC.
        """
        rows = self.env["pos.payment.method"].with_user(self.cashier).search_read(
            [("id", "=", self.method.id)], ["redsys_signature_key"]
        )
        self.assertEqual(rows[0]["redsys_signature_key"], KEY)

    def test_qa_known_issue_key_rpc_ignores_which_config_is_open(self):
        """QA-17 (MEDIO). DESEADO: solo la config de la sesión abierta por el usuario (o `config.user_ids`).

        `redsys_get_signature_key(config_id)` acepta CUALQUIER config legible: un cajero de la
        caja A obtiene la clave del terminal Redsys de la caja B.
        """
        other_method = self._method("2", merchant="444444444", key="OTHER-CASH-DESK-KEY")
        other = self.env["pos.config"].create(
            {"name": "Otra caja", "payment_method_ids": [(4, other_method.id)]}
        )
        keys = self.env["pos.payment.method"].with_user(self.cashier).redsys_get_signature_key(other.id)
        self.assertEqual(keys, {other_method.id: "OTHER-CASH-DESK-KEY"})

    def test_qa_known_issue_resync_with_same_values_is_blocked(self):
        """QA-19 (ALTO). DESEADO: reenviar la línea con los MISMOS valores no debe fallar.

        El POS serializa una línea sincronizada y 'dirty' como [1, id, <todos los campos>]
        (serialization.js: toUpdate + recursiveSerialize) y `_process_order` hace
        `pos_order.write({'payment_ids': [...]})`. D10 prohíbe cualquier clave de
        REDSYS_LOCKED_FIELDS en `vals` aunque el valor no cambie => UserError y el pedido no
        se puede sincronizar/cerrar (p. ej. 'unknown' resuelto tras una recarga con el pedido
        ya guardado en servidor, o cualquier cambio posterior de la línea).
        """
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
            "card_brand": "MASTERCARD",
        }
        with self.assertRaises(UserError):
            payment.pos_order_id.write({"payment_ids": [Command.update(payment.id, vals)]})
        # un cambio realmente inocuo sí pasa
        payment.write({"card_brand": "MASTERCARD"})

    def test_qa_known_issue_unknown_can_be_cleared_and_deleted(self):
        """QA-18 (BAJO). DESEADO: unknown solo transiciona a authorized/refund (nunca a False) sin conciliación.

        D10 permite unknown -> False; después la línea (posiblemente cobrada) se puede borrar sin
        dejar rastro. El cliente lo hace legítimamente con 'not_charged', pero el servidor no lo exige.
        """
        payment = self._payment("unknown")
        payment.write({"redsys_state": False})
        payment.unlink()
        self.assertFalse(payment.exists())

    def test_qa_known_issue_server_does_not_validate_authorization_against_line(self):
        """QA-20 (ALTO). DESEADO (plan §7.5): create/write rechazan authorized/refund si el XML guardado no
        corresponde a la línea (importe, factura, pedido, RTS, comercio/terminal del método, estado F + Autorizada).

        Hoy un pos_user puede registrar un 'cobro con tarjeta' de 10 EUR con XML vacío o de 0,01 EUR,
        o duplicar el mismo pedido/RTS en dos pedidos distintos.
        """
        liar = self._payment("authorized", amount=500.0, xml="<Operaciones><resultadoOperacion><importe>0.01</importe>"
                             "<estado>T</estado><resultado>Denegada</resultado></resultadoOperacion></Operaciones>")
        self.assertEqual(liar.amount, 500.0)
        self.assertEqual(liar.redsys_state, "authorized")
        twin = self._payment("authorized", amount=500.0, xml="")
        self.assertEqual((twin.transaction_id, twin.redsys_rts), (liar.transaction_id, liar.redsys_rts))

    def test_qa_known_issue_no_view_to_reconcile_unknown_payments(self):
        """QA-21 (MEDIO). DESEADO: filtro/menú de pos.payment con redsys_state = 'unknown' para conciliar.

        DECISIONS.md I4 promete que la línea 'queda marcada para conciliación', pero no existe
        ninguna vista/acción/filtro que las liste: solo el módulo `views/pos_payment_method_views.xml`.
        """
        actions = self.env["ir.ui.view"].search([("model", "=", "pos.payment"), ("arch_db", "ilike", "redsys_state")])
        self.assertFalse(actions)
