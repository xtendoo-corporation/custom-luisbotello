# custom-luisbotello

Repositorio de módulos Odoo 19 personalizados para el cliente **Luis Botello**,
desarrollados por **Xtendoo**.

> ⚠️ **Aviso importante:** El árbol de este repositorio puede contener cambios
> locales no commiteados o branches divergentes que no están reflejados en esta
> documentación. Esta documentación no sustituye la validación en una base de datos
> de pruebas antes de desplegar en producción. Verifique siempre el estado del
> repositorio con `git status` y `git log` antes de una actualización.

---

## Inventario de módulos

| Módulo | Versión | Área | Descripción breve |
|---|---|---|---|
| `luis_botello_discount_line` | 19.0.1.0.0 | Ventas / TPV | Descuento fijo por línea en POS y facturas; escaneo barcode a línea nueva |
| `luis_botello_stock_automation` | 1.0 | Inventario | Creación automática de albarán hijo al validar un albarán origen |
| `luis_botello_cash_supplier_payment` | 19.0.1.0.0 | Contabilidad / TPV | Salida de caja POS al pagar factura de proveedor en efectivo |
| `luis_botello_stock_count_add` | 19.0.1.0.0 | Inventario | Conteo de inventario aditivo (suma sobre lo ya contado) |
| `luis_botello_permisions` | 1.0 | Seguridad | Control de visibilidad de márgenes/costes y traspasos entre almacenes |
| `luis_botello_login` | 1.0 | RR.HH. | Wizard de entrada/salida de asistencia al iniciar sesión |
| `luis_botello_extend_pos_conventional` | 19.0.1.0.0 | TPV | Extensiones de recibo, cierre, URL por caja y botón Devolver |
| `luis_botello_stock_report` | 19.0.1.0.0 | Inventario | Informe consolidado de stock por almacén (vista SQL) |
| `luis_botello_informes_tablero` | 19.0.1.0.0 | TPV / Reporting | Informes diarios y horarios de TPV en Tableros y Spreadsheet |

---

## Dependencias externas (fuera del repositorio)

Varios módulos requieren la **suite POS Convencional de Xtendoo** (`pos_conventional_*`).
Estos módulos **no se distribuyen en este repositorio** y deben instalarse por separado:

| Módulo externo | Requerido por |
|---|---|
| `pos_conventional_core` | `luis_botello_discount_line`, `luis_botello_permisions` |
| `pos_conventional_order_barcode` | `luis_botello_discount_line` |
| `pos_conventional_barcode_scanner` | `luis_botello_discount_line` |
| `pos_conventional_receipt` | `luis_botello_extend_pos_conventional` |
| `pos_conventional_receipt_custom` | `luis_botello_extend_pos_conventional` |
| `pos_conventional_session_management` | `luis_botello_extend_pos_conventional` |
| `pos_conventional_cash_calculator` | `luis_botello_extend_pos_conventional` |

Módulos de Odoo Community/Enterprise requeridos (no incluidos):

| Módulo | Requerido por |
|---|---|
| `sale_margin` | `luis_botello_permisions` |
| `account_invoice_margin` | `luis_botello_permisions` |
| `spreadsheet_dashboard` | `luis_botello_informes_tablero` |
| `hr_attendance` | `luis_botello_login` |

---

## Matriz de dependencias entre módulos del repositorio

No existe dependencia directa entre los módulos de este repositorio. Todos son
independientes entre sí.

```
luis_botello_discount_line          → pos_conventional_core, account, point_of_sale
luis_botello_stock_automation       → stock
luis_botello_cash_supplier_payment  → account, point_of_sale
luis_botello_stock_count_add        → stock
luis_botello_permisions             → base, sale_margin, point_of_sale, account,
                                       account_invoice_margin, product,
                                       pos_conventional_core, purchase, stock
luis_botello_login                  → web, hr_attendance
luis_botello_extend_pos_conventional→ pos_conventional_receipt,
                                       pos_conventional_receipt_custom,
                                       pos_conventional_session_management,
                                       pos_conventional_cash_calculator
luis_botello_stock_report           → stock, product
luis_botello_informes_tablero       → point_of_sale, spreadsheet_dashboard
```

---

## Mapa de procesos cruzados

| Proceso de negocio | Módulos involucrados |
|---|---|
| Venta TPV con descuento fijo por línea | `luis_botello_discount_line` |
| Pago a proveedor en efectivo + cuadre de caja | `luis_botello_cash_supplier_payment` |
| Traspaso entre almacenes encadenado automáticamente | `luis_botello_stock_automation` |
| Inventario físico con múltiples pasadas | `luis_botello_stock_count_add` |
| Control de visibilidad de márgenes en ventas/TPV | `luis_botello_permisions` |
| Control de quién puede hacer traspasos internos | `luis_botello_permisions` |
| Fichaje de asistencia al entrar al sistema | `luis_botello_login` |
| Recibo TPV personalizado + URL de acceso por caja | `luis_botello_extend_pos_conventional` |
| Análisis de ventas TPV por día/hora | `luis_botello_informes_tablero` |
| Stock consolidado todos los almacenes | `luis_botello_stock_report` |

---

## Orden de instalación recomendado

1. Instalar primero los módulos externos (suite `pos_conventional_*`,
   `sale_margin`, `account_invoice_margin`, `hr_attendance`,
   `spreadsheet_dashboard`).
