/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { RelationalModel } from "@web/model/relational_model/relational_model";

/**
 * Cuando se cuenta un producto que ya tenía un conteo previo en la misma
 * sesión (mismo product_id/location_id/lot_id/package_id/owner_id), el
 * módulo `luis_botello_stock_count_add` fusiona ambos registros en el mismo
 * `stock.quant` (ver `stock_quant_merge.py`), sumando las cantidades
 * contadas. El servidor devuelve correctamente el valor sumado.
 *
 * Sin embargo, en la vista de "Conteo de stock" (no agrupada por defecto),
 * el método nativo `_updateSimilarRecords` sólo sincroniza otras filas que
 * comparten el mismo `resId` cuando la lista está agrupada
 * (`this.config.groupBy.length`). Al añadir una nueva línea para un producto
 * ya presente en la lista, la fila original (aún visible, sin recargar)
 * queda con el valor "Contado" desactualizado, mientras que el campo
 * calculado y almacenado "Diferencia" puede refrescarse igualmente al
 * recargarse la vista, generando la incoherencia reportada por el usuario.
 *
 * Este parche elimina la restricción de agrupación para que, tras guardar,
 * cualquier otra fila cargada que apunte al mismo registro se sincronice con
 * los valores recién persistidos, sea la lista agrupada o no.
 */
patch(RelationalModel.prototype, {
    _updateSimilarRecords(reloadedRecord, serverValues) {
        if (this.config.isMonoRecord) {
            return;
        }
        for (const record of this.root.records) {
            if (record === reloadedRecord) {
                continue;
            }
            if (record.resId === reloadedRecord.resId) {
                record._applyValues(serverValues);
            }
        }
    },
});
