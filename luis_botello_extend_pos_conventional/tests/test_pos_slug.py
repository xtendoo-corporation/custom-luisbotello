from types import SimpleNamespace
from unittest import TestCase, mock

from odoo.tests.common import SavepointCase

from ..controllers.main import PosSlugController


class TestPosSlugController(TestCase):

    def test_slug_opens_the_selected_pos_configuration(self):
        pos_config = SimpleNamespace(id=42)

        url = PosSlugController._get_pos_conventional_url(pos_config)

        self.assertEqual(url, '/odoo/point-of-sale')


class TestPosConfigSlugFilter(SavepointCase):

    def test_search_only_returns_the_pos_selected_by_the_slug(self):
        selected_pos = self.env['pos.config'].create({
            'name': 'Selected POS',
            'access_slug': 'selected-pos',
        })
        other_pos = self.env['pos.config'].create({
            'name': 'Other POS',
            'access_slug': 'other-pos',
        })

        request = SimpleNamespace(session={'active_pos_slug': 'selected-pos'})
        with mock.patch('odoo.http.request', request):
            pos_configs = self.env['pos.config'].search([
                ('id', 'in', [selected_pos.id, other_pos.id]),
            ])

        self.assertEqual(len(pos_configs), 1)
        self.assertEqual(pos_configs.id, selected_pos.id)
        self.assertNotIn(other_pos.id, pos_configs.ids)
