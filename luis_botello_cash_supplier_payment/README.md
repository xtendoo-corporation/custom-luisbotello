# luis_botello_cash_supplier_payment

## Objetivo del módulo

Permite sincronizar el pago en **efectivo de facturas de proveedor** con la **sesión de TPV activa**, generando automáticamente una **salida de caja** cuando se registra un pago contable en efectivo.

---

## Problema que resuelve

En Odoo estándar, al pagar una factura de proveedor en efectivo, el movimiento queda registrado únicamente en contabilidad. La caja física del TPV no se actualiza, lo que provoca:

- Descuadre entre la caja real y la contabilidad.
- Falta de trazabilidad entre factura de proveedor, pago y caja.
- Dificultad para el cuadre de caja al cierre de sesión POS.

Este módulo resuelve esto añadiendo un check en el wizard de registro de pago que, al estar marcado, crea automáticamente la salida de caja en la sesión de TPV abierta.

---

## Dependencias

- `account` — Gestión de facturas y pagos.
- `point_of_sale` — Sesiones TPV y movimientos de caja.

---

## Configuración necesaria

1. Instalar el módulo `luis_botello_cash_supplier_payment`.
2. Tener al menos una sesión de TPV abierta cuando se vaya a pagar en efectivo.
3. El diario de pago debe ser de tipo **Efectivo** (campo `type = 'cash'`).

No requiere configuración adicional en los ajustes de empresa.

---

## Flujo de uso paso a paso

1. Ir a **Contabilidad → Proveedores → Facturas**.
2. Abrir una factura de proveedor confirmada.
3. Pulsar **Registrar Pago**.
4. En el wizard, seleccionar el diario de **Efectivo**.
5. Aparece el check **"Crear salida en la sesión actual"** (marcado por defecto).
6. Confirmar el pago (botón "Pagar").
7. Resultado:
   - Se crea el pago contable de forma estándar.
   - Se crea una salida de caja en la sesión POS activa con el importe del pago.
   - Aparece un smart button **"Salida POS"** tanto en el pago como en la factura.

---

## Trazabilidad

| Desde | Campo | Apunta a |
|---|---|---|
| `account.payment` | `pos_cash_out_id` | Salida de caja POS |
| `account.bank.statement.line` | `supplier_invoice_id` | Factura de proveedor |
| `account.bank.statement.line` | `supplier_payment_id` | Pago de proveedor |
| `account.move` (factura) | `pos_cash_out_count` | Contador de salidas POS |

---

## Casos de error habituales

| Situación | Mensaje | Comportamiento |
|---|---|---|
| No hay sesión POS abierta | `No existe ninguna sesión de TPV abierta en la empresa "X"` | Error — pago revertido |
| Más de una sesión abierta | `Existe más de una sesión de TPV abierta en la empresa "X"` | Error — pago revertido |
| Pago no es en efectivo | El check no aparece / no aplica | Sin salida POS |
| Check desmarcado | — | Pago normal sin salida POS |

---

## Limitaciones

- Solo opera sobre facturas de proveedor (`in_invoice`). Los abonos de proveedor (`in_refund`) quedan fuera del ámbito v1 para evitar complejidad contable.
- Requiere que el usuario tenga permisos estándar de TPV y contabilidad.
- Si existen múltiples sesiones abiertas, el sistema bloquea la operación para evitar imputar a la caja incorrecta.

---

## Documentación técnica

### Modelos heredados

| Modelo | Tipo herencia | Cambios |
|---|---|---|
| `account.payment.register` | TransientModel inherit | Campos + lógica de creación de salida POS |
| `account.payment` | Model inherit | Campo `pos_cash_out_id`, acción smart button |
| `account.move` | Model inherit | Campo `pos_cash_out_count`, acción smart button |
| `account.bank.statement.line` | Model inherit | Campos `supplier_invoice_id`, `supplier_payment_id` |

### Campos añadidos

**`account.payment.register` (wizard)**
- `is_cash_payment` (Boolean, computed): True si `journal_id.type == 'cash'`.
- `is_supplier_invoice` (Boolean, computed): True si todos los documentos son `in_invoice`.
- `create_pos_cash_out` (Boolean): check del usuario; default True si es efectivo + proveedor.

**`account.payment`**
- `pos_cash_out_id` (Many2one `account.bank.statement.line`): enlace a la salida POS.

**`account.move`**
- `pos_cash_out_count` (Integer, computed): número de salidas POS vinculadas.

