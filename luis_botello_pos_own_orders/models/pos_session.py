from odoo import models


class PosSession(models.Model):
    _inherit = 'pos.session'

    def _get_closed_orders(self):
        # El cierre de caja (efectivo esperado, totales por método de pago,
        # asiento contable) debe incluir los pedidos de todos los cajeros de la
        # sesión, aunque la regla de registro oculte los ajenos al usuario.
        return super(PosSession, self.sudo())._get_closed_orders()
