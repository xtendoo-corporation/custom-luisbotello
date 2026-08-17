# luis_botello_discount_line

## Propósito y valor para el cliente

Añade un campo de **descuento en importe fijo por línea** (`Desc. Lin`) en las
líneas de pedido de TPV y en las líneas de factura de Odoo. Permite aplicar un
descuento monetario directo (adicional al descuento porcentual estándar) sobre
cada línea de venta, con impacto correcto en el cálculo de impuestos y en la
transferencia a factura.

Además, corrige el comportamiento del escáner de códigos de barras en POS
convencional: cada escaneo genera **siempre una línea nueva** (qty=1) en lugar de
incrementar la cantidad en la línea existente.

---

## Alcance y fuera de alcance

**En alcance:**
- Campo `discount_line` (Float) en `pos.order.line` y `account.move.line`.
- Recálculo correcto de subtotales e impuestos en POS teniendo en cuenta
  `discount_line` junto al descuento porcentual.
- Propagación del campo al generar la factura desde un pedido POS.
- Override de `add_product_by_barcode` en `pos.order` para crear líneas separadas.
- Visibilidad del campo en las vistas de lista de líneas de pedido POS y de factura.

**Fuera de alcance:**
- Descuentos en pedidos de venta estándar (solo TPV y facturas).
- Integración con módulos de precio especial o tarifas.
- Interfaz POS frontend (componente OWL) para editar `discount_line` — el campo
  se gestiona desde el backend.

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `account` | Odoo Community |
| `point_of_sale` | Odoo Community |
| `pos_conventional_core` | Xtendoo (externo, no incluido en este repositorio) |
| `pos_conventional_order_barcode` | Xtendoo (externo) |
| `pos_conventional_barcode_scanner` | Xtendoo (externo) |

> ⚠️ Los módulos `pos_conventional_*` son de la suite POS Convencional de Xtendoo.
> Deben estar instalados antes de este módulo.

---

## Instalación y activación

1. Asegúrese de que los módulos `pos_conventional_core`,
   `pos_conventional_order_barcode` y `pos_conventional_barcode_scanner` están
   instalados.
2. Copie o enlace el módulo en el `addons-path` de Odoo.
3. Actualice la lista de aplicaciones.
4. Instale `luis_botello_discount_line`.

```bash
odoo --stop-after-init -u luis_botello_discount_line -d <nombre_bd>
```

---

## Configuración

No requiere configuración adicional. El campo `Desc. Lin` aparece
automáticamente como columna opcional en las listas de líneas de:
- Pedidos TPV (`point_of_sale.view_pos_order_line`).
- Facturas (`account.view_move_form`, sección `invoice_line_ids`).

---

## Flujo funcional paso a paso

1. **TPV (backend):** En un pedido de TPV, la vista de líneas muestra la columna
   `Desc. Lin` (opcional). Al introducir un valor mayor que cero, el subtotal de
   la línea se recalcula restando ese importe fijo al precio tras el descuento
   porcentual, y los impuestos se recomputan sobre el precio resultante.

2. **Factura generada desde POS:** Al facturar un pedido TPV, el método
   `_get_invoice_lines_values` de `pos.order` propaga el valor de `discount_line`
   de cada `pos.order.line` a la `account.move.line` correspondiente.

3. **Cálculo en factura:** En `account.move`, el método
   `_prepare_product_base_line_for_taxes_computation` se sobreescribe para
   restar `discount_line / quantity` al `price_unit` base antes de computar
   impuestos.

4. **Escaneo de barcode:** Cada llamada a `add_product_by_barcode` crea siempre
   una línea nueva en el pedido. El método `_get_existing_scanned_product_line`
   devuelve un recordset vacío para forzar este comportamiento.

---

## Modelos, campos y métodos relevantes

### `pos.order.line` — `models/pos_order_line.py`

| Elemento | Tipo | Descripción |
|---|---|---|
| `discount_line` | `Float` | Descuento fijo en importe (moneda del pedido) |
| `_onchange_amount_line_all` | onchange | Dispara recálculo al cambiar precio, qty, descuento o `discount_line` |
| `_compute_amount_line_all` | override | Recomputa subtotales neto e incl. impuestos considerando `discount_line` |