**`account.bank.statement.line`**
- `supplier_invoice_id` (Many2one `account.move`): factura origen.
- `supplier_payment_id` (Many2one `account.payment`): pago origen.

### Métodos clave

| Método | Ubicación | Propósito |
|---|---|---|
| `_compute_is_cash_payment` | wizard | Detecta si el diario es efectivo |
| `_compute_is_supplier_invoice` | wizard | Detecta si las facturas son de proveedor |
| `_get_open_pos_session` | wizard | Valida y devuelve la sesión única abierta |
| `_create_pos_cash_statement_line` | wizard | Crea la salida de caja en la sesión POS |
| `_build_cash_out_description` | wizard | Genera el texto descriptivo legible |
| `action_create_payments` | wizard | Override principal con la lógica integrada |
| `_get_created_payments` | wizard | Recupera pagos por reconciliación con factura |

### Estrategia transaccional

Al confirmar el pago con el check activo:
1. Se valida la sesión POS (antes de crear el pago).
2. Se ejecuta el `super().action_create_payments()` (pago contable).
3. Se crea la salida de caja POS.

Si el paso 1 o 3 lanza `UserError`, la excepción sube y Odoo revierte toda la transacción. El resultado es atómico: o existen ambos movimientos (pago + salida) o ninguno.

### Detección de efectivo

Se usa `journal_id.type == 'cash'` — estándar Odoo. No depende del nombre del diario ni de configuraciones personalizadas.

### Anti-duplicado

El campo `pos_cash_out_id` en `account.payment` actúa como centinela. En el bucle de creación, si `payment.pos_cash_out_id` ya tiene valor, ese pago se salta.

---

## Ejecución de tests

```bash
# Ejecutar todos los tests del módulo
odoo -c /etc/odoo/odoo.conf \
  --test-enable \
  --stop-after-init \
  -d <nombre_bd> \
  -i luis_botello_cash_supplier_payment \
  --log-level=test

# Ejecutar solo este módulo con tag específico
python -m pytest --odoo-database=<nombre_bd> \
  addons/luis_botello_cash_supplier_payment/tests/ -v
```

### Tests implementados

| # | Nombre | Verifica |
|---|---|---|
| 1 | `test_01_cash_payment_with_single_open_session` | Pago + salida POS creada correctamente |
| 2 | `test_02_cash_payment_no_open_session` | UserError + rollback si no hay sesión |
| 3 | `test_03_cash_payment_multiple_open_sessions` | UserError si hay más de una sesión |
| 4 | `test_04_check_unchecked_no_pos_out` | Pago OK sin salida si check desmarcado |
| 5 | `test_05_bank_payment_no_pos_out` | Pago banco no genera salida POS |
| 6 | `test_06_multicompany_isolation` | No usa sesiones de otra compañía |
| 7 | `test_07_no_duplicate_cash_out` | Guard anti-duplicado funciona |

---

## Manual breve de usuario

### ¿Cómo registrar el pago?

1. Abre la factura de proveedor confirmada.
2. Botón **Registrar Pago**.
3. Selecciona el diario **Efectivo**.
4. Verás el check **"Crear salida en la sesión actual"** — déjalo marcado.
5. Pulsa **Pagar**.

### ¿Cuándo aparece el check?

Solo cuando:
- El diario seleccionado es de tipo **Efectivo**.
- La factura es de **proveedor** (`in_invoice`).

### ¿Qué pasa si no hay sesión abierta?

Aparecerá un aviso de error claro. El pago **no** quedará registrado. Debes abrir una sesión de TPV y repetir el proceso.

### ¿Cómo comprobar la salida de caja creada?

- Desde el **pago**: smart button **"Salida POS"** en la cabecera.
- Desde la **factura**: smart button **"Salidas POS"** con el contador.
- Desde la **sesión TPV**: en el extracto de caja, busca el movimiento con el nombre de la factura.

---

## Riesgos y puntos a vigilar

| Riesgo | Mitigación |
|---|---|
| Sesión POS cerrada tras abrir el wizard | La validación ocurre justo antes de crear el pago |
| Cambio de `account.bank.statement.line` en futuras versiones Odoo | Revisar compatibilidad del campo `pos_session_id` |
| Pagos en lote (varias facturas) | La implementación actual usa la primera factura `in_invoice`; revisar si el cliente necesita soporte multi-factura |
| Importe parcial | El importe de salida es el importe del pago (no el de la factura); funciona correctamente para pagos parciales |
