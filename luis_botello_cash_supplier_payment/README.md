# luis_botello_cash_supplier_payment

## Propósito y valor para el cliente

Al pagar una factura de proveedor en efectivo, el movimiento queda registrado
en contabilidad pero la caja física del TPV no se actualiza, causando descuadres
al cierre de sesión POS. Este módulo resuelve ese problema: cuando se registra
un pago en efectivo sobre una factura de proveedor, **crea automáticamente una
salida de caja en la sesión de TPV activa** y enlaza contablemente ambos
movimientos con trazabilidad completa.

---

## Alcance y fuera de alcance

**En alcance:**
- Checkbox «Crear salida en la sesión actual» en el wizard de registro de pago,
  visible solo para facturas de proveedor (`in_invoice`) pagadas con diario de
  tipo efectivo.
- Creación automática de `account.bank.statement.line` (salida de caja negativa)
  en la sesión POS activa vinculada al diario de efectivo.
- Trazabilidad bidireccional: smart buttons en `account.payment` y en
  `account.move` (factura).
- Política transaccional atómica: o se crean ambos movimientos o ninguno.
- Selección automática de sesión por diario (si hay múltiples sesiones abiertas,
  se filtra por el diario de efectivo del pago).
- Guard anti-duplicado: si el pago ya tiene `pos_cash_out_id`, no se crea otra.

**Fuera de alcance:**
- Abonos de proveedor (`in_refund`): el check no aplica por diseño en v1.
- Pagos en lote con varias facturas `in_invoice`: se usa la primera factura
  detectada como origen de la salida.
- Pagos con diario diferente a efectivo (`cash`).

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `account` | Odoo Community |
| `point_of_sale` | Odoo Community |

Sin dependencias externas.

---

## Instalación y activación

1. Copie el módulo en el `addons-path`.
2. Actualice la lista de aplicaciones.
3. Instale `luis_botello_cash_supplier_payment`.

```bash
odoo --stop-after-init -u luis_botello_cash_supplier_payment -d <nombre_bd>
```

---

## Configuración

No requiere configuración global adicional.

**Requisitos operativos:**
- Debe existir al menos una sesión de TPV **abierta** en la compañía al momento
  de registrar el pago.
- El diario de pago debe ser de tipo **Efectivo** (`journal.type == 'cash'`).
- Si hay múltiples sesiones abiertas, debe haber exactamente una vinculada al
  diario de efectivo usado. En caso contrario la operación se bloquea con
  `UserError`.

---

## Flujo funcional paso a paso

1. Ir a **Contabilidad → Proveedores → Facturas**.
2. Abrir una factura de proveedor confirmada.
3. Pulsar **Registrar Pago**.
4. Seleccionar el diario de **Efectivo**.
5. Aparece el check **«Crear salida en la sesión actual»** (marcado por defecto
   cuando el diario es efectivo y la factura es de proveedor).
6. Confirmar pago («Pagar»).
7. Resultado:
   - Pago contable creado de forma estándar.
   - `account.bank.statement.line` creada en la sesión POS activa con importe
     negativo (salida) e importe = importe del pago.
   - Smart button **«Salida POS»** visible en el pago.
   - Smart button **«Salidas POS»** con contador visible en la factura.

---

## Modelos, campos y métodos relevantes

### `account.payment.register` (wizard) — `wizard/account_payment_register.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `is_cash_payment` | Boolean (computed) | `True` si `journal_id.type == 'cash'` |
| `is_supplier_invoice` | Boolean (computed) | `True` si todos los documentos son `in_invoice` |
| `create_pos_cash_out` | Boolean | Check del usuario; default `True` si efectivo + proveedor |

| Método | Descripción |
|---|---|
| `_compute_is_cash_payment` | Detecta si el diario es efectivo |
| `_compute_is_supplier_invoice` | Detecta si las facturas son de proveedor |
| `default_get` | Pre-calcula el valor por defecto de `create_pos_cash_out` |
| `_onchange_journal_create_pos_cash_out` | Actualiza el check al cambiar de diario |
| `_get_open_pos_session` | Valida y devuelve la sesión POS única válida |
| `_build_cash_out_description` | Genera el texto descriptivo de la salida (factura/proveedor/fecha) |
| `_create_pos_cash_statement_line` | Crea `account.bank.statement.line` en la sesión |
| `action_create_payments` | Override principal: valida sesión → super() → crea salida |
| `_get_created_payments` | Recupera pagos reconciliados con la factura tras el super() |

### `account.payment` — `models/account_payment.py`

| Campo | Descripción |
|---|---|
| `pos_cash_out_id` | Many2one a `account.bank.statement.line`: salida POS generada |

| Método | Descripción |
|---|---|
| `action_view_pos_cash_out` | Smart button → abre la salida POS asociada |

### `account.move` — `models/account_move.py`

| Campo | Descripción |
|---|---|
| `pos_cash_out_count` | Integer (computed): número de salidas POS desde pagos reconciliados |

