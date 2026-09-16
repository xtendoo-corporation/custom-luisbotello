import contextlib
from types import SimpleNamespace

import odoo.http
from odoo.tests.common import HttpCase, TransactionCase, tagged

from odoo.addons.pos_conventional_core.tests.common import PosConventionalTestCommon

from ..controllers.main import (
    POS_LOCKED_SLUG_COOKIE,
    PosSlugAccessGuardController,
    PosSlugController,
)


@contextlib.contextmanager
def _fake_http_request(env, locked_slug=None):
    """Empuja un odoo.http.request falso en la pila real de Odoo, con el
    env y la cookie de caja bloqueada indicados. Es el mismo mecanismo
    (_request_stack) que usa un request HTTP real, por lo que también cubre
    correctamente el ``from odoo.http import request`` local de
    pos.config._search."""
    cookies = {}
    if locked_slug:
        cookies[POS_LOCKED_SLUG_COOKIE] = locked_slug
    fake_request = SimpleNamespace(cookies=cookies, env=env)
    odoo.http._request_stack.push(fake_request)
    try:
        yield fake_request
    finally:
        odoo.http._request_stack.pop()


class TestPosSlugControllerHelper(TransactionCase):
    def test_slug_opens_the_selected_pos_configuration(self):
        pos_config = SimpleNamespace(id=42)

        url = PosSlugController._get_pos_conventional_url(pos_config)

        self.assertEqual(url, "/odoo/point-of-sale")


@tagged("post_install", "-at_install")
class TestPosConfigSlugFilter(TransactionCase):
    """El listado estándar de pos.config (kanban del backend) solo debe
    mostrar la caja fijada por la cookie de bloqueo activa."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.selected_pos = cls.env["pos.config"].create(
            {
                "name": "Selected POS",
                "access_slug": "selected-pos",
            }
        )
        cls.other_pos = cls.env["pos.config"].create(
            {
                "name": "Other POS",
                "access_slug": "other-pos",
            }
        )

    def test_search_only_returns_the_pos_selected_by_the_slug(self):
        with _fake_http_request(self.env, locked_slug="selected-pos"):
            pos_configs = self.env["pos.config"].search(
                [
                    ("id", "in", [self.selected_pos.id, self.other_pos.id]),
                ]
            )

        self.assertEqual(pos_configs, self.selected_pos)

    def test_search_is_not_filtered_without_locked_slug_cookie(self):
        with _fake_http_request(self.env):
            pos_configs = self.env["pos.config"].search(
                [
                    ("id", "in", [self.selected_pos.id, self.other_pos.id]),
                ]
            )

        self.assertEqual(pos_configs, self.selected_pos | self.other_pos)


@tagged("post_install", "-at_install")
class TestPosSlugAccessGuardHelper(TransactionCase):
    """Tests unitarios del resolutor de caja bloqueada, sin pasar por HTTP."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.locked_pos = cls.env["pos.config"].create(
            {
                "name": "Locked POS",
                "access_slug": "locked-pos",
            }
        )

    def test_returns_none_without_locked_slug_cookie(self):
        with _fake_http_request(self.env):
            self.assertIsNone(
                PosSlugAccessGuardController._get_slug_locked_pos_config()
            )

    def test_returns_none_for_unknown_slug(self):
        with _fake_http_request(self.env, locked_slug="does-not-exist"):
            self.assertIsNone(
                PosSlugAccessGuardController._get_slug_locked_pos_config()
            )

    def test_resolves_the_pos_config_matching_the_locked_slug(self):
        with _fake_http_request(self.env, locked_slug="locked-pos"):
            resolved = PosSlugAccessGuardController._get_slug_locked_pos_config()

        self.assertEqual(resolved, self.locked_pos)


