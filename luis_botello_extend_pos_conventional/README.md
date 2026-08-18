# luis_botello_extend_pos_conventional

## Propósito y valor para el cliente

Extiende la suite POS Convencional de Xtendoo con un conjunto de
personalizaciones específicas para el cliente:

1. **Recibo TPV:** muestra el nombre de la **caja (pos.config)** en lugar del
   nombre de la empresa en la cabecera; añade «Total entregado» y «Cambio» en
   pagos en efectivo; añade nota de no devolución; añade columna de precio
   unitario en la factura simplificada 80mm.
2. **Calculo de monedas/billetes en cierre:** integra la calculadora de efectivo
   (`pos_conventional_cash_calculator`) en el popup de cierre de sesión,
   persistiendo las cantidades por denominación en la sesión.
3. **Botón Devolver ocultable:** permite configurar por caja si el botón
   «Devolver» está visible en pedidos TPV (backend y frontend).
4. **URL de acceso personalizada por caja:** permite asignar un identificador
   (`access_slug`) a cada caja para acceder directamente via `/pos/web/<slug>`.
5. **Búsqueda de productos por código de barras parcial** en contexto POS.
6. **Datos de denominación de billetes/monedas** guardados en la sesión TPV.

---

## Alcance y fuera de alcance

**En alcance:**
- Campos `access_slug`, `access_url`, `hide_return_button` en `pos.config`.
- Campos de denominación (`qty_200`…`qty_001`) en `pos.session`.
- Campo relacionado `pos_config_hide_return` en `pos.order`.
- Override de `name_search` en `product.product` para búsqueda por código de
  barras parcial en contexto POS.
- Patch OWL de `ClosingPopup` para leer/escribir denominaciones.
- Patch OWL de `Orderline` para mostrar importe de descuento.
- JS para ocultar botón «Devolver» en frontend POS y en backend.
- Plantillas QWeb: cabecera del recibo, líneas de artículo, total entregado/cambio,
  columna precio en factura simplificada 80mm.
- Controlador HTTP `/pos/web/<slug>` con validación de acceso.
- Ajustes de `res.config.settings` para slug y hide_return_button.

**Fuera de alcance:**
- No incluye tests automatizados.
- El método `_can_access_pos_config` referenciado en el controlador no existe en
  Odoo Community estándar (ver Limitaciones).
- La búsqueda por código de barras parcial solo actúa cuando no hay resultados
  en la búsqueda estándar o en contexto POS explícito.

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `pos_conventional_receipt` | Xtendoo (externo) |
| `pos_conventional_receipt_custom` | Xtendoo (externo) |
| `pos_conventional_session_management` | Xtendoo (externo) |
| `pos_conventional_cash_calculator` | Xtendoo (externo) |

> ⚠️ Todos los módulos `pos_conventional_*` son de la suite POS Convencional de
> Xtendoo y deben estar instalados previamente.

---

## Instalación y activación

1. Asegúrese de que los módulos `pos_conventional_receipt`,
   `pos_conventional_receipt_custom`, `pos_conventional_session_management` y
   `pos_conventional_cash_calculator` están instalados.
2. Copie el módulo en el `addons-path`.
3. Instale `luis_botello_extend_pos_conventional`.

```bash
odoo --stop-after-init -u luis_botello_extend_pos_conventional -d <nombre_bd>
```

---

## Configuración

### URL de acceso personalizada por caja

1. Ir a **Punto de Venta → Configuración → Cajas**.
2. Abrir la caja deseada.
3. Sección **«Acceso Personalizado»** → campo **«Ruta de acceso personalizada»**.
4. Introducir el identificador (p. ej. `tienda-norte`).
5. El campo **«URL de acceso directo»** mostrará la URL completa.

Acceso: `/pos/web/tienda-norte` → abre directamente los pedidos POS de esa caja.

### Ocultar botón Devolver

1. En la configuración de la caja, sección **«Comportamiento POS»**.
2. Activar **«Ocultar botón Devolución en pedidos»**.

