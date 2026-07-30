from odoo import models, fields


class ResUsers(models.Model):
    _inherit = 'res.users'

    require_attendance = fields.Boolean(
        string='Requiere entrada de asistencia',
        help='Si está marcado, al iniciar sesión se requiere que el usuario haga la entrada de asistencia mediante el wizard.',
        default=True,
    )