@tagged("pos_conventional_core", "-standard", "post_install", "-at_install")
class TestPosSlugAccessIntegration(PosConventionalTestCommon, HttpCase):
    """Pruebas de extremo a extremo del flujo /pos/web/<slug>: un usuario con
    varias cajas permitidas debe quedar limitado a la caja del slug mientras
    el navegador conserve la cookie de bloqueo, tanto en el listado como al
    abrir la POS, y ese bloqueo debe ser independiente de la sesión de
    login (sobrevive a logout/login, no depende de request.session)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        # cls.pos_config (de PosConventionalTestCommon) hace de caja "A":
        # la caja a la que se accede por el slug, ya lista para abrir sesión.
        cls.pos_config.access_slug = "caja-a"

        other_cash_journal = cls.env["account.journal"].create(
            {
                "name": "Caja Test POS B",
                "type": "cash",
                "code": "CBSLUG",
                "company_id": cls.env.company.id,
            }
        )
        cls.other_pm = cls.env["pos.payment.method"].create(
            {
                "name": "Efectivo Caja B",
                "journal_id": other_cash_journal.id,
                "is_cash_count": True,
            }
        )
        cls.other_config = cls.env["pos.config"].create(
            {
                "name": "Caja B",
                "access_slug": "caja-b",
                "payment_method_ids": [(6, 0, [cls.other_pm.id])],
            }
        )

        pos_user_group_ids = [
            (
                6,
                0,
                [
                    cls.env.ref("base.group_user").id,
                    cls.env.ref("point_of_sale.group_pos_user").id,
                ],
            ),
        ]
        cls.password = "pos_slug_test_1234"
        cls.pos_user = cls.env["res.users"].create(
            {
                "name": "Usuario Multi Caja",
                "login": "pos_slug_multi_user@example.com",
                "password": cls.password,
                "company_id": cls.env.company.id,
                "company_ids": [(6, 0, cls.env.company.ids)],
                "group_ids": pos_user_group_ids,
            }
        )
        cls.pos_user.allowed_pos_config_ids = [
            (6, 0, [cls.pos_config.id, cls.other_config.id]),
        ]

        cls.outsider = cls.env["res.users"].create(
            {
                "name": "Usuario Sin Acceso",
                "login": "pos_slug_outsider@example.com",
                "password": cls.password,
                "company_id": cls.env.company.id,
                "company_ids": [(6, 0, cls.env.company.ids)],
                "group_ids": pos_user_group_ids,
            }
        )
        # Sin allowed_pos_config_ids asignados: no ve ninguna caja.

    def test_unknown_slug_shows_friendly_error(self):
        self.authenticate(self.pos_user.login, self.password)

        response = self.url_open("/pos/web/does-not-exist")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Punto de venta no encontrado", response.text)

    def test_user_without_access_is_denied(self):
        self.authenticate(self.outsider.login, self.password)

        response = self.url_open("/pos/web/caja-a")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Acceso denegado", response.text)

    def test_valid_slug_redirects_to_pos_dashboard(self):
        self.authenticate(self.pos_user.login, self.password)

        response = self.url_open("/pos/web/caja-a", allow_redirects=False)

        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["Location"], "/odoo/point-of-sale")

    def test_valid_slug_sets_the_locked_slug_cookie(self):
        self.authenticate(self.pos_user.login, self.password)

        self.url_open("/pos/web/caja-a", allow_redirects=False)

        self.assertEqual(
            self.opener.cookies.get(POS_LOCKED_SLUG_COOKIE), "caja-a"
        )

    def test_slug_forces_pos_config_kanban_to_a_single_result(self):
        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        # Simula la petición RPC del kanban de POS tal y como la hace el
        # cliente web, dentro del MISMO navegador (misma cookie de bloqueo).
        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "model": "pos.config",
                "method": "search_read",
                "args": [[], ["id", "name"]],
                "kwargs": {},
            },
        }
        response = self.url_open("/web/dataset/call_kw", json=payload)
        result = response.json()["result"]

        self.assertEqual([r["id"] for r in result], [self.pos_config.id])

    def test_slug_forces_pos_session_search_to_a_single_result(self):
        """La cookie de bloqueo también debe ocultar las sesiones de otras
        cajas permitidas al usuario, no solo la lista de pos.config."""
        session_a = (
            self.env["pos.session"]
            .with_context(skip_auto_open=True)
            .create({"config_id": self.pos_config.id, "user_id": self.pos_user.id})
        )
        session_b = (
            self.env["pos.session"]
            .with_context(skip_auto_open=True)
            .create({"config_id": self.other_config.id, "user_id": self.pos_user.id})
        )

        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "model": "pos.session",
                "method": "search_read",
                "args": [
                    [("id", "in", [session_a.id, session_b.id])],
                    ["id"],
                ],
                "kwargs": {},
            },
        }
        response = self.url_open("/web/dataset/call_kw", json=payload)
        result = response.json()["result"]

        self.assertEqual([r["id"] for r in result], [session_a.id])

    def test_slug_forces_pos_order_search_to_a_single_result(self):
        """La cookie de bloqueo también debe ocultar los pedidos de otras
        cajas permitidas al usuario, no solo la lista de pos.config."""
        session_a = (
            self.env["pos.session"]
            .with_context(skip_auto_open=True)
            .create({"config_id": self.pos_config.id, "user_id": self.pos_user.id})
        )
        session_b = (
            self.env["pos.session"]
            .with_context(skip_auto_open=True)
            .create({"config_id": self.other_config.id, "user_id": self.pos_user.id})
        )
        (session_a | session_b).write({"state": "opened"})

        order_a = (
            self.env["pos.order"]
            .with_context(skip_completeness_check=True)
            .create({"session_id": session_a.id, "company_id": self.env.company.id})
        )
        order_b = (
            self.env["pos.order"]
            .with_context(skip_completeness_check=True)
            .create({"session_id": session_b.id, "company_id": self.env.company.id})
        )

        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "model": "pos.order",
                "method": "search_read",
                "args": [
                    [("id", "in", [order_a.id, order_b.id])],
                    ["id"],
                ],
                "kwargs": {},
            },
        }
        response = self.url_open("/web/dataset/call_kw", json=payload)
        result = response.json()["result"]

        self.assertEqual([r["id"] for r in result], [order_a.id])

    def test_slug_forces_pos_payment_search_to_a_single_result(self):
        """La cookie de bloqueo también debe ocultar los pagos de otras
        cajas permitidas al usuario, no solo la lista de pos.config."""
        session_a = (
            self.env["pos.session"]
            .with_context(skip_auto_open=True)
            .create({"config_id": self.pos_config.id, "user_id": self.pos_user.id})
        )
        session_b = (
            self.env["pos.session"]
            .with_context(skip_auto_open=True)
            .create({"config_id": self.other_config.id, "user_id": self.pos_user.id})
        )
        (session_a | session_b).write({"state": "opened"})

        order_a = (
            self.env["pos.order"]
            .with_context(skip_completeness_check=True)
            .create({"session_id": session_a.id, "company_id": self.env.company.id})
        )
        order_b = (
            self.env["pos.order"]
            .with_context(skip_completeness_check=True)
            .create({"session_id": session_b.id, "company_id": self.env.company.id})
        )

        payment_method_a = session_a.config_id.payment_method_ids[:1]
        payment_a = self.env["pos.payment"].create(
            {
                "pos_order_id": order_a.id,
                "amount": 10.0,
                "payment_method_id": payment_method_a.id,
            }
        )
        payment_b = self.env["pos.payment"].create(
            {
                "pos_order_id": order_b.id,
                "amount": 10.0,
                "payment_method_id": self.other_pm.id,
            }
        )

        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "model": "pos.payment",
                "method": "search_read",
                "args": [
                    [("id", "in", [payment_a.id, payment_b.id])],
                    ["id"],
                ],
                "kwargs": {},
            },
        }
        response = self.url_open("/web/dataset/call_kw", json=payload)
        result = response.json()["result"]

        self.assertEqual([r["id"] for r in result], [payment_a.id])

    def test_switching_to_another_allowed_slug_is_not_blocked_by_the_old_lock(self):
        """Regresión: pos.config._search se invoca también, internamente,
        dentro de comprobaciones de acceso ajenas (p. ej. leer
        allowed_pos_config_ids vía sudo()). Si el filtro por cookie se
        aplicase también ahí, un usuario con acceso legítimo a las dos
        cajas se quedaría sin poder cambiar de la primera a la segunda,
        porque su propia comprobación de permisos se vería contaminada por
        la cookie de la caja ya bloqueada."""
        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        response = self.url_open("/pos/web/caja-b", allow_redirects=False)

        self.assertEqual(response.status_code, 303)
        self.assertNotIn("Acceso denegado", response.text)
        self.assertEqual(response.headers["Location"], "/odoo/point-of-sale")

    def test_locked_user_cannot_open_a_different_allowed_pos_config(self):
        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        sessions_before = self.env["pos.session"].search_count(
            [("config_id", "=", self.other_config.id)]
        )

        response = self.url_open(f"/pos/ui/{self.other_config.id}")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Acceso restringido", response.text)
        sessions_after = self.env["pos.session"].search_count(
            [("config_id", "=", self.other_config.id)]
        )
        self.assertEqual(sessions_before, sessions_after)

    def test_locked_user_generic_entry_opens_the_locked_pos_config(self):
        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        # Sesión ya abierta de antemano para la caja B, simulando que el
        # usuario la usó en algún momento anterior con este mismo login.
        other_session = (
            self.env["pos.session"]
            .with_context(skip_auto_open=True)
            .create({"config_id": self.other_config.id, "user_id": self.pos_user.id})
        )
        other_session.write({"state": "opened"})

        response = self.url_open("/pos/web")

        self.assertEqual(response.status_code, 200)
        self.assertIn(self.pos_config.access_token, response.text)
        self.assertNotIn(self.other_config.access_token, response.text)

    def test_visiting_another_slug_in_the_same_browser_overwrites_the_lock(self):
        """Un mismo navegador puede pasar de una caja a otra sin más que
        visitar el otro link: la cookie se sobreescribe con el último slug
        usado, no queda mezcla ni bloqueo cruzado."""
        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")
        self.url_open("/pos/web/caja-b")

        self.assertEqual(
            self.opener.cookies.get(POS_LOCKED_SLUG_COOKIE), "caja-b"
        )

        # Ahora la caja A (la primera visitada) queda restringida...
        response = self.url_open(f"/pos/ui/{self.pos_config.id}")
        self.assertIn("Acceso restringido", response.text)

        # ...y la B (la última visitada) es la que se abre.
        response = self.url_open("/pos/web")
        self.assertIn(self.other_config.access_token, response.text)
        self.assertNotIn(self.pos_config.access_token, response.text)

    def test_lock_survives_logout_and_login_in_the_same_browser(self):
        """La cookie de bloqueo no depende de request.session: a diferencia
        del mecanismo anterior, un logout/login del mismo usuario en el
        mismo navegador no debe hacer que el bloqueo desaparezca."""
        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")
        locked_slug_cookie = self.opener.cookies.get(POS_LOCKED_SLUG_COOKIE)
        self.assertEqual(locked_slug_cookie, "caja-a")

        self.logout()
        # self.authenticate() recrea el "opener" (simulando una sesión de
        # login nueva), igual que haría un logout/login real respecto al
        # session_id; a diferencia del session_id, la cookie de bloqueo la
        # pone y la lee esta app, no el framework de sesión, así que en un
        # navegador real seguiría presente. Lo simulamos reinyectándola.
        self.authenticate(self.pos_user.login, self.password)
        self.opener.cookies.set(POS_LOCKED_SLUG_COOKIE, locked_slug_cookie)

        response = self.url_open(f"/pos/ui/{self.other_config.id}")
        self.assertIn("Acceso restringido", response.text)
