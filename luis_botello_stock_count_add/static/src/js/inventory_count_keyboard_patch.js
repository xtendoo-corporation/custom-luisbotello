/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ListRenderer } from "@web/views/list/list_renderer";
import {
    InventoryReportListDynamicRecordList,
    InventoryReportListModel,
} from "@stock/views/list/inventory_report_list_model";

function isInventoryCount(renderer) {
    const model = renderer.props.list.model;
    return (
        model instanceof InventoryReportListModel &&
        model.root.resModel === "stock.quant" &&
        model.root.context?.inventory_mode === true
    );
}

function getColumn(renderer, name) {
    return renderer.columns.find((column) => column.type === "field" && column.name === name);
}

function getLocationId(value) {
    return value?.id || value?.[0] || (typeof value === "number" ? value : false);
}

/**
 * `scrollIntoView` sólo garantiza alinear el elemento con el contenedor
 * scrollable más cercano; si hay contenedores anidados (p.ej. `.o_content`,
 * que es el que realmente scrollea en el layout de Odoo) puede quedarse a
 * medias. Para asegurar que la línea nueva queda visible del todo, se busca
 * el contenedor scrollable real y se fuerza al final (`scrollHeight`).
 */
function getScrollParent(el) {
    let parent = el?.parentElement;
    while (parent) {
        const { overflowY } = getComputedStyle(parent);
        if (
            (overflowY === "auto" || overflowY === "scroll") &&
            parent.scrollHeight > parent.clientHeight
        ) {
            return parent;
        }
        parent = parent.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

patch(InventoryReportListDynamicRecordList.prototype, {
    async addNewRecord(...args) {
        if (
            !(this.model instanceof InventoryReportListModel) ||
            this.model.root.context?.inventory_mode !== true
        ) {
            return super.addNewRecord(...args);
        }
        const locationId =
            [...this.records]
            .reverse()
            .map((record) => getLocationId(record.data.location_id))
            .find(Boolean) || this.model._lastLocationId;
        const record = await super.addNewRecord(...args);
        if (locationId && !getLocationId(record.data.location_id)) {
            await record.update({ location_id: { id: locationId } });
        }
        const newLocationId = getLocationId(record.data.location_id);
        if (newLocationId) {
            this.model._lastLocationId = newLocationId;
        }
        return record;
    },
});

patch(ListRenderer.prototype, {
    focusCell(column, forward = true) {
        // Se marca sólo cuando el foco recae en Producto de una línea que
        // acaba de crearse (`isNew`), para hacer scroll hasta el final de la
        // lista y que la línea nueva quede visible.
        let scrollNewRecordIntoView = false;
        if (isInventoryCount(this)) {
            const isNewRecord = Boolean(this.editedRecord?.isNew);
            if (this._inventoryQuickFocusProduct) {
                const productColumn = getColumn(this, "product_id");
                if (productColumn) {
                    column = productColumn;
                }
                this._inventoryQuickFocusProduct = false;
                scrollNewRecordIntoView = isNewRecord;
            } else if (
                // Foco por defecto tras crear una línea nueva (sin click del
                // usuario de por medio: `cellToFocus` no está fijado). Como la
                // ubicación ya se autocompleta en `addNewRecord`, saltamos
                // directamente a Producto en vez de dejar el foco en Ubicación
                // (1ª columna de la vista).
                !this.cellToFocus &&
                this.editedRecord &&
                !this.editedRecord.data.product_id &&
                column === this.columns[0]
            ) {
                const productColumn = getColumn(this, "product_id");
                if (productColumn && !this.isCellReadonly(productColumn, this.editedRecord)) {
                    column = productColumn;
                    scrollNewRecordIntoView = isNewRecord;
                }
            }
        }
        super.focusCell(column, forward);
        if (scrollNewRecordIntoView) {
            const scrollParent = getScrollParent(document.activeElement);
            if (scrollParent) {
                scrollParent.scrollTop = scrollParent.scrollHeight;
            }
        }
    },

    onCellKeydownEditMode(hotkey, cell, group, record) {
        if (!isInventoryCount(this) || !record) {
            return super.onCellKeydownEditMode(...arguments);
        }

        const fieldName = cell.getAttribute("name");
        if (
            ["tab", "enter"].includes(hotkey) &&
            (fieldName === "product_id" || fieldName === "lot_id")
        ) {
            const nextField =
                fieldName === "product_id" &&
                ["lot", "serial"].includes(record.data.tracking)
                    ? "lot_id"
                    : "inventory_quantity";
            const column = getColumn(this, nextField);
            if (column && !this.isCellReadonly(column, record)) {
                this.focusCell(column);
                return true;
            }
        }

        if (hotkey === "enter" && fieldName === "inventory_quantity") {
            // Keep the standard validation/save flow and only redirect its focus.
            this._inventoryQuickFocusProduct = true;
        }

        return super.onCellKeydownEditMode(...arguments);
    },
});