También configurable en **Punto de Venta → Configuración → Ajustes**.

---

## Flujo funcional paso a paso

### Recibo TPV

1. El cajero realiza una venta y genera el recibo.
2. La plantilla `luis_botello_extend_pos_conventional.ReceiptHeader` reemplaza el
   nombre de empresa por el nombre de la caja.
3. Si el pago incluye efectivo, se muestran «Total entregado» y «Cambio».
4. Se muestra la nota «No se admiten devoluciones / Non returnable items».

### Cierre de sesión con recuento de efectivo

1. El cajero abre el popup de cierre.
2. Pulsa el botón de calculadora (icono ⊞).
3. Se abre `pos.cash.calculator.wizard` con las denominaciones previas de la
   sesión cargadas.
4. Al cerrar la calculadora, se actualizan `cash_register_balance_end_real` y los
   campos `qty_*` en la sesión.

### URL de acceso por slug

1. Usuario navega a `/pos/web/<slug>`.
2. El controlador busca `pos.config` con ese `access_slug`.
3. Verifica acceso con `user._can_access_pos_config(pos_config)`.
4. Guarda el slug en la sesión del usuario.
5. Redirige a `/odoo/point-of-sale/<config_id>/pos-orders`, la ruta del POS
   convencional que abre exactamente la caja encontrada por el slug.

---

## Modelos, campos y métodos relevantes

### `pos.config` — `models/pos_config.py`

| Campo/Método | Descripción |
|---|---|
| `access_slug` | Identificador URL personalizado de la caja |
| `access_url` | URL completa calculada (computed) |
| `hide_return_button` | Ocultar botón Devolver en esta caja |
| `_compute_access_url` | Calcula `access_url` desde `web.base.url` + `access_slug` |
| `_search` (override) | Filtra por `access_slug` si hay un slug activo en la sesión HTTP |

### `pos.session` — `models/pos_session.py`

Campos añadidos: `qty_200`, `qty_100`, `qty_50`, `qty_20`, `qty_10`, `qty_5`,
`qty_2`, `qty_1`, `qty_050`, `qty_020`, `qty_010`, `qty_005`, `qty_002`,
`qty_001` — cantidades de billetes y monedas por denominación (Integer, default 0).

### `pos.order` — `models/pos_order.py`

| Campo | Descripción |
|---|---|
| `pos_config_hide_return` | Related a `session_id.config_id.hide_return_button` (readonly) |

### `pos.order` — `models/pos_order_receipt.py`

| Método | Descripción |
|---|---|
| `get_order_receipt_data` (override) | Enriquece los datos del recibo con `payment_method_type` e `is_cash_count` |

### `product.product` — `models/product_product.py`

| Método | Descripción |
|---|---|
| `name_search` (override) | Añade búsqueda por `barcode ilike` como fallback en contexto POS |

### `res.config.settings` — `models/res_config_settings.py`

| Campo | Descripción |
|---|---|
| `pos_access_slug` | Related a `pos_config_id.access_slug` |
| `pos_access_url` | Related a `pos_config_id.access_url` (readonly) |
| `pos_hide_return_button` | Related a `pos_config_id.hide_return_button` |

### Controlador HTTP — `controllers/main.py`

| Ruta | Descripción |
|---|---|
| `/pos/web/<slug>` | Valida slug, guarda en sesión, redirige a kanban POS |
| `/pos/web/clear` | Elimina el slug activo de la sesión del usuario |

---

## Vistas, menús y acciones

| Vista | Modelo | Cambio |
|---|---|---|
| `pos_config_view_form_inherit_slug` | `pos.config` | Secciones «Acceso Personalizado» y «Comportamiento POS» |
| `res_config_settings_view_form_...` | `res.config.settings` | Settings de slug y hide_return_button |
| `view_pos_order_form_hide_return_button` | `pos.order` | Oculta botón `refund` según `pos_config_hide_return` |

