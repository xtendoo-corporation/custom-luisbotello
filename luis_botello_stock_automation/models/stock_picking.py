from odoo import models, api, fields

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    next_picking_type_id = fields.Many2one(
        'stock.picking.type',
        string='Siguiente tipo de operación',
        help="Si se selecciona un tipo de operación, se creará un albarán equivalente al confirmar este."
    )

    parent_picking_id = fields.Many2one(
        'stock.picking',
        string='Albarán de origen (Auto)',
        readonly=True,
        help="Albarán que generó automáticamente este registro"
    )

    child_picking_ids = fields.One2many(
        'stock.picking',
        'parent_picking_id',
        string='Albaranes generados'
    )

    child_picking_count = fields.Integer(compute='_compute_child_picking_count')

    def _compute_child_picking_count(self):
        for picking in self:
            picking.child_picking_count = len(picking.child_picking_ids)

    def action_view_child_pickings(self):
        self.ensure_one()
        action = self.env.ref('stock.action_picking_tree_all').read()[0]
        action['domain'] = [('id', 'in', self.child_picking_ids.ids)]
        action['context'] = {'default_parent_picking_id': self.id}
        return action

    def action_view_parent_picking(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'stock.picking',
            'res_id': self.parent_picking_id.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def button_validate(self):
        # Primero validamos el albarán actual
        res = super(StockPicking, self).button_validate()

        # Después de validar, si el estado es 'done', procesamos los movimientos para crear los siguientes
        for picking in self:
            if picking.state == 'done':
                picking._create_next_pickings()
        return res

    def _create_next_pickings(self):
        for picking in self:
            # Determinamos los movimientos a procesar:
            # Si el picking tiene un next_picking_type_id, se aplica a todos sus movimientos
            # Si no, se mira línea por línea.
            moves_to_process = picking.move_ids

            moves_by_type = {}
            for move in moves_to_process:
                # Prioridad: 1. El del movimiento, 2. El del albarán
                pt = move.next_picking_type_id or picking.next_picking_type_id
                if not pt:
                    continue

                pt_id = pt.id
                if pt_id not in moves_by_type:
                    moves_by_type[pt_id] = self.env['stock.move']
                moves_by_type[pt_id] |= move

            for pt_id, moves in moves_by_type.items():
                picking_type = self.env['stock.picking.type'].browse(pt_id)

                # Creamos el nuevo albarán dejando que Odoo aplique la secuencia oficial
                new_picking = self.env['stock.picking'].create({
                    'picking_type_id': pt_id,
                    'location_id': picking_type.default_location_src_id.id or picking.location_dest_id.id,
                    'location_dest_id': picking_type.default_location_dest_id.id or picking.location_dest_id.id,
                    'origin': picking.name,
                    'parent_picking_id': picking.id,
                })

                # Creamos los movimientos para el nuevo albarán
                for move in moves:
                    # Determinamos la cantidad a mover (usamos la cantidad validada del movimiento original)
                    qty = move.quantity if hasattr(move, 'quantity') else move.product_uom_qty

                    self.env['stock.move'].create({
                        'product_id': move.product_id.id,
                        'product_uom_qty': qty,
                        'product_uom': move.product_uom.id,
                        'description_picking': move.description_picking or move.product_id.display_name,
                        'picking_id': new_picking.id,
                        'location_id': new_picking.location_id.id,
                        'location_dest_id': new_picking.location_dest_id.id,
                        'origin': picking.name,
                    })

                # Confirmar y asignar el nuevo albarán para que quede listo si es posible
                new_picking.action_confirm()
                new_picking.action_assign()