| Método | Descripción |
|---|---|
| `_compute_pos_cash_out_count` | Cuenta salidas POS en pagos reconciliados |
| `_get_reconciled_payments` | Devuelve pagos reconciliados con el asiento vía líneas de conciliación |
| `action_view_pos_cash_outs` | Smart button → abre las salidas POS |

### `account.bank.statement.line` — `models/account_bank_statement_line.py`

| Campo | Descripción |
|---|---|
| `supplier_invoice_id` | Many2one a `account.move`: factura de proveedor origen |
| `supplier_payment_id` | Many2one a `account.payment`: pago origen |

| Método | Descripción |
|---|---|
| `action_open_pos_cash_outs` | Abre la salida en vista lista o formulario según cardinalidad |

---

## Vistas, menús y acciones

| Vista | Cambio |
|---|---|
| `account_payment_register_form_inherit_cash_out` | Añade checkbox «Crear salida de caja en TPV» en el wizard de pago |
| `view_account_bank_statement_line_pos_cash_out_list` | Lista readonly de salidas de caja POS |
| `view_account_bank_statement_line_pos_cash_out_form` | Formulario readonly de salida de caja POS |
| `account_payment_form_inherit_pos_cash_out` | Smart button «Salida POS» en el formulario de pago |
| `account_move_form_inherit_pos_cash_out` | Smart button «Salidas POS» con contador en la factura |

No se añaden menús ni acciones propias.

---

## Permisos y seguridad

Fichero: `security/ir.model.access.csv`

El archivo está vacío (solo contiene la cabecera). Los modelos heredados utilizan
los permisos estándar de `account` y `point_of_sale`.

---

## Datos y compatibilidad

- Versión Odoo: **19.0** (declarado en manifest).
- Licencia: **AGPL-3**.
- No incluye datos de demo.

---

## Pruebas existentes

### `tests/test_cash_payment_pos.py`

Clase: `TestCashPaymentPos`
Tag: `@tagged('post_install', '-at_install', 'luis_botello')`
Hereda: `CashSupplierPaymentCommon` (`tests/common.py`)

| # | Test | Verifica |
|---|---|---|
| 01 | `test_01_happy_path_single_session` | Pago + salida POS creada correctamente con una sesión |
| 02 | `test_02_no_session_error` | `UserError` si no hay sesión abierta |
| 03 | `test_03_multiple_sessions_error` | Con varias sesiones, selecciona la del diario correcto |
| 04 | `test_04_multiple_sessions_same_journal_error` | `UserError` si dos sesiones comparten el mismo diario |
| 05 | `test_05_no_matching_session_for_journal_error` | `UserError` si ninguna sesión abierta usa ese diario |
| 06 | `test_06_check_unchecked_no_out` | Sin check → no se crea salida |
| 07 | `test_07_bank_payment_no_out` | Pago por banco → no se crea salida |
| 08 | `test_08_anti_duplicate` | Guard anti-duplicado funciona |
| 09–11 | Adicionales | Trazabilidad en factura, pagos agrupados, abono seguro |
| 12 | `test_12_closed_session` | Sesión en `closing_control` → `UserError` |

```bash
odoo --stop-after-init --test-enable -d <bd> \
  --test-tags luis_botello -u luis_botello_cash_supplier_payment
```

---

## Operación y diagnóstico

| Situación | Mensaje | Comportamiento |
|---|---|---|
| Sin sesión POS abierta | `No existe ninguna sesión de TPV abierta en la empresa "X"` | `UserError` — pago revertido |
| Múltiples sesiones, mismo diario | `hay más de una sesión de TPV abierta` | `UserError` — pago revertido |
| Ninguna sesión compatible con el diario | `no existe ninguna sesión de TPV abierta ... vinculada al diario` | `UserError` — pago revertido |
| Sesión en estado `closing_control` | No se encuentra como `opened` | `UserError` |
| Check desmarcado | — | Pago normal sin salida POS |
| Pago no en efectivo | Check no aparece | Sin salida POS |

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| Abonos de proveedor | `in_refund` no genera salida POS (diseño v1) |
| Pagos en lote multi-factura | Se usa la primera factura `in_invoice`; si hay varias podría asociarse incorrectamente |
| Cambio de API `account.bank.statement.line` | Revisar compatibilidad del campo `pos_session_id` en futuras versiones Odoo |
| IR vacío de accesos | El CSV de seguridad no define accesos propios; los permisos dependen completamente de los módulos base |

---

## Notas de mantenimiento

- La lógica transaccional es atómica: cualquier fallo en la creación de la salida
  POS revierte el pago completo.
- El importe de la salida POS siempre es negativo (`-abs(payment.amount)`) conforme
  al estándar de Odoo para salidas de caja.
- El campo `pos_cash_out_id` actúa como centinela anti-duplicado.
- Ficheros: `wizard/account_payment_register.py`, `models/account_payment.py`,
  `models/account_move.py`, `models/account_bank_statement_line.py`.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