Reportes QWeb heredados en `report/`:
- `pos_order_report_inherit.xml`: extiende `pos_conventional_receipt_custom.report_factura_simplificada_80mm` con columna Precio y nombre de caja.
- `pos_order_report_qz_inherit.xml`: No confirmable sin acceso a la definición base.

---

## Assets frontend

| Asset bundle | Fichero | Descripción |
|---|---|---|
| `point_of_sale._assets_pos` | `static/src/xml/receipt_templates.xml` | Plantillas OWL del recibo |
| `point_of_sale._assets_pos` | `static/src/js/orderline_patch.js` | Muestra importe de descuento en línea |
| `point_of_sale._assets_pos` | `static/src/js/hide_return_button.js` | Oculta botón «Devolver» en frontend POS |
| `web.assets_backend` | `static/src/js/closing_popup_patch.js` | Patch del popup de cierre con calculadora |
| `web.assets_backend` | `static/src/xml/closing_popup_patch.xml` | Plantilla del botón calculadora en cierre |
| `web.assets_backend` | `static/src/js/hide_return_button_backend.js` | Oculta botón «Devolver» en backend |

---

## Permisos y seguridad

No se definen grupos ni reglas de acceso propios. Los campos nuevos heredan los
permisos de los modelos base.

No existe fichero `security/ir.model.access.csv`.

---

## Datos y compatibilidad

- Versión Odoo: **19.0** (declarado en manifest).
- Licencia: **OPL-1**.
- No incluye datos de demo.

---

## Pruebas existentes

**No hay tests implementados para este módulo.** No existe directorio `tests/`.

> ⚠️ **Riesgo documentado:** La ausencia de tests deja sin cobertura automatizada
> funciones críticas como la URL por slug, el recálculo de cambio en recibo y la
> integración con la calculadora de cierre.

---

## Operación y diagnóstico

- Si el nombre de empresa sigue apareciendo en el recibo en lugar del nombre de
  la caja, verifique que la plantilla
  `luis_botello_extend_pos_conventional.ReceiptHeader` está activa y que el
  bundle `point_of_sale._assets_pos` se ha regenerado.
- Si el botón Devolver sigue visible cuando debería estar oculto, verifique:
  1. Que `hide_return_button = True` en la configuración de la caja.
  2. Que los assets del backend están actualizados.
- Si `/pos/web/<slug>` devuelve error de acceso denegado, revise la implementación
  del método `_can_access_pos_config` (ver Limitaciones).
- Si el slug abre otra caja, compruebe que la respuesta redirige a
  `/odoo/point-of-sale/<config_id>/pos-orders` y no al kanban general. También revise que el slug no esté
  duplicado.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| `_can_access_pos_config` no implementado | El controlador llama a `user._can_access_pos_config(pos_config)` pero este método no existe en `res.users` estándar de Odoo Community → `AttributeError` en runtime al acceder por slug |
| Cobertura parcial | Existe una prueba unitaria para garantizar la URL directa por slug; el flujo HTTP y la apertura real de sesión POS requieren validación en una base Odoo |
| Dependencia de suite Xtendoo | Los 4 módulos `pos_conventional_*` son externos y deben estar disponibles |
| `hide_return_button` en JS frontend | La ocultación se hace por texto («Devolver») con `MutationObserver`; frágil ante cambios de traducción |
| `pos_order_report_qz_inherit.xml` | No confirmable sin acceso a la definición base `pos_conventional_receipt_custom.report_factura_simplificada_80mm` |

---

## Notas de mantenimiento

- Ficheros de modelo: `models/pos_config.py`, `models/pos_session.py`,
  `models/pos_order.py`, `models/pos_order_receipt.py`,
  `models/product_product.py`, `models/res_config_settings.py`.
- Controlador: `controllers/main.py`.
- Implementar `_can_access_pos_config` en `res.users` antes de usar la funcionalidad
  de acceso por slug en producción.
- Los campos de denominación en `pos.session` (`qty_*`) requieren que
  `pos_conventional_cash_calculator` los soporte; verificar compatibilidad tras
  actualizar esa suite.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
