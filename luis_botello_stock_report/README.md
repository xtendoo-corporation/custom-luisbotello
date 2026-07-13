# Luis Botello - Stock Consolidado

Módulo para Odoo 19 que proporciona una vista de reporte consolidado de stock de todos los almacenes.

## Características

- Vista de lista (list) con las cantidades totales por producto.
- Cálculo de:
  - **Cantidad Total**: Suma de todas las existencias físicas.
  - **Cantidad Reservada**: Suma de todas las reservas.
  - **Cantidad Disponible**: Diferencia entre el total y lo reservado.
- Vista Pivot para análisis multidimensional.
- Filtros por categoría, producto y compañía.
- Acceso integrado en el menú de Informes de Inventario.

## Instalación

1. Asegúrese de que el módulo esté en su `addons-path`.
2. Actualice la lista de aplicaciones en Odoo.
3. Busque `luis_botello_stock_report` e instálelo.

## Uso

Vaya a **Inventario > Informes > Stock consolidado**.

