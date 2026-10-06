from odoo import Command
from odoo.tests import tagged

from odoo.addons.point_of_sale.tests.common import TestPoSCommon


@tagged('post_install', '-at_install')
class TestReportPosOrderSupplier(TestPoSCommon):

    def test_supplier_is_main_vendor_and_rows_not_duplicated(self):
        vendor_a = self.env['res.partner'].create({'name': 'Vendor A'})
        vendor_b = self.env['res.partner'].create({'name': 'Vendor B'})
        product = self.create_product('Supplier product', self.categ_basic, 100)
        product.product_tmpl_id.write({'seller_ids': [
            Command.create({'partner_id': vendor_b.id, 'sequence': 2, 'price': 4}),
            Command.create({'partner_id': vendor_a.id, 'sequence': 1, 'price': 5}),
        ]})
        self.config = self.basic_config
        self.open_new_session()
        order = self.env['pos.order'].create({
            'session_id': self.pos_session.id,
            'lines': [Command.create({
                'name': 'OL/0001',
                'product_id': product.id,
                'price_unit': 100,
                'qty': 1.0,
                'tax_ids': [],
                'price_subtotal': 100,
                'price_subtotal_incl': 100,
            })],
            'amount_total': 100,
            'amount_tax': 0,
            'amount_paid': 0,
            'amount_return': 0,
        })
        self.env.flush_all()
        rows = self.env['report.pos.order'].search([('order_id', '=', order.id)])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows.supplier_id, vendor_a)
