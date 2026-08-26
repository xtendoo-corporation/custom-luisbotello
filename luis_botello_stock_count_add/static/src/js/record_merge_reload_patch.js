/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Record } from "@web/model/relational_model/record";

/**
 * Cuando se añade una nueva línea de conteo ("Add a line") para un producto
 * que ya tenía otra línea visible en la lista de Conteo de stock, el
 * servidor fusiona ambos `stock.quant` en uno solo (ver
 * `stock_quant_merge.py`). Tras guardar, el registro recién creado en el
 * navegador pasa a compartir el mismo `resId` que la fila ya existente:
 * quedan dos objetos `Record` distintos apuntando al mismo registro de
 * base de datos, con la MISMA clave (`resId`) en la lista.
 *
 * Esa duplicidad de clave rompe la reconciliación por clave de OWL en el
 * listado: aunque los valores del registro recién guardado son correctos
 * (ver `_updateSimilarRecords`, parcheado en este mismo módulo), la fila
 * "antigua" puede quedar visualmente inconsistente entre columnas (p.ej.
 * "Contado" desactualizado frente a "Diferencia" ya recalculada), ya que
 * ambas filas comparten clave mientras existan como registros distintos.
 *
 * Para eliminar la causa raíz, en lugar de intentar sincronizar celda a
 * celda, forzamos una recarga completa de la lista en cuanto se detecta
 * que el `resId` de un registro recién creado ya existe en otra fila
 * cargada. Así sólo queda una fila por `stock.quant`, con los valores
 * definitivos leídos del servidor.
 */
patch(Record.prototype, {
    async save(options) {
        const wasNew = !this.resId;
        const result = await super.save(options);
        if (result && wasNew && this.resId) {
            const records = this.model.root.records;
            const hasDuplicate =
                Array.isArray(records) &&
                records.some((record) => record !== this && record.resId === this.resId);
            if (hasDuplicate) {
                await this.model.load();
            }
        }
        return result;
    },
});
