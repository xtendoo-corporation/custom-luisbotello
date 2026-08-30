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
        if (isInventoryCount(this) && this._inventoryQuickFocusProduct) {
            const productColumn = getColumn(this, "product_id");
            if (productColumn) {
                column = productColumn;
            }
            this._inventoryQuickFocusProduct = false;
        }
        return super.focusCell(column, forward);
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