2. Instalar los módulos de este repositorio **sin dependencias entre sí** en
   cualquier orden. Sugerencia por área:

   **Inventario:**
   ```
   luis_botello_stock_automation
   luis_botello_stock_count_add
   luis_botello_stock_report
   ```

   **TPV:**
   ```
   luis_botello_extend_pos_conventional
   luis_botello_discount_line
   luis_botello_informes_tablero
   ```

   **Contabilidad:**
   ```
   luis_botello_cash_supplier_payment
   ```

   **Seguridad y RR.HH.:**
   ```
   luis_botello_permisions
   luis_botello_login
   ```

---

## Guía de instalación segura

```bash
# 1. Actualizar lista de módulos
odoo --stop-after-init --update all -d <nombre_bd>

# 2. Instalar módulo individual
odoo --stop-after-init -i <nombre_modulo> -d <nombre_bd>

# 3. Actualizar módulo existente
odoo --stop-after-init -u <nombre_modulo> -d <nombre_bd>

# 4. Instalar varios módulos
odoo --stop-after-init \
  -i luis_botello_stock_automation,luis_botello_stock_count_add,luis_botello_stock_report \
  -d <nombre_bd>
```

**Antes de instalar en producción:**
1. Ejecutar en una base de datos de prueba con datos reales.
2. Ejecutar los tests automáticos (ver sección Matriz de pruebas).
3. Validar manualmente los flujos afectados.
4. Hacer copia de seguridad de la base de datos de producción.

---

## Matriz de pruebas

| Módulo | Tests existentes | Estado conocido | Comando |
|---|---|---|---|
| `luis_botello_discount_line` | 1 test (barcode → líneas separadas) | ⚠️ Fallo en ejecución: `PosConventionalTestCommon` no importado | `--test-tags luis_botello_discount_line` |
| `luis_botello_stock_automation` | 2 tests | ✓ Aparentemente funcional | `-u luis_botello_stock_automation` |
| `luis_botello_cash_supplier_payment` | 12 tests | ✓ Suite robusta | `--test-tags luis_botello` |
| `luis_botello_stock_count_add` | Sin tests | ⚠️ Sin cobertura | — |
| `luis_botello_permisions` | 10 tests (grupos + traspasos) | ✓ Aparentemente funcional | `--test-tags /luis_botello_permisions` |
| `luis_botello_login` | Sin tests | ⚠️ Sin cobertura | — |
| `luis_botello_extend_pos_conventional` | Sin tests | ⚠️ Sin cobertura; riesgo `_can_access_pos_config` | — |
| `luis_botello_stock_report` | Sin tests | ⚠️ Sin cobertura | — |
| `luis_botello_informes_tablero` | 4 tests | ✓ Cubre acciones, SQL y dashboards | `--test-tags luis_botello_informes_tablero` |

**Cobertura global estimada:** baja — 3 de 9 módulos tienen tests ejecutables.

```bash
# Ejecutar todos los tests del conjunto (los que tienen cobertura)
odoo --stop-after-init --test-enable -d <bd> \
  --test-tags luis_botello,luis_botello_informes_tablero,/luis_botello_permisions \
  -u luis_botello_stock_automation,luis_botello_cash_supplier_payment,\
luis_botello_permisions,luis_botello_informes_tablero
```

---

## Riesgos y advertencias conocidas

| Riesgo | Módulo | Severidad |
|---|---|---|
| `PosConventionalTestCommon` no importado en test | `luis_botello_discount_line` | Media (tests fallidos) |
| `_can_access_pos_config` no implementado en `res.users` | `luis_botello_extend_pos_conventional` | Alta (error en runtime al usar URL por slug) |
| Vista SQL sin filtro de tipo de ubicación | `luis_botello_stock_report` | Media (totales inflados) |
| Sin tests en 5 módulos | Varios | Media |
| `version = '1.0'` sin prefijo Odoo | `luis_botello_stock_automation`, `luis_botello_permisions`, `luis_botello_login` | Baja |
| Dependencias `pos_conventional_*` externas | Varios | Alta (bloqueo si no disponibles) |
| `spreadsheet_dashboard` puede no estar en Community puro | `luis_botello_informes_tablero` | Alta |

---

## Criterios de soporte y mantenimiento

- **Versión soportada:** Odoo 19.0.
- **Licencias:** LGPL-3, AGPL-3, OPL-1 (ver manifest de cada módulo).
- **Responsable técnico:** Xtendoo.
- **Actualizaciones de Odoo:** revisar los módulos marcados con `version = '1.0'`
  y los overrides de métodos internos de Odoo (especialmente
  `stock.quant.create`, `pos.order.add_product_by_barcode`,
  `account.payment.register.action_create_payments`) tras cada actualización
  menor de la plataforma.
- **Módulos con mayor riesgo de rotura tras actualización:** `luis_botello_stock_count_add`
  (override extenso de `stock.quant`), `luis_botello_extend_pos_conventional`
  (múltiples patches de suite externa).

---

> **Aviso:** Esta documentación se ha generado a partir del análisis estático del
> código real. No sustituye la validación en una base de datos de pruebas antes de
> desplegar en producción. Diferencia entre **hechos extraídos del código** (manifest,
> modelos, vistas, tests) y **recomendaciones operativas** (orden de instalación,
> criterios de soporte).
