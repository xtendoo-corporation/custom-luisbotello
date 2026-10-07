"""QA independiente, segunda ronda (backend). Ver docs/qa_report2.md.

Ronda 3: los antiguos `test_qa2_known_issue_*` (que afirmaban el comportamiento defectuoso) se han
convertido en `test_qa2_NN_*`, que afirman el comportamiento CORRECTO. `test_qa2_server_cannot_tell_a_forged_xml...`
se mantiene como caracterización de un límite declarado (no se verifica la firma). El resto son comprobaciones del
flujo REAL de sincronización (`pos.order.sync_from_ui`, el mismo camino que usa el POS).
"""
from uuid import uuid4

from psycopg2 import IntegrityError

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger
from odoo.addons.point_of_sale.tests.common import TestPoSCommon

from .redsys_xml import redsys_query_op_xml, redsys_xml

KEY = "QA2-SECRET-KEY-1a2b3c4d"
RTS = "070001070319153828378272"


@tagged("post_install", "-at_install")
class TestRedsysQA2(TestPoSCommon):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.config = cls.basic_config
        # Método Redsys con diario/cuentas reales (copia del banco) para poder cerrar la sesión.
        cls.method = cls.bank_pm1.copy(
            default={
                "name": "QA2 Redsys",
                "payment_method_type": "terminal",
                "use_payment_terminal": "redsys_tpvpc",
                "redsys_merchant_code": "123456789",
                "redsys_terminal_number": "1",
                "redsys_signature_key": KEY,
            }
        )
        cls.config.write({"payment_method_ids": [(4, cls.method.id)]})
        cls.product = cls.create_product("QA2 product", cls.categ_basic, 10.0, 5)
        group_user = cls.env.ref("point_of_sale.group_pos_user")
        group_manager = cls.env.ref("point_of_sale.group_pos_manager")
        cls.cashier = cls.env["res.users"].create(
            {"name": "QA2 cashier", "login": "qa2_cashier", "group_ids": [(6, 0, [group_user.id])]}
        )
        cls.manager = cls.env["res.users"].create(
            {"name": "QA2 manager", "login": "qa2_manager", "group_ids": [(6, 0, [group_manager.id])]}
        )

    # ------------------------------------------------------------------ helpers

    def _line(self, state="authorized", amount=10.0, xml=None, uuid=None, **extra):
        """Línea de pago tal como la serializa el POS (campos de `pos.payment`)."""
        vals = {
            "uuid": uuid or str(uuid4()),
            "amount": amount,
            "name": fields.Datetime.to_string(fields.Datetime.now()),
            "payment_method_id": self.method.id,
            "payment_status": "done",
            "transaction_id": "123456789012",
            "payment_ref_no": "ODOO-ABCD1234",
            "redsys_reference": "ODOO-ABCD1234",
            "redsys_rts": RTS,
            "redsys_xml": xml if xml is not None else redsys_xml(amount),
            "redsys_state": state,
        }
        if state == "unknown":
            vals.update(transaction_id=False, redsys_rts=False, redsys_xml=False)
        vals.update(extra)
        return vals

    def _sync(self, payments, draft=False, order_uuid=None, **order_extra):
        """Sincroniza un pedido de 10 EUR con `sync_from_ui` (camino real del POS)."""
        if not self.pos_session_open():
            self.open_new_session()
        data = self.create_ui_order_data(
            [(self.product, 1)], payments=[(self.cash_pm1, 10.0)], uuid=order_uuid
        )
        data["payment_ids"] = [[0, 0, p] if isinstance(p, dict) else p for p in payments]
        data["amount_paid"] = 0.0 if draft else 10.0
        if draft:
            data["state"] = "draft"
        data.update(order_extra)
        res = self.env["pos.order"].sync_from_ui([data])
        return self.env["pos.order"].browse(res["pos.order"][0]["id"]), data

    def pos_session_open(self):
        return bool(self.config.current_session_id) and self.config.current_session_id.state != "closed"

    # ------------------------------------------------- camino real de sincronización (regresión)

    def test_qa2_real_sync_authorized_then_resync_is_idempotent(self):
        """QA-19/QA-20 con `sync_from_ui` real: pedido borrador con cobro autorizado y reenvío
        posterior de la misma línea ([0,0] con uuid existente => update) con otros campos de UI."""
        line = self._line("authorized")
        order, data = self._sync([line], draft=True)
        pay = order.payment_ids
        self.assertEqual(len(pay), 1)
        self.assertEqual(pay.redsys_state, "authorized")
        # El POS reenvía la línea ya sincronizada ([0,0,vals] con el mismo uuid => update del core).
        again = dict(data, state="draft")
        again["payment_ids"] = [[0, 0, {**line, "card_no": "0018", "payment_status": "done"}]]
        self.env["pos.order"].sync_from_ui([again])
        self.assertEqual(order.payment_ids, pay)
        self.assertEqual(pay.card_no, "0018")
        self.assertEqual(pay.redsys_state, "authorized")

    def test_qa2_real_sync_unknown_resolved_by_recovery_query_xml(self):
        """Flujo de recarga: línea unknown sincronizada en borrador y resuelta después con el XML de la
        CONSULTA (J11). Un XML con otro importe se rechaza y deja la línea unknown."""
        line = self._line("unknown")
        order, data = self._sync([line], draft=True)
        pay = order.payment_ids
        self.assertEqual(pay.redsys_state, "unknown")
        resolved = {
            **line,
            "redsys_state": "authorized",
            "transaction_id": "123456789012",
            "redsys_rts": RTS,
            "redsys_xml": redsys_query_op_xml(10.0),
        }
        bad = dict(resolved, redsys_xml=redsys_query_op_xml(1.0))
        with self.assertRaises(ValidationError):
            self.env["pos.order"].sync_from_ui([dict(data, state="draft", payment_ids=[[0, 0, bad]])])
        self.assertEqual(pay.redsys_state, "unknown")
        self.env["pos.order"].sync_from_ui([dict(data, state="draft", payment_ids=[[0, 0, resolved]])])
        self.assertEqual(pay.redsys_state, "authorized")

    def test_qa2_replace_and_clear_commands_cannot_drop_protected_lines(self):
        """Intento de romper D10 por comandos x2many del pedido: (5,) y (6,0,[]) pasan por unlink."""
        order, _data = self._sync([self._line("authorized")], draft=True)
        for cmd in (Command.clear(), Command.set([])):
            with self.subTest(cmd=cmd[0]), self.assertRaises(UserError):
                order.write({"payment_ids": [cmd]})
        self.assertEqual(len(order.payment_ids), 1)

    # ------------------------------------------------------------------ hallazgos nuevos

    def _cash(self):
        return {"amount": 10.0, "name": fields.Datetime.to_string(fields.Datetime.now()),
                "payment_method_id": self.cash_pm1.id, "uuid": str(uuid4())}

    def test_qa2_04_synced_unknown_line_released_by_cashier_then_order_closes(self):
        """QA2-04. Pedido en borrador con la línea `unknown` ya en servidor. Borrarla sin más sigue
        prohibido (D10). El cajero la libera con `redsys_release_unknown` (auditada: not_charged con
        usuario/fecha/nota y mensaje en el pedido); el POS envía entonces `[2, id]` + efectivo y el pedido
        cierra. Flujo real con sync_from_ui."""
        line = self._line("unknown")
        order, data = self._sync([line], draft=True)
        pay = order.payment_ids
        with self.assertRaises(UserError):  # sin liberar, D10 sigue protegiendo la línea
            self.env["pos.order"].sync_from_ui(
                [dict(data, state="paid", payment_ids=[[2, pay.id], [0, 0, self._cash()]])]
            )
        self.assertEqual(order.state, "draft")
        pay_id = pay.id
        pay.with_user(self.cashier).redsys_release_unknown()
        self.assertEqual(pay.redsys_state, "not_charged")
        self.assertEqual(pay.redsys_resolved_by_id, self.cashier)
        self.assertTrue(pay.redsys_resolved_date and pay.redsys_resolution_note)
        self.assertIn("released", order.message_ids[:1].body.lower())
        # el POS reenvía la copia local ya `not_charged` (no `unknown -> False`) y borra la línea
        self.env["pos.order"].sync_from_ui(
            [dict(data, state="paid", payment_ids=[[2, pay_id], [0, 0, self._cash()]])]
        )
        self.assertEqual(order.state, "paid")
        self.assertFalse(self.env["pos.payment"].browse(pay_id).exists())
        self.assertEqual(order.payment_ids.payment_method_id, self.cash_pm1)

    def test_qa2_04_release_is_restricted(self):
        """La liberación del cajero NO sirve para saltarse D10 en otros casos."""
        # autorizado: no es unknown
        order, _data = self._sync([self._line("authorized")], draft=True)
        with self.assertRaises(UserError):
            order.payment_ids.with_user(self.cashier).redsys_release_unknown()
        # unknown con rastro de Redsys (XML/RTS de un importe dudoso): lo concilia un manager
        dudosa = self._line("unknown", transaction_id="123456789013", redsys_rts="RTS-OTRO-0001",
                            redsys_xml=redsys_xml(7.0, pedido="123456789013", rts="RTS-OTRO-0001"))
        order2, _ = self._sync([dudosa], draft=True)
        with self.assertRaises(UserError):
            order2.payment_ids.with_user(self.cashier).redsys_release_unknown()
        # unknown limpio pero en un pedido ya pagado
        order3, _ = self._sync([self._line("unknown")])
        self.assertEqual(order3.state, "paid")
        with self.assertRaises(UserError):
            order3.payment_ids.with_user(self.cashier).redsys_release_unknown()
        self.assertEqual(order3.payment_ids.redsys_state, "unknown")

    def test_qa2_05_not_charged_line_removable_in_draft_stuck_in_paid(self):
        """QA2-05 (PARCIAL). Una línea `not_charged` se puede borrar mientras el pedido sea borrador (queda
        rastro en el chatter); en un pedido ya pagado se queda (borrarla desbarataría el pedido) y el
        wizard de conciliación avisa de que el pedido sigue contando ese importe como pagado."""
        draft, _data = self._sync([self._line("unknown")], draft=True)
        draft.payment_ids.with_user(self.manager).redsys_reconcile("not_charged", "Sin cargo en el portal")
        draft.payment_ids.with_user(self.manager).unlink()
        self.assertFalse(draft.payment_ids)
        self.assertIn("removed", draft.message_ids[:1].body)
        paid, _ = self._sync([self._line("unknown", uuid=str(uuid4()),
                                         redsys_reference="ODOO-PAID0001", payment_ref_no="ODOO-PAID0001")])
        pay = paid.payment_ids
        self.assertEqual(paid.amount_paid, 10.0)
        wiz = self.env["pos.payment.redsys.reconcile"].with_user(self.manager).create(
            {"payment_ids": [(6, 0, pay.ids)], "resolution": "not_charged", "note": "Sin cargo"}
        )
        self.assertIn(paid.display_name, wiz.warning)
        wiz.action_reconcile()
        self.assertEqual(pay.redsys_state, "not_charged")
        with self.assertRaises(UserError):
            pay.with_user(self.manager).unlink()
        self.assertEqual(paid.amount_paid, 10.0)

    def test_qa2_09_stale_unknown_resend_after_manager_reconcile_is_a_noop(self):
        """QA2-09. Tras conciliar un manager, el reenvío del `unknown` obsoleto desde un POS sin refrescar
        NO bloquea la sincronización: es un no-op para los campos Redsys (los de UI sí se guardan) y el
        servidor conserva el estado conciliado."""
        line = self._line("unknown")
        order, data = self._sync([line], draft=True)
        pay = order.payment_ids
        pay.with_user(self.manager).redsys_reconcile("charged", "Confirmado en el portal")
        self.assertEqual(pay.redsys_state, "authorized")
        stale = dict(data, state="draft", payment_ids=[[1, pay.id, dict(line, card_no="1111")]])
        self.env["pos.order"].sync_from_ui([stale])
        self.assertEqual(pay.redsys_state, "authorized")
        self.assertEqual(pay.card_no, "1111")
        self.assertFalse(pay.transaction_id, "los campos Redsys no se tocan")

    def test_qa2_03_session_cannot_close_with_unknown_payments(self):
        """QA2-03. Con líneas `unknown` la sesión NO cierra: `close_session_from_ui` devuelve el aviso con
        el listado (y redirige al backend); `action_pos_session_closing_control` (backend) lo rechaza.
        Tras conciliar un manager, la sesión cierra."""
        order, _data = self._sync([self._line("unknown")])
        self.assertEqual(order.state, "paid")
        session = self.pos_session
        res = session.close_session_from_ui()
        self.assertFalse(res.get("successful"), res)
        self.assertTrue(res.get("redirect"))
        self.assertIn("ODOO-ABCD1234", res["message"])
        self.assertIn(order.display_name, res["message"])
        self.assertNotEqual(session.state, "closed")
        with self.assertRaises(UserError):
            session.action_pos_session_closing_control()
        order.payment_ids.with_user(self.manager).redsys_reconcile("charged", "Confirmado en el portal")
        session.post_closing_cash_details(0)
        res = session.close_session_from_ui()
        self.assertTrue(res.get("successful"), res)
        self.assertEqual(session.state, "closed")

    def test_qa2_10_cashier_cannot_unlink_or_cancel_orders_with_card_payments(self):
        """QA2-10 / QA2-01 (servidor). `pos.order.unlink` por RPC (cajero) y `action_pos_order_cancel`
        (el «Cancel Orders» del cierre de sesión por `open_order_ids`) NO eliminan/cancelan un pedido con
        cobros authorized/unknown; la cascada de BD no llega a ejecutarse. Sin cobros Redsys el core
        funciona igual. El bypass de servidor (`su` + contexto) se conserva."""
        for state in ("authorized", "unknown"):
            order, _data = self._sync([self._line(state, uuid=str(uuid4()))], draft=True)
            pay = order.payment_ids
            with self.assertRaises(UserError):
                order.with_user(self.cashier).unlink()
            with self.assertRaises(UserError):
                order.with_user(self.cashier).action_pos_order_cancel()
            self.assertTrue(pay.exists())
            self.assertEqual(order.state, "draft")
            # un contexto enviado por RPC no es el bypass: hace falta sudo de servidor
            with self.assertRaises(UserError):
                order.with_user(self.cashier).with_context(redsys_force_unlink=True).unlink()
            order.sudo().with_context(redsys_force_unlink=True).unlink()
            self.assertFalse(pay.exists())
        plain, _ = self._sync([self._cash()], draft=True)
        plain.with_user(self.cashier).unlink()
        self.assertFalse(plain.exists())

    def test_qa2_06_refund_checks_in_the_server(self):
        """QA2-06. Una `refund` con `redsys_original_pedido`: importe negativo, cobro original
        `authorized` en el mismo método, sin repetir una devolución ya registrada y sin superar el
        importe cobrado entre todas las devoluciones. Dos devoluciones parciales legítimas sí pasan."""
        charge, _ = self._sync([self._line("authorized", amount=10.0)], draft=True)
        pedido = charge.payment_ids.transaction_id

        def refund(amount, ref, **kw):
            return self._line("refund", amount=amount, xml=redsys_xml(amount, factura=ref),
                              redsys_reference=ref, payment_ref_no=ref,
                              redsys_original_pedido=kw.pop("original", pedido), **kw)

        first, _ = self._sync([refund(-4.0, "ODOO-REFU0001")], draft=True)
        self.assertEqual(first.payment_ids.redsys_state, "refund")
        second, _ = self._sync([refund(-6.0, "ODOO-REFU0002")], draft=True)
        self.assertEqual(second.payment_ids.redsys_state, "refund")
        for label, vals in (
            ("misma devolución en otro pedido", refund(-4.0, "ODOO-REFU0001")),
            ("supera el cobrado", refund(-1.0, "ODOO-REFU0003")),
        ):
            with self.subTest(label), self.assertRaises(ValidationError):
                self._sync([vals], draft=True)
        with self.subTest("positiva con original inventado"), self.assertRaises(ValidationError):
            self._sync([self._line("refund", amount=10.0, xml=redsys_xml(10.0),
                                   redsys_original_pedido="NO-EXISTE")], draft=True)
        with self.subTest("original inexistente"), self.assertRaises(ValidationError):
            self._sync([refund(-1.0, "ODOO-REFU0004", original="999999999999")], draft=True)

    def test_qa2_17_unique_indexes_in_database(self):
        """QA2-17. Índices únicos parciales (método, pedido) y (método, RTS) para cobros `authorized`:
        aunque la comprobación Python se saltase (concurrencia), la BD rechaza el duplicado."""
        self.env.cr.execute(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'pos_payment' AND indexname LIKE 'pos_payment_redsys_%_uniq'"
        )
        self.assertEqual(len(self.env.cr.fetchall()), 2)
        one, _ = self._sync([self._line("authorized", uuid=str(uuid4()))], draft=True)
        other, _ = self._sync([self._line("unknown", uuid=str(uuid4()),
                                          redsys_reference="ODOO-OTHER001", payment_ref_no="ODOO-OTHER001")], draft=True)
        with self.assertRaises(IntegrityError), mute_logger("odoo.sql_db"), self.env.cr.savepoint():
            self.env.cr.execute(
                "UPDATE pos_payment SET redsys_state='authorized', transaction_id=%s WHERE id=%s",
                (one.payment_ids.transaction_id, other.payment_ids.id),
            )

    def test_qa2_server_cannot_tell_a_forged_xml_from_a_real_one(self):
        """Límite conocido (DECISIONS QA-20, no se verifica la firma): el XML lo aporta el cliente y basta
        con que sea coherente consigo mismo. Un cajero deshonesto registra un 'cobro autorizado' sin
        pasar por el datáfono. Se deja como test de CARACTERIZACIÓN: si algún día se verifica la firma o
        se contrasta con Redsys desde el servidor, este test debe fallar."""
        order, _ = self._sync([self._line("authorized", amount=10.0, xml=redsys_xml(10.0, pedido="555555555555",
                                                                                   rts="FORJADO0000000000000001"),
                                          transaction_id="555555555555", redsys_rts="FORJADO0000000000000001")])
        self.assertEqual(order.payment_ids.redsys_state, "authorized")

    def test_qa2_signature_rpc_manager_can_read_any_open_config_and_cashier_only_own(self):
        """Verificación QA-16/17 desde otro ángulo: la sesión abierta por el cajero entrega la clave solo
        a él; otro cajero (otro usuario, sin ser manager) no la obtiene aunque la sesión esté abierta."""
        self.open_new_session()
        self.pos_session.user_id = self.cashier
        Method = self.env["pos.payment.method"]
        self.assertEqual(Method.with_user(self.cashier).redsys_get_signature_key(self.config.id)[self.method.id], KEY)
        other = self.env["res.users"].create(
            {"name": "QA2 other", "login": "qa2_other",
             "group_ids": [(6, 0, [self.env.ref("point_of_sale.group_pos_user").id])]}
        )
        with self.assertRaises(AccessError):
            Method.with_user(other).redsys_get_signature_key(self.config.id)
        self.assertIn(self.method.id, Method.with_user(self.manager).redsys_get_signature_key(self.config.id))
