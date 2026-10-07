from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged
from odoo.addons.point_of_sale.tests.common import TestPoSCommon


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
                "group_ids": [
                    (6, 0, [cls.env.ref("point_of_sale.group_pos_manager").id])
                ],
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
        data = self.env["pos.payment.method"]._load_pos_data_read(
            self.method, self.config
        )
        self.assertNotIn("redsys_signature_key", data[0])
        self.assertEqual(data[0]["redsys_merchant_code"], "123456789")

    def test_get_signature_key_only_own_config(self):
        other = self._create_method("3")  # no asignado a la config
        Method = self.env["pos.payment.method"].with_user(self.pos_user)
        keys = Method.redsys_get_signature_key(self.config.id)
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
            self.env["pos.payment.method"].with_user(
                portal
            ).redsys_get_signature_key(self.config.id)

    def test_simulation_only_manager(self):
        Method = self.env["pos.payment.method"]
        with self.assertRaises(AccessError):
            Method.browse(self.method.id).with_user(self.pos_user).write(
                {"redsys_simulation": True}
            )
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
                "redsys_xml": "<xml/>",
            }
        )

    def test_payment_fields(self):
        payment = self._make_payment()
        self.assertEqual(payment.redsys_rts, "RTS1")
        self.assertEqual(payment.redsys_state, "authorized")
        # pos.payment usa el mixin por defecto ([]): se cargan todos los campos
        self.assertEqual(self.env["pos.payment"]._load_pos_data_fields(self.config), [])

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
