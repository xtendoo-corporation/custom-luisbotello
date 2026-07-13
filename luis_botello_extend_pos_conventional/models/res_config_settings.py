from odoo import fields, models

class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    pos_access_slug = fields.Char(
        related="pos_config_id.access_slug",
        readonly=False,
        string="URL de acceso",
    )

    pos_access_url = fields.Char(
        related="pos_config_id.access_url",
        readonly=True,
        string="Enlace de acceso",
    )
