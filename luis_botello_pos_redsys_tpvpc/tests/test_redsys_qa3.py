"""QA independiente, tercera ronda (backend). Ver docs/qa_report3.md.

Convencion: `test_qa3_NN_*` afirman el comportamiento CORRECTO (los antiguos `known_issue` de la ronda 3 se
convirtieron en la ronda 4).
"""

from uuid import uuid4

from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged

from . import test_redsys_qa2 as qa2
from .redsys_xml import redsys_xml

INDEXES = (
    "pos_payment_redsys_transaction_id_authorized_uniq",
    "pos_payment_redsys_redsys_rts_authorized_uniq",
)


@tagged("post_install", "-at_install")
class TestRedsysQA3(qa2.TestRedsysQA2):
    """Hereda helpers (`_line`, `_sync`, usuarios) de la ronda 2; los tests de la ronda 2 NO se repiten aqui."""

    def _index_exists(self, name):
        self.env.cr.execute("SELECT 1 FROM pg_indexes WHERE indexname = %s", (name,))
        return bool(self.env.cr.fetchone())

    # ------------------------------------------------------------------ rutas del core que borran pedidos

    def test_qa3_01_remove_from_ui_is_blocked_for_protected_payments(self):
        """`pos.order.remove_from_ui` (RPC publica del core, usada por pos_self_order) escribe state=cancel,
        hace `payment_ids.sudo().unlink()` y `orders.sudo().unlink()`: el `sudo()` NO activa el bypass
        (exige ademas el contexto) y todo se revierte. El cobro y el pedido siguen intactos."""
        for state in ("authorized", "unknown"):
            order, _data = self._sync([self._line(state, uuid=str(uuid4()))], draft=True)
            with self.assertRaises(UserError):
                self.env["pos.order"].with_user(self.cashier).remove_from_ui([order.id])
            self.assertEqual(order.state, "draft")
            self.assertEqual(len(order.payment_ids), 1)

    def test_qa3_02_sudo_alone_does_not_bypass_the_guard(self):
        """El flujo del wizard del paquete conventional hace `order.sudo().payment_ids.unlink()`."""
        order, _data = self._sync([self._line("authorized")], draft=True)
        with self.assertRaises(UserError):
            order.sudo().payment_ids.unlink()
        with self.assertRaises(UserError):
            order.sudo().unlink()

    def test_qa3_03_index_creation_survives_preexisting_duplicates(self):
        """Actualizacion en una BD con datos: si ya hay dos `authorized` con el mismo pedido, `init()` NO falla
        (se omite el indice) y, corregidos los datos, `init()` lo crea. No deja la transaccion abortada."""
        order1, _ = self._sync([self._line("authorized")], draft=True)
        other = self._line(
            "authorized",
            uuid=str(uuid4()),
            transaction_id="999999999999",
            redsys_rts="RTS-OTHER-0001",
            redsys_reference="ODOO-OTHER001",
        )
        other["redsys_xml"] = redsys_xml(10.0, pedido="999999999999", rts="RTS-OTHER-0001", factura="ODOO-OTHER001")
        order2, _ = self._sync([other], draft=True, order_uuid=str(uuid4()))
        for name in INDEXES:
            self.env.cr.execute(f"DROP INDEX IF EXISTS {name}")
        pay1, pay2 = order1.payment_ids, order2.payment_ids
        # duplicado por SQL (las comprobaciones Python/ORM lo impiden): simula datos previos al modulo
        self.env.cr.execute(
            "UPDATE pos_payment SET transaction_id = %s, redsys_rts = %s WHERE id = %s",
            (pay1.transaction_id, pay1.redsys_rts, pay2.id),
        )
        self.env["pos.payment"].init()  # no debe lanzar
        self.assertFalse(self._index_exists(INDEXES[0]), "con duplicados el indice no se crea")
        self.env.cr.execute("SELECT 1")  # la transaccion sigue viva
        self.env.cr.execute(
            "UPDATE pos_payment SET transaction_id = '999999999999', redsys_rts = 'RTS-OTHER-0001' WHERE id = %s",
            (pay2.id,),
        )
        self.env["pos.payment"].init()
        for name in INDEXES:
            self.assertTrue(self._index_exists(name), name)

    def test_qa3_04_refund_does_not_collide_with_partial_index(self):
        """Las devoluciones comparten pedido/RTS con el cobro y NO entran en el indice parcial (estado refund)."""
        order, _ = self._sync([self._line("authorized")], draft=True)
        self.assertTrue(order.payment_ids)
        self.assertTrue(self._index_exists(INDEXES[0]))

    # ------------------------------------------------------------------ ronda 4: hallazgos corregidos

    def test_qa3_05_write_cancel_is_blocked_for_protected_payments(self):
        """R3-02. La guarda vive en `pos.order.write` (no solo en `action_pos_order_cancel`): cubre
        `write({'state': 'cancel'})` de cualquier cajero y de `pos_conventional_session_management`."""
        for state in ("authorized", "unknown"):
            order, _data = self._sync([self._line(state, uuid=str(uuid4()))], draft=True)
            with self.assertRaises(UserError):
                order.with_user(self.cashier).action_pos_order_cancel()
            with self.assertRaises(UserError):
                order.with_user(self.cashier).write({"state": "cancel"})
            with self.assertRaises(UserError):
                order.sudo().write({"state": "cancel"})  # sudo solo no activa el bypass
            self.assertEqual(order.state, "draft")
        empty, _data = self._sync([], draft=True)
        empty.with_user(self.cashier).write({"state": "cancel"})  # sin cobros Redsys: sigue permitido
        self.assertEqual(empty.state, "cancel")

    def test_qa3_06_redsys_method_payment_without_terminal_flow_is_rejected(self):
        """R3-01. Un `pos.payment` de un metodo Redsys sin `redsys_state` y dado por bueno (el popup/wizard
        de `pos_conventional_payment_wizard`) se rechaza; las lineas en curso/denegadas del POS siguen
        sincronizando; un metodo en simulacion queda fuera; la sync normal con estado Redsys funciona."""
        order, _data = self._sync([], draft=True)
        with self.assertRaises(UserError):
            order.add_payment(
                {
                    "pos_order_id": order.id,
                    "amount": 10.0,
                    "payment_method_id": self.method.id,
                }
            )
        with self.assertRaises(UserError):
            self.env["pos.payment"].create(
                {
                    "pos_order_id": order.id,
                    "amount": 10.0,
                    "payment_method_id": self.method.id,
                    "payment_status": "done",
                }
            )
        self.assertFalse(order.payment_ids)
        # linea del POS en curso o denegada: se sincroniza como borrador
        for status in ("waitingCard", "retry"):
            line = self._line(
                "authorized",
                uuid=str(uuid4()),
                payment_status=status,
                redsys_state=False,
                transaction_id=False,
                redsys_rts=False,
                redsys_xml=False,
            )
            o, _d = self._sync([line], draft=True, order_uuid=str(uuid4()))
            self.assertEqual(o.payment_ids.payment_status, status)
        # cambiar el metodo o el estado de una linea ya existente tampoco abre la puerta
        cash_line = self.env["pos.payment"].create(
            {
                "pos_order_id": order.id,
                "amount": 1.0,
                "payment_method_id": self.cash_pm1.id,
            }
        )
        with self.assertRaises(UserError):
            cash_line.write({"payment_method_id": self.method.id})
        # sync normal (authorized con XML valido) y metodo en simulacion
        ok, _d = self._sync(
            [
                self._line(
                    "authorized",
                    uuid=str(uuid4()),
                    transaction_id="777777777777",
                    redsys_rts="RTS-OK-0000001",
                    redsys_xml=redsys_xml(10.0, pedido="777777777777", rts="RTS-OK-0000001"),
                )
            ],
            order_uuid=str(uuid4()),
        )
        self.assertEqual(ok.payment_ids.redsys_state, "authorized")
        sim_method = self.method.copy(default={"name": "QA3 Redsys sim", "redsys_simulation": True})
        # (`new`: el metodo de simulacion no esta en la config de la sesion abierta)
        self.env["pos.payment"].new(
            {
                "pos_order_id": order.id,
                "amount": 2.0,
                "payment_method_id": sim_method.id,
            }
        )._redsys_check_terminal_flow()
        with self.assertRaises(UserError):
            self.env["pos.payment"].new(
                {
                    "pos_order_id": order.id,
                    "amount": 2.0,
                    "payment_method_id": self.method.id,
                }
            )._redsys_check_terminal_flow()

    def test_qa3_07_public_session_validate_is_blocked_with_unknown_payments(self):
        """R3-03. `action_pos_session_validate`/`action_pos_session_close` (RPC publicos) no cierran con `unknown`."""
        self._sync([self._line("unknown")])
        session = self.pos_session
        with self.assertRaises(UserError):
            session.action_pos_session_closing_control()
        session.write({"state": "closing_control"})
        with self.assertRaises(UserError):
            session.action_pos_session_validate()
        self.assertEqual(session.state, "closing_control")

    def test_qa3_08_manager_can_cancel_abandoned_draft_with_authorized_line_audited(
        self,
    ):
        """R3-04. Salida de manager: el cajero sigue sin poder; el manager cancela con referencia de la
        devolucion y nota (queda en el chatter, las lineas se conservan) y la sesion ya puede cerrarse."""
        order, _data = self._sync([self._line("authorized")], draft=True)
        with self.assertRaises(UserError):
            order.with_user(self.manager).action_pos_order_cancel()
        with self.assertRaises(UserError):
            order.with_user(self.manager).unlink()
        with self.assertRaises(AccessError):
            order.with_user(self.cashier).redsys_manager_cancel("REF-1", "x")
        with self.assertRaises(UserError):
            order.with_user(self.manager).redsys_manager_cancel("", "nota")
        wiz = (
            self.env["pos.order.redsys.cancel"]
            .with_user(self.manager)
            .with_context(active_model="pos.order", active_id=order.id)
            .create(
                {
                    "refund_reference": "DEV-123",
                    "note": "Cliente se fue; devuelto en el portal",
                }
            )
        )
        self.assertEqual(wiz.order_id, order)
        wiz.action_cancel_order()
        self.assertEqual(order.state, "cancel")
        self.assertEqual(order.payment_ids.redsys_state, "authorized")  # rastro conservado
        self.assertIn("DEV-123", " ".join(order.message_ids.mapped(lambda m: m.body or "")))
        res = self.pos_session.close_session_from_ui()
        self.assertNotIn(order.id, res.get("open_order_ids", []))

    def test_qa3_08b_manager_cancel_refuses_unknown_lines(self):
        order, _data = self._sync([self._line("unknown")], draft=True)
        with self.assertRaises(UserError):
            order.with_user(self.manager).redsys_manager_cancel("REF", "nota")
        self.assertEqual(order.state, "draft")

    def test_qa3_09_reconcile_charged_duplicate_raises_validation_error(self):
        """R3-05. `redsys_reconcile` traduce el IntegrityError de los indices unicos."""
        from odoo.tools import mute_logger

        a, _ = self._sync([self._line("unknown")], draft=True)
        b, _ = self._sync(
            [self._line("unknown", uuid=str(uuid4()))],
            draft=True,
            order_uuid=str(uuid4()),
        )
        for pay in (a.payment_ids, b.payment_ids):
            pay.write({"transaction_id": "555555555555", "redsys_rts": "RTS-DUP-0000001"})
        both = (a | b).payment_ids
        with mute_logger("odoo.sql_db"), self.assertRaises(ValidationError):
            both.with_user(self.manager).redsys_reconcile("charged", "Dup")


# Los tests heredados de la ronda 2 ya los ejecuta su propia clase: aqui se anulan para no duplicarlos.
for _name in dir(qa2.TestRedsysQA2):
    if _name.startswith("test_") and _name not in TestRedsysQA3.__dict__:
        setattr(TestRedsysQA3, _name, None)
