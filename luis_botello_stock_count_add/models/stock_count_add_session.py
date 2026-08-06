from odoo import _, api, fields, models
from odoo.exceptions import UserError


class StockCountAddSession(models.TransientModel):
    """Sesión de conteo ADITIVO de inventario.

    Vive durante todo el conteo (mientras el asistente permanezca abierto) y
    mantiene el conjunto de quants ya tocados en la sesión (``touched_quant_ids``)
    para decidir entre FIJAR (primer toque) y SUMAR (toques posteriores).

    El módulo escribe SOLO en ``inventory_quantity`` (contado) del quant, siempre
    en modo inventario (``inventory_mode=True``) y NUNCA aplica el inventario ni
    toca ``quantity`` (on-hand). El stock real solo cambia cuando el usuario pulsa
    Aplicar en la pantalla nativa de Inventario físico.
    """

    _name = "stock.count.add.session"
    _description = "Sesión de conteo aditivo de inventario"

    location_id = fields.Many2one(
        comodel_name="stock.location",
        string="Ubicación",
        required=True,
        domain="[('usage', 'in', ['internal', 'transit'])]",
        help="Ubicación de conteo. Se conserva entre entradas de la sesión.",
    )
    touched_quant_ids = fields.Many2many(
        comodel_name="stock.quant",
        string="Quants tocados en la sesión",
        help="Quants ya contados en ESTA sesión. Acota la acumulación al conteo "
        "en curso, ignorando conteos previos no aplicados.",
    )
    line_ids = fields.One2many(
        comodel_name="stock.count.add.line",
        inverse_name="session_id",
        string="Entradas de la sesión",
        readonly=True,
    )

    # Campos de entrada actual (se limpian tras cada confirmación).
    product_id = fields.Many2one(
        comodel_name="product.product",
        string="Producto",
        domain="[('is_storable', '=', True)]",
    )
    tracking = fields.Selection(
        related="product_id.tracking",
        string="Trazabilidad",
    )
    lot_id = fields.Many2one(
        comodel_name="stock.lot",
        string="Lote/Serie",
        domain="[('product_id', '=', product_id)]",
    )
    package_id = fields.Many2one(
        comodel_name="stock.package",
        string="Paquete",
    )
    qty = fields.Float(
        string="Cantidad encontrada",
        digits="Product Unit",
        default=1.0,
    )
    barcode = fields.Char(
        string="Código de barras",
        help="Campo para lector keyboard-wedge. Resuelve el código a producto, "
        "empaquetado (product.uom) o lote, y ajusta la cantidad.",
    )
    last_message = fields.Html(
        string="Resultado",
        readonly=True,
        help="Resultado de la última entrada confirmada, con el desglose del "
        "total acumulado cuando se suman cantidades.",
    )

    # ------------------------------------------------------------------
    # Barcode
    # ------------------------------------------------------------------
    @api.onchange("barcode")
    def _onchange_barcode(self):
        """Resuelve el código escaneado a producto/empaquetado/lote.

        Prioridad: producto -> empaquetado (``product.uom``) -> lote. Deja el
        código listo para que el usuario pulse Confirmar (no aplica nada).
        """
        code = (self.barcode or "").strip()
        if not code:
            return
        product = self.env["product.product"].search(
            [("barcode", "=", code)], limit=1
        )
        if product:
            self.product_id = product
            self.qty = 1.0
            self.barcode = False
            return
        packaging = self.env["product.uom"].search(
            [("barcode", "=", code)], limit=1
        )
        if packaging:
            product = packaging.product_id
            self.product_id = product
            self.qty = packaging.uom_id._compute_quantity(
                1.0, product.uom_id
            )
            self.barcode = False
            return
        lot = self.env["stock.lot"].search(
            ["|", ("name", "=", code), ("ref", "=", code)], limit=1
        )
        if lot:
            self.product_id = lot.product_id
            self.lot_id = lot
            self.qty = 1.0
            self.barcode = False
            return
        return {
            "warning": {
                "title": _("Código no encontrado"),
                "message": _("Ningún producto, empaquetado o lote con el código "
                             "'%s'.") % code,
            }
        }

    # ------------------------------------------------------------------
    # Confirmar / Finalizar
    # ------------------------------------------------------------------
    def action_confirm(self):
        """Añade la cantidad encontrada al conteo del quant correspondiente.

        - Primer toque del quant en la sesión -> FIJAR (descarta contado obsoleto).
        - Toques posteriores del mismo quant -> SUMAR.
        Todo en modo inventario y sin aplicar.
        """
        self.ensure_one()
        self._check_input()
        product = self.product_id
        location = self.location_id
        lot = self.lot_id
        added = self.qty
        quant, was_summed, previous_qty = self._set_counted_quantity()
        self._log_entry(quant)
        message = self._build_result_message(
            product, location, lot, added, was_summed, previous_qty,
            quant.inventory_quantity,
        )
        return self._reopen_action(message)

    def action_finish(self):
        """Cierra la sesión y abre el Inventario físico filtrado por lo contado."""
        self.ensure_one()
        quant_ids = self.touched_quant_ids.ids
        action = {
            "type": "ir.actions.act_window",
            "name": _("Inventario físico (conteo aditivo)"),
            "res_model": "stock.quant",
            "view_mode": "list",
            "target": "current",
            "context": {"inventory_mode": True},
        }
        list_view = self.env.ref(
            "stock.view_stock_quant_tree_inventory_editable", False
        )
        if list_view:
            action["views"] = [(list_view.id, "list")]
        if quant_ids:
            action["domain"] = [("id", "in", quant_ids)]
        else:
            action["domain"] = [("id", "=", False)]
        return action

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _check_input(self):
        self.ensure_one()
        if not self.location_id:
            raise UserError(_("Selecciona una ubicación de conteo."))
        if not self.product_id:
            raise UserError(_("Selecciona o escanea un producto."))
        if self.qty <= 0:
            raise UserError(_("La cantidad encontrada debe ser mayor que cero."))
        if self.tracking in ("lot", "serial") and not self.lot_id:
            raise UserError(
                _("El producto '%s' requiere lote/serie.")
                % self.product_id.display_name
            )
        if self.lot_id and self.lot_id.product_id != self.product_id:
            raise UserError(
                _("El lote '%s' no pertenece al producto '%s'.")
                % (self.lot_id.display_name, self.product_id.display_name)
            )

    def _quant_domain(self):
        return self.product_id, self.location_id, self.lot_id, self.package_id

    def _set_counted_quantity(self):
        """Localiza (o crea) el quant en modo inventario y fija/suma el contado.

        Se escribe únicamente ``inventory_quantity``; el core marca
        ``inventory_quantity_set`` automáticamente y NO aplica el inventario.
        """
        self.ensure_one()
        quant_model = self.env["stock.quant"].with_context(inventory_mode=True)
        product, location, lot, package = self._quant_domain()
        quant = quant_model._gather(
            product, location, lot_id=lot, package_id=package, strict=True
        )
        if lot:
            quant = quant.filtered(lambda q: q.lot_id == lot)
        quant = quant[:1]

        if quant and quant in self.touched_quant_ids:
            was_summed = True
            previous_qty = quant.inventory_quantity
            counted = previous_qty + self.qty
        else:
            was_summed = False
            previous_qty = 0.0
            counted = self.qty

        if quant:
            quant.inventory_quantity = counted
        else:
            quant = quant_model.create(
                {
                    "product_id": product.id,
                    "location_id": location.id,
                    "lot_id": lot.id or False,
                    "package_id": package.id or False,
                    "inventory_quantity": counted,
                }
            )
        self.touched_quant_ids = [(4, quant.id)]
        return quant, was_summed, previous_qty

    def _format_qty(self, value):
        text = "{:.3f}".format(value or 0.0).rstrip("0").rstrip(".")
        return text or "0"

    def _build_result_message(self, product, location, lot, added,
                              was_summed, previous_qty, total_qty):
        """Construye el aviso HTML mostrado tras confirmar una entrada."""
        added_txt = self._format_qty(added)
        total_txt = self._format_qty(total_qty)
        lot_txt = _(" · Lote %s") % lot.display_name if lot else ""
        header = _("%(product)s · %(location)s%(lot)s") % {
            "product": product.display_name,
            "location": location.display_name,
            "lot": lot_txt,
        }
        if was_summed:
            previous_txt = self._format_qty(previous_qty)
            detail = _(
                "Se SUMARON %(added)s uds. Total: existían %(previous)s + "
                "encontradas %(added)s = <strong>%(total)s uds</strong>."
            ) % {
                "added": added_txt,
                "previous": previous_txt,
                "total": total_txt,
            }
            alert = "alert-success"
        else:
            detail = _(
                "Cantidad FIJADA: <strong>%(total)s uds</strong>."
            ) % {"total": total_txt}
            alert = "alert-info"
        return (
            '<div class="alert %s mb-0" role="alert">'
            '<div class="small text-muted">%s</div>%s</div>'
        ) % (alert, header, detail)

    def _log_entry(self, quant):
        self.env["stock.count.add.line"].create(
            {
                "session_id": self.id,
                "product_id": self.product_id.id,
                "location_id": self.location_id.id,
                "lot_id": self.lot_id.id or False,
                "package_id": self.package_id.id or False,
                "qty": self.qty,
                "result_qty": quant.inventory_quantity,
            }
        )

    def _reopen_action(self, message=False):
        """Reabre el MISMO registro limpiando solo los campos de entrada."""
        self.write(
            {
                "product_id": False,
                "lot_id": False,
                "package_id": False,
                "qty": 1.0,
                "barcode": False,
                "last_message": message or False,
            }
        )
        return {
            "type": "ir.actions.act_window",
            "name": _("Conteo aditivo"),
            "res_model": self._name,
            "res_id": self.id,
            "view_mode": "form",
            "target": "new",
            "context": self.env.context,
        }
