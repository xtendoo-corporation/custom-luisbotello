"""QA independiente, tercera ronda (backend). Ver docs/qa_report3.md.

Convencion: `test_qa3_NN_*` afirman el comportamiento CORRECTO ya conseguido (regresion). Los
`test_qa3_known_issue_*` AFIRMAN EL COMPORTAMIENTO ACTUAL DEFECTUOSO de un hallazgo abierto: fallaran a proposito
cuando se corrija (entonces invertir la asercion y renombrar a `test_qa3_NN_*`).
"""
from uuid import uuid4

from odoo.exceptions import UserError
from odoo.tests import tagged

from . import test_redsys_qa2 as qa2

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
            "authorized", uuid=str(uuid4()), transaction_id="999999999999", redsys_rts="RTS-OTHER-0001",
            redsys_reference="ODOO-OTHER001",
        )
        from .redsys_xml import redsys_xml

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

    # ------------------------------------------------------------------ HALLAZGOS ABIERTOS (caracterizacion)

    def test_qa3_known_issue_05_cashier_can_cancel_order_with_authorized_payment_by_write(self):
        """R3-02 (ALTO). `action_pos_order_cancel` esta guardado, pero `pos.order.write({'state': 'cancel'})` NO:
        lo usan `pos_conventional_session_management` (`_cancel_empty_draft_orders` y el wizard de cierre,
        sobre pedidos sin lineas de producto) y cualquier cajero por RPC. El cobro `authorized` queda en un
        pedido `cancel` (fuera de la contabilidad de la sesion) y la sesion puede cerrarse."""
        order, _data = self._sync([self._line("authorized")], draft=True)
        with self.assertRaises(UserError):
            order.with_user(self.cashier).action_pos_order_cancel()
        order.with_user(self.cashier).write({"state": "cancel"})  # NO deberia poder
        self.assertEqual(order.state, "cancel")
        self.assertEqual(order.payment_ids.redsys_state, "authorized")

    def test_qa3_known_issue_06_redsys_method_payment_without_redsys_state_is_accepted(self):
        """R3-01 (ALTO). Los flujos backend de `pos_conventional_payment_wizard` (`add_payment_from_ui`,
        wizard `pos.make.payment.wizard`, `get_payment_popup_data` lista TODOS los metodos de la caja)
        crean `pos.payment` con el metodo Redsys sin pasar por el datafono: un pago con tarjeta registrado
        sin cargo. El servidor no exige estado Redsys a un pago de un metodo `redsys_tpvpc`."""
        order, _data = self._sync([], draft=True)
        order.add_payment(
            {"pos_order_id": order.id, "amount": 10.0, "payment_method_id": self.method.id}
        )
        self.assertEqual(order.payment_ids.payment_method_id, self.method)
        self.assertFalse(order.payment_ids.redsys_state)
        self.assertEqual(order.amount_paid, 10.0)

    def test_qa3_known_issue_07_public_session_validate_bypasses_unknown_guard(self):
        """R3-03 (BAJO). El bloqueo esta en `_cannot_close_session` y `action_pos_session_closing_control`;
        `action_pos_session_validate`/`action_pos_session_close` son metodos publicos del core que van directo a
        `_validate_session`: por RPC se puede cerrar con lineas `unknown`. No hay boton de UI que lo haga."""
        order, _data = self._sync([self._line("unknown")])
        session = self.pos_session
        with self.assertRaises(UserError):
            session.action_pos_session_closing_control()
        session.write({"state": "closing_control"})
        session.action_pos_session_validate()
        self.assertEqual(session.state, "closed")
        self.assertEqual(order.payment_ids.redsys_state, "unknown")

    def test_qa3_known_issue_08_no_manager_exit_for_draft_order_with_authorized_card_line(self):
        """R3-04 (MEDIO). Pedido borrador con una linea `authorized` abandonada (el cliente se fue sin pagar
        el resto): ni el cajero ni el manager pueden cancelarlo/borrarlo/quitar la linea; no hay accion de
        manager (el bypass `redsys_force_unlink` no se usa en ninguna vista/boton). La sesion no cierra
        mientras el pedido siga en borrador. La unica salida es completar el pedido en el POS."""
        order, _data = self._sync([self._line("authorized")], draft=True)
        manager_order = order.with_user(self.manager)
        with self.assertRaises(UserError):
            manager_order.action_pos_order_cancel()
        with self.assertRaises(UserError):
            manager_order.unlink()
        with self.assertRaises(UserError):
            manager_order.payment_ids.unlink()
        res = self.pos_session.close_session_from_ui()
        self.assertFalse(res.get("successful"))
        self.assertIn(order.id, res.get("open_order_ids", []))

    def test_qa3_known_issue_09_reconcile_charged_duplicate_raises_raw_integrity_error(self):
        """R3-05 (BAJO). `redsys_reconcile` escribe con `super(PosPayment, pay).write` (salta el wrapper que
        traduce el IntegrityError): dos `unknown` con el mismo pedido (rellenado al resolver) conciliadas como
        `charged` revientan con IntegrityError crudo en vez de ValidationError."""
        from psycopg2 import IntegrityError

        from odoo.tools import mute_logger

        a, _ = self._sync([self._line("unknown")], draft=True)
        b, _ = self._sync([self._line("unknown", uuid=str(uuid4()))], draft=True, order_uuid=str(uuid4()))
        for pay in (a.payment_ids, b.payment_ids):
            pay.write({"transaction_id": "555555555555", "redsys_rts": "RTS-DUP-0000001"})
        both = (a | b).payment_ids
        with mute_logger("odoo.sql_db"), self.assertRaises(IntegrityError):
            both.with_user(self.manager).redsys_reconcile("charged", "Dup")
            self.env.flush_all()


# Los tests heredados de la ronda 2 ya los ejecuta su propia clase: aqui se anulan para no duplicarlos.
for _name in dir(qa2.TestRedsysQA2):
    if _name.startswith("test_") and _name not in TestRedsysQA3.__dict__:
        setattr(TestRedsysQA3, _name, None)
