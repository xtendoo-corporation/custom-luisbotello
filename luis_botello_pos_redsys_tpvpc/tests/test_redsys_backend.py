from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged

from odoo.addons.point_of_sale.tests.common import TestPoSCommon

from .redsys_xml import redsys_xml


@tagged("post_install", "-at_install")
class TestRedsysBackend(TestPoSCommon):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.config = cls.basic_config
        cls.method = cls._create_method("1")
        cls.config.write({"payment_method_ids": [(4, cls.method.id)]})
        cls.pos_user = cls.env["res.users"].create(
            {
                "name": "Redsys POS user",
                "login": "redsys_pos_user",
                "group_ids": [(6, 0, [cls.env.ref("point_of_sale.group_pos_user").id])],
            }
        )
        cls.pos_manager = cls.env["res.users"].create(
            {
                "name": "Redsys POS manager",
                "login": "redsys_pos_manager",
                "group_ids": [(6, 0, [cls.env.ref("point_of_sale.group_pos_manager").id])],
            }
        )

    @classmethod
    def _create_method(cls, terminal, merchant="123456789"):
        return cls.env["pos.payment.method"].create(
            {
                "name": f"Redsys {terminal}",
                "payment_method_type": "terminal",
                "use_payment_terminal": "redsys_tpvpc",
                "redsys_merchant_code": merchant,
                "redsys_terminal_number": terminal,
                "redsys_signature_key": "SECRET-KEY",
            }
        )

    def test_selection_and_defaults(self):
        self.assertIn(
            "redsys_tpvpc",
            [v for v, _l in self.method._get_payment_terminal_selection()],
        )
        self.assertEqual(self.method.redsys_protocol_version, "8.1")
        self.assertEqual(self.method.redsys_transport, "js")
        self.assertFalse(self.method.redsys_simulation)

    def test_key_not_copied(self):
        self.assertFalse(self.method.copy({"name": "copy"}).sudo().redsys_signature_key)

    def test_unique_merchant_terminal(self):
        with self.assertRaises(ValidationError):
            self._create_method("1")
        self._create_method("2")  # otro terminal: ok
        self._create_method("1", merchant="987654321")  # otro comercio: ok

    def test_terminal_type(self):
        # el core fuerza payment_method_type y limpia el terminal si deja de serlo
        self.assertEqual(self.method.payment_method_type, "terminal")
        self.method.payment_method_type = "none"
        self.assertFalse(self.method.use_payment_terminal)

    def test_pos_data_does_not_expose_key(self):
        fields_ = self.env["pos.payment.method"]._load_pos_data_fields(self.config)
        self.assertNotIn("redsys_signature_key", fields_)
        self.assertIn("redsys_merchant_code", fields_)
        data = self.env["pos.payment.method"]._load_pos_data_read(self.method, self.config)
        self.assertNotIn("redsys_signature_key", data[0])
        self.assertEqual(data[0]["redsys_merchant_code"], "123456789")

    def test_get_signature_key_only_own_config(self):
        other = self._create_method("3")  # no asignado a la config
        self.open_new_session()
        self.pos_session.user_id = self.pos_user
        keys = self.env["pos.payment.method"].with_user(self.pos_user).redsys_get_signature_key(self.config.id)
        self.assertEqual(keys, {self.method.id: "SECRET-KEY"})
        self.assertNotIn(other.id, keys)

    def test_get_signature_key_denied_without_group(self):
        portal = self.env["res.users"].create(
            {
                "name": "Plain",
                "login": "redsys_plain",
                "group_ids": [(6, 0, [self.env.ref("base.group_user").id])],
            }
        )
        with self.assertRaises(AccessError):
            self.env["pos.payment.method"].with_user(portal).redsys_get_signature_key(self.config.id)

    def test_simulation_only_manager(self):
        Method = self.env["pos.payment.method"]
        with self.assertRaises(AccessError):
            Method.browse(self.method.id).with_user(self.pos_user).write({"redsys_simulation": True})
        self.method.with_user(self.pos_manager).write({"redsys_simulation": True})
        self.assertTrue(self.method.redsys_simulation)

    def _make_payment(self, state="authorized"):
        self.open_new_session()
        order = self.env["pos.order"].create(
            {
                "session_id": self.pos_session.id,
                "config_id": self.config.id,
                "lines": [],
                "amount_tax": 0,
                "amount_total": 10,
                "amount_paid": 0,
                "amount_return": 0,
            }
        )
        return self.env["pos.payment"].create(
            {
                "pos_order_id": order.id,
                "payment_method_id": self.method.id,
                "amount": 10,
                "transaction_id": "123456789012",
                "redsys_state": state,
                "redsys_reference": "ODOO-ABCD1234",
                "redsys_rts": "RTS1",
                "redsys_xml": redsys_xml(10, rts="RTS1"),
                # R3-01: sin estado Redsys solo se admite una linea denegada/en curso del POS
                **({} if state else {"payment_status": "retry"}),
            }
        )

    def test_payment_fields(self):
        payment = self._make_payment()
        self.assertEqual(payment.redsys_rts, "RTS1")
        self.assertEqual(payment.redsys_state, "authorized")
        # pos.payment usa el mixin por defecto ([]): se cargan todos los campos
        self.assertEqual(self.env["pos.payment"]._load_pos_data_fields(self.config), [])

    def test_original_pedido_field(self):
        payment = self._make_payment("authorized")
        self.assertFalse(payment.redsys_original_pedido)
        order = payment.pos_order_id
        refund = self.env["pos.payment"].create(
            {
                "pos_order_id": order.id,
                "payment_method_id": self.method.id,
                "amount": -4,
                "transaction_id": "123456789013",
                "redsys_state": "refund",
                "redsys_rts": "RTS2",
                "redsys_xml": redsys_xml(-4, pedido="123456789013", rts="RTS2", factura="R-1"),
                "redsys_reference": "R-1",
                "redsys_original_pedido": "123456789012",
            }
        )
        self.assertEqual(refund.redsys_original_pedido, "123456789012")
        # se carga al POS (mixin sin campos = todos) y no se copia
        self.assertFalse(refund.copy_data()[0].get("redsys_original_pedido"))
        with self.assertRaises(UserError):
            refund.write({"redsys_original_pedido": "999"})

    def test_unlink_authorized_blocked(self):
        payment = self._make_payment()
        with self.assertRaises(UserError):
            payment.unlink()
        self.assertTrue(payment.exists())

    def test_write_destructive_blocked(self):
        payment = self._make_payment()
        for vals in ({"amount": 5}, {"redsys_state": False}, {"transaction_id": "x"}):
            with self.assertRaises(UserError):
                payment.write(vals)
        payment.write({"card_brand": "Visa"})  # no destructivo

    def test_unknown_to_authorized_allowed(self):
        payment = self._make_payment("unknown")
        payment.write({"redsys_state": "authorized"})
        self.assertEqual(payment.redsys_state, "authorized")

    def test_unlink_plain_payment_allowed(self):
        payment = self._make_payment(state=False)
        payment.unlink()
        self.assertFalse(payment.exists())

    # ------------------------------------------------------------ QA backend

    def test_key_rpc_requires_open_session_of_the_user(self):
        Method = self.env["pos.payment.method"].with_user(self.pos_user)
        with self.assertRaises(AccessError):  # sin sesión abierta
            Method.redsys_get_signature_key(self.config.id)
        self.open_new_session()
        with self.assertRaises(AccessError):  # sesión abierta por otro usuario
            Method.redsys_get_signature_key(self.config.id)
        self.pos_session.user_id = self.pos_user
        self.assertEqual(
            Method.redsys_get_signature_key(self.config.id),
            {self.method.id: "SECRET-KEY"},
        )
        # un manager puede pedirla con sesión abierta
        keys = self.env["pos.payment.method"].with_user(self.pos_manager).redsys_get_signature_key(self.config.id)
        self.assertEqual(keys, {self.method.id: "SECRET-KEY"})

    def test_key_field_only_readable_by_manager(self):
        Method = self.env["pos.payment.method"]
        with self.assertRaises(AccessError):
            _ = Method.with_user(self.pos_user).browse(self.method.id).redsys_signature_key
        self.assertEqual(
            Method.with_user(self.pos_manager).browse(self.method.id).redsys_signature_key,
            "SECRET-KEY",
        )

    def test_reconcile_unknown_payment(self):
        payment = self._make_payment("unknown")
        with self.assertRaises(AccessError):
            payment.with_user(self.pos_user).redsys_reconcile("charged", "x")
        with self.assertRaises(UserError):  # nota obligatoria
            payment.with_user(self.pos_manager).redsys_reconcile("charged", " ")
        payment.with_user(self.pos_manager).redsys_reconcile("not_charged", "Portal: sin cargo")
        self.assertEqual(payment.redsys_state, "not_charged")
        self.assertEqual(payment.redsys_resolved_by_id, self.pos_manager)
        self.assertTrue(payment.redsys_resolved_date)
        self.assertEqual(payment.redsys_resolution_note, "Portal: sin cargo")
        payment.pos_order_id.write({"state": "paid"})  # QA2-05: en borrador sí se puede borrar
        with self.assertRaises(UserError):  # ya conciliada en un pedido pagado, protegida
            payment.unlink()
        with self.assertRaises(UserError):
            payment.with_user(self.pos_manager).redsys_reconcile("charged", "otra vez")

    def test_reconcile_charged_and_wizard(self):
        payment = self._make_payment("unknown")
        wizard = (
            self.env["pos.payment.redsys.reconcile"]
            .with_user(self.pos_manager)
            .with_context(active_model="pos.payment", active_ids=payment.ids)
            .create(
                {
                    "resolution": "charged",
                    "note": "Portal OK",
                    "payment_ids": [(6, 0, payment.ids)],
                }
            )
        )
        wizard.action_reconcile()
        self.assertEqual(payment.redsys_state, "authorized")
        self.assertEqual(payment.redsys_resolved_by_id, self.pos_manager)

    def test_cashier_cannot_fake_reconciliation(self):
        payment = self._make_payment("unknown")
        for vals in (
            {"redsys_state": "not_charged"},
            {"redsys_resolution_note": "mine"},
            {"redsys_resolved_by_id": self.pos_user.id},
        ):
            with self.assertRaises(UserError):
                payment.with_user(self.pos_user).write(vals)
        # el contexto de bypass enviado por RPC (sin sudo) no desbloquea
        with self.assertRaises(UserError):
            payment.with_user(self.pos_user).with_context(redsys_force_unlink=True).unlink()

    def test_reconcile_unknown_view_exists(self):
        action = self.env.ref("luis_botello_pos_redsys_tpvpc.action_pos_payment_redsys_unknown")
        self.assertEqual(action.res_model, "pos.payment")
        self.assertIn("redsys_unknown", action.context)
        self.assertTrue(
            self.env["ir.ui.view"].search([("model", "=", "pos.payment"), ("arch_db", "ilike", "redsys_state")])
        )