### `account.move.line` — `models/account_move_line.py`

| Elemento | Tipo | Descripción |
|---|---|---|
| `discount_line` | `Float` | Descuento fijo propagado desde la línea POS o editable en factura |

### `account.move` — `models/account_move.py`

| Elemento | Tipo | Descripción |
|---|---|---|
| `_prepare_product_base_line_for_taxes_computation` | override | Ajusta `price_unit` restando `discount_line / qty` antes de calcular impuestos |

### `pos.order` — `models/pos_order.py`

| Elemento | Tipo | Descripción |
|---|---|---|
| `_get_existing_scanned_product_line` | override | Devuelve recordset vacío para forzar nueva línea por escaneo |
| `_get_invoice_lines_values` | override | Propaga `discount_line` a las líneas de factura |
| `add_product_by_barcode` | override | Crea siempre una línea nueva con qty=1 al escanear un producto |

---

## Vistas, menús y acciones

| Vista | Modelo | Cambio |
|---|---|---|
| `view_move_form_inherit_discount_line` | `account.move` | Añade `discount_line` tras el campo `discount` en `invoice_line_ids` |
| `view_pos_order_line_inherit_discount_line` | `pos.order.line` | Añade `discount_line` tras `discount` en la lista de líneas |

No se añaden menús ni acciones nuevas.

---

## Permisos y seguridad

No se definen grupos ni reglas de acceso propios. El campo `discount_line` hereda
los permisos de los modelos `pos.order.line` y `account.move.line` estándar.

---

## Datos y compatibilidad

- Versión Odoo: **19.0** (declarado en manifest).
- Licencia: **LGPL-3**.
- No incluye datos de demo ni datos de inicialización.
- No hay ficheros de migración.

---

## Pruebas existentes

### `tests/test_add_product_separate_lines.py`

Clase: `TestAddProductSeparateLines`
Tag: `@tagged("luis_botello_discount_line", "-at_install", "post_install")`

| Test | Verifica |
|---|---|
| `test_01_barcode_creates_separate_lines` | Dos llamadas a `add_product_by_barcode` crean 2 líneas separadas, cada una con qty=1 |

> ⚠️ **Riesgo documentado:** El archivo de tests importa `tagged` desde
> `odoo.tests.common` pero la clase hereda de `PosConventionalTestCommon` sin
> importar ese símbolo. El test fallará con `NameError: name 'PosConventionalTestCommon'
> is not defined` si se ejecuta tal como está. Se documenta como deuda técnica; no
> se ha modificado el código.

```bash
odoo --stop-after-init --test-enable -d <bd> \
  --test-tags luis_botello_discount_line
```

---

## Operación y diagnóstico

- Si `discount_line` no aparece en la vista de líneas de factura, compruebe que
  la vista `view_move_form_inherit_discount_line` está activa
  (Ajustes → Técnico → Vistas).
- Si el escaneo de barcode sigue acumulando qty en la misma línea, verifique que
  el override `add_product_by_barcode` de este módulo tiene mayor prioridad que
  el de `pos_conventional_barcode_scanner`. El módulo declara dependencia sobre
  él para garantizar el orden de carga.
- Cambios en `discount_line` desde el backend no se reflejan en tiempo real en el
  frontend TPV OWL sin recargar el pedido.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| Test con error de importación | `PosConventionalTestCommon` no importado → suite no ejecutable sin corrección |
| Sin interfaz POS frontend | El campo no es editable directamente desde la pantalla táctil del TPV |
| Dependencia de suite Xtendoo | Los módulos `pos_conventional_*` son externos y deben estar disponibles |
| Compatibilidad futura | Si `pos_conventional_barcode_scanner` cambia su API de `add_product_by_barcode`, este override puede romper |

---

## Notas de mantenimiento

- Ficheros: `models/pos_order_line.py`, `models/account_move_line.py`,
  `models/account_move.py`, `models/pos_order.py`.
- Vistas: `views/account_move_views.xml`, `views/pos_order_views.xml`.
- Antes de actualizar la suite `pos_conventional_*`, validar que la firma de
  `add_product_by_barcode` y `_get_existing_scanned_product_line` no ha cambiado.
- El test necesita corrección de importación antes de usarse en CI.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
