"""QA independiente, segunda ronda (backend). Ver docs/qa_report2.md.

Convención (igual que la ronda 1): los tests `test_qa2_known_issue_*` AFIRMAN el comportamiento ACTUAL
(inseguro o incompleto) de un hallazgo NUEVO; el docstring dice el comportamiento deseado. Al corregirlo
fallarán a propósito y hay que invertir la aserción. El resto son comprobaciones del flujo REAL de
sincronización (`pos.order.sync_from_ui`, el mismo camino que usa el POS) que hoy se cumplen.
"""
from uuid import uuid4

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged
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

    def test_qa2_known_issue_synced_unknown_line_cannot_be_removed_by_the_pos(self):
        """NUEVO (ALTO) QA2-04. Escenario: un pedido en borrador (guardado para después / sync de fondo) ya
        tiene la línea `unknown` en servidor. El cajero verifica en el portal que NO se cobró, la libera
        (`unknown -> False` solo en cliente) y la borra: el POS envía `[2, id]` al validar. El servidor la
        rechaza (D10) y el pedido NO se puede cerrar. Deseado: permitir el borrado de una línea `unknown`
        cuando el mismo envío la libera, o que el POS sincronice antes el estado liberado."""
        line = self._line("unknown")
        order, data = self._sync([line], draft=True)
        pay = order.payment_ids
        cash = {"amount": 10.0, "name": fields.Datetime.to_string(fields.Datetime.now()),
                "payment_method_id": self.cash_pm1.id, "uuid": str(uuid4())}
        with self.assertRaises(UserError):
            self.env["pos.order"].sync_from_ui(
                [dict(data, state="paid", payment_ids=[[2, pay.id], [0, 0, cash]])]
            )
        self.assertEqual(order.state, "draft", "el pedido queda sin cerrar")

    def test_qa2_known_issue_not_charged_line_is_stuck_in_the_order(self):
        """NUEVO (MEDIO) QA2-05. Tras conciliar como `not_charged` la línea no se puede borrar ni siquiera
        un manager, y el pedido sigue contando ese importe como pagado (amount_paid): contabilidad con un
        cobro con tarjeta que no existió. Deseado: flujo de corrección (excluir la línea del pagado o
        permitir al manager anularla con traza)."""
        order, _data = self._sync([self._line("unknown")])
        pay = order.payment_ids
        self.assertEqual(order.amount_paid, 10.0)
        pay.with_user(self.manager).redsys_reconcile("not_charged", "Sin cargo en el portal")
        self.assertEqual(pay.redsys_state, "not_charged")
        with self.assertRaises(UserError):
            pay.with_user(self.manager).unlink()
        self.assertEqual(order.amount_paid, 10.0)
        self.assertEqual(order.amount_total, 10.0)

    def test_qa2_known_issue_manager_reconcile_vs_stale_pos_copy_blocks_sync(self):
        """NUEVO (MEDIO) QA2-09. Interacción QA-21 x D10 x sync: un manager concilia en el backend una línea
        `unknown` de un pedido borrador que sigue abierto en un POS. La copia local del POS aún dice
        `unknown`; su siguiente sync reenvía `redsys_state=unknown` y el servidor lo rechaza (la única
        transición permitida es unknown -> otro), de modo que el pedido NO sincroniza hasta recargar.
        Deseado: tratar como no-op el reenvío de un estado `unknown` sobre una línea ya resuelta (o
        devolver el estado del servidor al POS sin error)."""
        line = self._line("unknown")
        order, data = self._sync([line], draft=True)
        pay = order.payment_ids
        pay.with_user(self.manager).redsys_reconcile("charged", "Confirmado en el portal")
        self.assertEqual(pay.redsys_state, "authorized")
        stale = dict(data, state="draft", payment_ids=[[1, pay.id, dict(line)]])
        with self.assertRaises(UserError):
            self.env["pos.order"].sync_from_ui([stale])

    def test_qa2_known_issue_session_closes_silently_with_unknown_payments(self):
        """NUEVO (ALTO) QA2-03 (sigue abierto el aviso de QA-21). La sesión se cierra con líneas `unknown`
        sin aviso ni bloqueo: el cobro dudoso solo aparece si alguien abre el menú de conciliación.
        Deseado: `close_session_from_ui`/`_cannot_close_session` avisa (o exige conciliar antes)."""
        order, _data = self._sync([self._line("unknown")])
        self.assertEqual(order.state, "paid")
        session = self.pos_session
        session.post_closing_cash_details(0)
        res = session.close_session_from_ui()
        self.assertTrue(res.get("successful"), res)
        self.assertEqual(session.state, "closed")
        self.assertEqual(order.payment_ids.redsys_state, "unknown")

    def test_qa2_known_issue_cashier_can_unlink_draft_order_with_authorized_payment(self):
        """NUEVO (ALTO) QA2-10. `pos.order.unlink` (permitido a group_pos_user en borrador/cancelado) borra
        en cascada de BD las líneas Redsys authorized/unknown saltándose D10 (límite ya admitido en
        DECISIONS, pero alcanzable por un cajero con RPC normal). Deseado: pos.order no se borra si tiene
        líneas con `redsys_state` protegido (ondelete en pos.order)."""
        order, _data = self._sync([self._line("authorized")], draft=True)
        pay = order.payment_ids
        self.assertEqual(order.state, "draft")
        order.with_user(self.cashier).unlink()
        self.assertFalse(pay.exists(), "el cobro autorizado desapareció con el pedido")

    def test_qa2_known_issue_forged_refund_skips_uniqueness_and_link_checks(self):
        """NUEVO (MEDIO) QA2-06. Una línea `refund` con `redsys_original_pedido` (cualquier valor) no pasa
        por la unicidad pedido/RTS, no exige importe negativo ni que el original exista/tenga saldo.
        Un cajero puede (a) registrar la MISMA devolución real en dos pedidos, o (b) reutilizar el XML de
        un cobro ajeno como 'devolución' positiva. Deseado: refund => amount < 0, original authorized
        en el mismo método con saldo suficiente, y unicidad también entre devoluciones."""
        charge, _ = self._sync([self._line("authorized", amount=10.0)], draft=True)
        pedido = charge.payment_ids.transaction_id
        refund_vals = dict(amount=-10.0, xml=redsys_xml(-10.0), redsys_original_pedido=pedido)
        first, _ = self._sync([self._line("refund", **refund_vals)], draft=True)
        self.assertEqual(first.payment_ids.redsys_state, "refund")
        # (a) la MISMA devolución (mismo pedido/RTS) registrada otra vez en otro pedido: aceptada
        replay, _ = self._sync([self._line("refund", **refund_vals)], draft=True)
        self.assertEqual(replay.payment_ids.redsys_state, "refund")
        # (b) 'devolución' POSITIVA con el XML de un cobro y un original inventado: aceptada
        forged, _ = self._sync(
            [self._line("refund", amount=10.0, xml=redsys_xml(10.0), redsys_original_pedido="NO-EXISTE")],
            draft=True,
        )
        self.assertEqual(forged.payment_ids.redsys_state, "refund")
        self.assertEqual(forged.payment_ids.amount, 10.0)

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
