import contextlib
from types import SimpleNamespace

import odoo.http
from odoo.tests.common import HttpCase, TransactionCase, tagged

from odoo.addons.pos_conventional_core.tests.common import PosConventionalTestCommon

from ..controllers.main import PosSlugAccessGuardController, PosSlugController


@contextlib.contextmanager
def _fake_http_request(env, active_pos_slug=None):
    """Empuja un odoo.http.request falso en la pila real de Odoo, con el
    env y el slug activo indicados. Es el mismo mecanismo (_request_stack)
    que usa un request HTTP real, por lo que también cubre correctamente el
    ``from odoo.http import request`` local de pos.config._search."""
    session = {}
    if active_pos_slug:
        session["active_pos_slug"] = active_pos_slug
    fake_request = SimpleNamespace(session=session, env=env)
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
    mostrar la caja fijada por el slug activo en la sesión."""

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
        with _fake_http_request(self.env, active_pos_slug="selected-pos"):
            pos_configs = self.env["pos.config"].search(
                [
                    ("id", "in", [self.selected_pos.id, self.other_pos.id]),
                ]
            )

        self.assertEqual(pos_configs, self.selected_pos)

    def test_search_is_not_filtered_without_active_slug(self):
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

    def test_returns_none_without_active_slug(self):
        with _fake_http_request(self.env):
            self.assertIsNone(
                PosSlugAccessGuardController._get_slug_locked_pos_config()
            )

    def test_returns_none_for_unknown_slug(self):
        with _fake_http_request(self.env, active_pos_slug="does-not-exist"):
            self.assertIsNone(
                PosSlugAccessGuardController._get_slug_locked_pos_config()
            )

    def test_resolves_the_pos_config_matching_the_active_slug(self):
        with _fake_http_request(self.env, active_pos_slug="locked-pos"):
            resolved = PosSlugAccessGuardController._get_slug_locked_pos_config()

        self.assertEqual(resolved, self.locked_pos)


@tagged("pos_conventional_core", "-standard", "post_install", "-at_install")
class TestPosSlugAccessIntegration(PosConventionalTestCommon, HttpCase):
    """Pruebas de extremo a extremo del flujo /pos/web/<slug>: un usuario con
    varias cajas permitidas debe quedar limitado a la caja del slug mientras
    dure su sesión de navegador, tanto en el listado como al abrir la POS."""

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

    def test_slug_forces_pos_config_kanban_to_a_single_result(self):
        self.authenticate(self.pos_user.login, self.password)
        self.url_open("/pos/web/caja-a")

        # Simula la petición RPC del kanban de POS tal y como la hace el
        # cliente web, dentro de la MISMA sesión de navegador ya "fijada".
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
