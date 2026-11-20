/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { PivotModel } from "@web/views/pivot/pivot_model";

// Añade al export a Excel del análisis de pedidos TPV el campo y el id de cada
// fila, para que el servidor pueda separar código y nombre de producto.
patch(PivotModel.prototype, {
    exportData() {
        const data = super.exportData(...arguments);
        if (this.metaData.resModel === "report.pos.order") {
            const groupBys = this.metaData.fullRowGroupBys.map((g) => g.split(":")[0]);
            const rows = this.getTable().rows;
            data.row_group_bys = groupBys;
            rows.forEach((row, i) => {
                if (row.indent > 0 && data.rows[i]) {
                    data.rows[i].field = groupBys[row.indent - 1];
                    data.rows[i].res_id = row.groupId[0][row.indent - 1];
                }
            });
        }
        return data;
    },
});
