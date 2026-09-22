/** @odoo-module **/

import { useExternalListener } from "@odoo/owl";
import { patch } from "@web/core/utils/patch";
import { getActiveHotkey } from "@web/core/hotkeys/hotkey_service";
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

/**
 * Campo al que se debe saltar el foco tras completar Producto o Lote: Lote
 * si el producto recién seleccionado se rastrea por lote/serie, si no
 * Cantidad. Compartido entre el salto estándar (TAB/ENTER) y el salto
 * forzado tras un escaneo (ver `scheduleInventoryScanFocusRedirect`).
 */
function getNextFieldAfterProductOrLot(fieldName, record) {
    return fieldName === "product_id" && ["lot", "serial"].includes(record.data.tracking)
        ? "lot_id"
        : "inventory_quantity";
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
    setup() {
        super.setup(...arguments);
        // Token para invalidar reintentos de saltos de foco pendientes de
        // una línea (ver `scheduleInventoryScanFocusRedirect`) si el usuario
        // ya ha pasado a otra línea/celda antes de que se complete el
        // escaneo en curso.
        this._inventoryScanRedirectToken = 0;
        useExternalListener(document, "keydown", this.onInventoryScanKeydownCapture, true);
    },

    /**
     * Al escanear un producto (o un lote) con un lector de código de
     * barras, éste actúa como un teclado que escribe el código y termina
     * con ENTER. Cuando ese texto coincide con una sugerencia del
     * desplegable de autocompletado del campo Producto/Lote, el propio
     * widget `AutoComplete` la selecciona y detiene la propagación de ese
     * ENTER (`stopPropagation`) antes de que llegue a `onCellKeydownEditMode`
     * (más abajo), que es quien normalmente mueve el foco a Cantidad. El
     * resultado percibido es que, tras escanear, el foco se queda en
     * Producto/Lote en lugar de saltar a Cantidad.
     *
     * Para solucionarlo sin tocar el resto de flujos (clic de ratón, TAB, o
     * ENTER sin ninguna sugerencia activa, que ya funcionan tal cual), se
     * escucha el ENTER en fase de captura -antes de que `AutoComplete`
     * pueda detener su propagación- y se programa un salto de foco que sólo
     * se ejecuta si el salto estándar no se ha producido ya.
     */
    onInventoryScanKeydownCapture(ev) {
        if (!isInventoryCount(this) || !this.editedRecord) {
            return;
        }
        if (getActiveHotkey(ev) !== "enter") {
            return;
        }
        const cell = ev.target.closest("td[name]");
        if (!cell) {
            return;
        }
        const fieldName = cell.getAttribute("name");
        if (fieldName !== "product_id" && fieldName !== "lot_id") {
            return;
        }
        this.scheduleInventoryScanFocusRedirect(this.editedRecord, fieldName, cell);
    },

    scheduleInventoryScanFocusRedirect(record, fieldName, cell) {
        const recordId = record.id;
        const token = ++this._inventoryScanRedirectToken;
        const maxAttempts = 20;
        const retryDelayMs = 50;
        const tryRedirect = (attempt) => {
            if (
                token !== this._inventoryScanRedirectToken ||
                this.editedRecord?.id !== recordId
            ) {
                return;
            }
            if (document.activeElement && !cell.contains(document.activeElement)) {
                // El flujo estándar (TAB, o ENTER sin sugerencia activa) ya
                // ha movido el foco: no hay nada más que hacer.
                return;
            }
            if (!this.editedRecord.data[fieldName]) {
                // El valor aún no se ha fijado (búsqueda/`onchange` en
                // curso, o no hubo coincidencia): seguimos esperando un
                // tiempo acotado antes de desistir en silencio.
                if (attempt < maxAttempts) {
                    setTimeout(() => tryRedirect(attempt + 1), retryDelayMs);
                }
                return;
            }
            const nextField = getNextFieldAfterProductOrLot(fieldName, this.editedRecord);
            const column = getColumn(this, nextField);
            if (column && !this.isCellReadonly(column, this.editedRecord)) {
                this.focusCell(column);
            }
        };
        setTimeout(() => tryRedirect(0), 0);
    },

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
            const nextField = getNextFieldAfterProductOrLot(fieldName, record);
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
