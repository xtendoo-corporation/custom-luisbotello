from types import SimpleNamespace
from unittest import TestCase

from ..controllers.main import PosSlugController


class TestPosSlugController(TestCase):

    def test_slug_opens_the_selected_pos_configuration(self):
        pos_config = SimpleNamespace(id=42)

        url = PosSlugController._get_pos_conventional_url(pos_config)

        self.assertEqual(url, '/odoo/point-of-sale/42/pos-orders')
