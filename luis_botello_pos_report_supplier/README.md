# Luis Botello - Proveedor en análisis de pedidos TPV

Añade el campo **Proveedor** (`supplier_id`) a `report.pos.order`
(Punto de venta > Informes > Pedidos) como filtro, agrupación y columna de lista.

El proveedor es el principal del producto: `product.supplierinfo` con menor
secuencia (la variante prevalece sobre la plantilla).
Es el proveedor **actual**, no el vigente en la fecha de venta.
