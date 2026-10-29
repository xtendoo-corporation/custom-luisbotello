from odoo import _, api, models
from odoo.exceptions import UserError


class PosSession(models.Model):
    _inherit = 'pos.session'

    def _check_attendance_required(self):
        user = self.env.user
        if self.env.context.get('skip_attendance_check') or user.id == 1:
            return
        if user._attendance_missing():
            raise UserError(_(
                "Debes registrar tu entrada de asistencia antes de abrir el TPV. "
                "Ve al menú de Asistencias, ficha la entrada y vuelve a intentarlo."
            ))

    @api.model_create_multi
    def create(self, vals_list):
        self._check_attendance_required()
        return super().create(vals_list)

    def open_frontend_cb(self):
        self._check_attendance_required()
        return super().open_frontend_cb()
