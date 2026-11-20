import io
import json
from copy import copy

from werkzeug.datastructures import FileStorage

from odoo import http
from odoo.http import request

from odoo.addons.web.controllers.pivot import TableExporter

INDENT = '     '


def add_product_code_column(jdata, codes_by_product):
    """Devuelve ``jdata`` con el código de producto en la columna A y el
    nombre en la columna B. Si no hay filas de producto, no cambia nada.

    Las filas agrupadas por código se eliminan (el código ya va en la columna A
    de la fila del producto, que lleva los mismos valores).
    """
    rows = jdata.get('rows', [])
    if not any(r.get('field') == 'product_id' and r.get('res_id') for r in rows):
        return jdata
    code_levels = [
        i for i, f in enumerate(jdata.get('row_group_bys', []))
        if f == 'product_default_code']
    new_rows = []
    for row in rows:
        field = row.get('field')
        if field == 'product_default_code':
            continue
        indent = row['indent'] - sum(1 for i in code_levels if i < row['indent'])
        code = ''
        if field == 'product_id':
            code = codes_by_product.get(row.get('res_id'), '')
        new_rows.append({
            'title': code,
            'indent': 0,
            'values': [{
                'value': f"{max(indent, 0) * INDENT}{row['title']}",
                'is_bold': row['indent'] == 0,
            }] + row['values'],
        })
    jdata = dict(jdata)
    jdata['rows'] = new_rows
    jdata['col_group_headers'] = [
        [{'title': '', 'width': 1, 'height': 1, 'is_bold': False}] + header_row
        for header_row in jdata['col_group_headers']]
    jdata['measure_headers'] = [
        {'title': 'Producto', 'is_bold': True}] + jdata['measure_headers']
    return jdata


class PosPivotExporter(TableExporter):

    @http.route()
    def export_xlsx(self, data, **kw):
        jdata = json.load(data) if isinstance(data, FileStorage) else json.loads(data)
        if jdata and jdata.get('model') == 'report.pos.order':
            product_ids = {
                r['res_id'] for r in jdata.get('rows', [])
                if r.get('field') == 'product_id' and r.get('res_id')}
            products = request.env['product.product'].with_context(
                active_test=False).browse(product_ids)
            codes = {p.id: p.default_code or '' for p in products}
            new_jdata = add_product_code_column(jdata, codes)
            response = super().export_xlsx(json.dumps(new_jdata), **kw)
            if new_jdata is not jdata:
                self._set_code_header(response, len(new_jdata['col_group_headers']))
            return response
        return super().export_xlsx(data, **kw)

    @staticmethod
    def _set_code_header(response, header_rows):
        """Pone "Código de producto" en la cabecera de la columna A."""
        import openpyxl  # noqa: PLC0415
        workbook = openpyxl.load_workbook(io.BytesIO(response.get_data()))
        sheet = workbook.active
        row = header_rows + 1  # la fila de medidas va tras las de columnas
        cell, ref = sheet.cell(row=row, column=1), sheet.cell(row=row, column=2)
        cell.value = 'Código de producto'
        cell._style = copy(ref._style)
        output = io.BytesIO()
        workbook.save(output)
        response.set_data(output.getvalue())
