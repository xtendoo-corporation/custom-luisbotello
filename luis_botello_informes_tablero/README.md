# luis_botello_informes_tablero

## Propósito y valor para el cliente

Añade dos informes analíticos de TPV al módulo **Tableros** de Odoo:

1. **Pedidos por día y caja:** número de pedidos, importe total y ticket medio
   agrupados por día y caja TPV.
2. **Pedidos por tramo horario:** los mismos indicadores pero desagregados por
   franja de una hora dentro del día.

Ambos informes también se publican como **dashboards interactivos de Spreadsheet**
en el grupo «Punto de venta» de Tableros. Facilitan el seguimiento diario y la
detección de franjas horarias de mayor actividad sin necesidad de exportar datos.

---

## Alcance y fuera de alcance

**En alcance:**
- Modelo SQL `luis.botello.pos.daily.report` (vista PostgreSQL diaria).
- Modelo SQL `luis.botello.pos.hourly.report` (vista PostgreSQL por hora).
- Vistas lista, pivot y gráfico de barras para ambos modelos.
- Menús bajo **Tableros → TPV Luis Botello**.
- Dos dashboards de Spreadsheet publicados en **Tableros → Punto de venta**.
- Agrupación por hora en zona horaria de la compañía (no UTC).
- Pedidos cancelados y borradores excluidos de ambos informes.

**Fuera de alcance:**
- No incluye informes por método de pago ni por producto.
- No incluye datos de coste ni margen.
- La edición del contenido de los dashboards Spreadsheet requiere acceso al
  fichero JSON (`data/files/`).

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `point_of_sale` | Odoo Community |
| `spreadsheet_dashboard` | Odoo Community (Enterprise o Community ≥ 17) |

> ⚠️ `spreadsheet_dashboard` puede no estar disponible en Odoo Community sin
> módulos adicionales de OCA o Enterprise. Verificar disponibilidad antes de
> instalar.

---

## Instalación y activación

1. Verifique que `spreadsheet_dashboard` está instalado.
2. Copie el módulo en el `addons-path`.
3. Instale `luis_botello_informes_tablero`.

```bash
odoo --stop-after-init -u luis_botello_informes_tablero -d <nombre_bd>
```

Las vistas SQL se crean automáticamente en la instalación.

---

## Configuración

No requiere configuración adicional. Los informes y dashboards están publicados
(`is_published = True`) y visibles para los grupos `group_pos_user` y
`group_pos_manager` inmediatamente tras la instalación.

---

## Flujo funcional paso a paso

### Informe diario

1. Ir a **Tableros → TPV Luis Botello → Pedidos por día y caja**.
2. La vista lista muestra los registros ordenados por fecha descendente, agrupados
   por día por defecto.
3. Cambiar a **Vista Pivot** para análisis multidimensional (Día × Caja × Métricas).
4. Cambiar a **Vista Gráfico** para visualizar la evolución temporal como barras.
5. Filtrar por fecha, caja o compañía usando la barra de búsqueda.

### Informe horario

1. Ir a **Tableros → TPV Luis Botello → Pedidos por tramo horario**.
2. La vista lista muestra Día, Caja, Tramo horario (p. ej. `09:00 - 09:59`),
   número de pedidos, importe y ticket medio.
3. Vista Pivot y Gráfico disponibles para análisis.

### Dashboards Spreadsheet

- **Tableros → Punto de venta → Pedidos por día y caja**
- **Tableros → Punto de venta → Pedidos por tramo horario**

---

## Modelos, campos y métodos relevantes

### `luis.botello.pos.daily.report` — `report/pos_daily_report.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `display_name` | `Char` | `«Nombre caja - DD/MM/YYYY»` |
| `report_date` | `Date` | Fecha del día (en zona horaria de la compañía) |
| `config_id` | `Many2one('pos.config')` | Caja TPV |
| `company_id` | `Many2one('res.company')` | Compañía |
| `currency_id` | `Many2one('res.currency')` | Moneda |
| `order_count` | `Integer` | Número de pedidos del día |
| `amount_total` | `Monetary` | Suma de importes totales |
| `average_ticket` | `Monetary` | Media de `amount_total` por pedido |

| Método | Descripción |
|---|---|
| `init` | Crea/reemplaza la vista SQL `luis_botello_pos_daily_report` |

### `luis.botello.pos.hourly.report` — `report/pos_hourly_report.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `display_name` | `Char` | `«Nombre caja - DD/MM/YYYY - HH:00 - HH:59»` |
| `report_date` | `Date` | Fecha del día |
| `config_id` | `Many2one('pos.config')` | Caja TPV |
| `slot_hour` | `Integer` | Hora del tramo (0–23) |
| `time_slot` | `Char` | Tramo legible (`HH:00 - HH:59`) |
| `order_count` | `Integer` | Número de pedidos en el tramo |
| `amount_total` | `Monetary` | Suma de importes |
| `average_ticket` | `Monetary` | Ticket medio del tramo |

| Método | Descripción |
|---|---|
| `init` | Crea/reemplaza la vista SQL `luis_botello_pos_hourly_report` |

**Nota sobre zona horaria:** ambas vistas usan
`timezone(COALESCE(partner.tz, 'UTC'), po.date_order AT TIME ZONE 'UTC')`
para convertir la fecha del pedido a la zona horaria del partner de la compañía.
Si la compañía no tiene zona horaria configurada, se usa UTC.

---

## Vistas, menús y acciones

### Informe diario — `views/pos_daily_report_views.xml`

| Elemento | Descripción |
|---|---|
| `view_luis_botello_pos_daily_report_search` | Filtros por fecha, caja, compañía; agrupaciones |
| `view_luis_botello_pos_daily_report_list` | Lista: Fecha, Caja, Pedidos, Importe total, Ticket medio |
| `view_luis_botello_pos_daily_report_pivot` | Pivot: Fecha y Caja × métricas |
| `view_luis_botello_pos_daily_report_graph` | Gráfico de barras: Fecha, Caja, Importe/Pedidos |
| `action_luis_botello_pos_daily_report` | Acción: modos list, pivot, graph |

### Informe horario — `views/pos_hourly_report_views.xml`

| Elemento | Descripción |
|---|---|
| `view_luis_botello_pos_hourly_report_search` | Filtros por fecha, caja, tramo, compañía |
| `view_luis_botello_pos_hourly_report_list` | Lista: Fecha, Caja, Tramo, Pedidos, Importe, Ticket medio |
| `view_luis_botello_pos_hourly_report_pivot` | Pivot: Fecha × Caja × Tramo × métricas |
| `view_luis_botello_pos_hourly_report_graph` | Gráfico de barras |
| `action_luis_botello_pos_hourly_report` | Acción: modos list, pivot, graph |

### Menús — `views/menu_views.xml`

| Menú | Ruta |
|---|---|
| `menu_luis_botello_tableros_root` | Tableros → **TPV Luis Botello** |
| `menu_luis_botello_pos_daily_report` | Tableros → TPV Luis Botello → **Pedidos por día y caja** |
| `menu_luis_botello_pos_hourly_report` | Tableros → TPV Luis Botello → **Pedidos por tramo horario** |

Acceso: `point_of_sale.group_pos_user` y `point_of_sale.group_pos_manager`.

### Dashboards Spreadsheet — `data/spreadsheet_dashboards.xml`

| Dashboard | Grupo Spreadsheet | Publicado |
|---|---|---|
| `Pedidos por día y caja` | Punto de venta | ✓ |
| `Pedidos por tramo horario` | Punto de venta | ✓ |

Ficheros JSON: `data/files/pos_daily_dashboard.json`,
`data/files/pos_hourly_dashboard.json`.

---

## Permisos y seguridad

Fichero: `security/ir.model.access.csv`

| Modelo | Grupo | Leer |
|---|---|---|
| `luis.botello.pos.daily.report` | `point_of_sale.group_pos_user` | ✓ |
| `luis.botello.pos.daily.report` | `point_of_sale.group_pos_manager` | ✓ |
| `luis.botello.pos.hourly.report` | `point_of_sale.group_pos_user` | ✓ |
| `luis.botello.pos.hourly.report` | `point_of_sale.group_pos_manager` | ✓ |

Solo lectura. No se permiten escritura, creación ni borrado.

---

## Datos y compatibilidad

- Versión Odoo: **19.0** (declarado en manifest).
- Licencia: **AGPL-3**.
- No incluye datos de demo.
- Los ficheros JSON de los dashboards Spreadsheet están en `data/files/` y se
  cargan como datos binarios base64.

---

## Pruebas existentes

### `tests/test_pos_dashboard_reports.py`

Clase: `TestLuisBotelloPosDashboardReports`
Tag: `@tagged('luis_botello_informes_tablero', 'post_install', '-at_install')`

| Test | Verifica |
|---|---|
| `test_01_actions_are_available` | Las acciones referencian los modelos correctos y los modos de vista |
| `test_02_reports_are_queryable` | Las vistas SQL se pueden consultar sin errores; el menú raíz existe |
| `test_03_spreadsheet_dashboards_are_published` | Los dashboards Spreadsheet están publicados y en el grupo correcto |
| `test_04_hourly_report_action_is_still_available` | La acción del informe horario sigue existiendo |

```bash
odoo --stop-after-init --test-enable -d <bd> \
  --test-tags luis_botello_informes_tablero -u luis_botello_informes_tablero
```

---

## Operación y diagnóstico

- Si los informes aparecen vacíos, verificar que existen pedidos TPV en estado
  distinto de `draft` y `cancel`.
- Si los totales diarios no coinciden con los esperados, revisar la zona horaria
  del partner de la compañía (campo `tz` en `res.partner`).
- Si los dashboards Spreadsheet no aparecen en Tableros, verificar que
  `spreadsheet_dashboard` está instalado y que el usuario tiene acceso a
  `point_of_sale.group_pos_user`.
- Si la vista SQL falla, ejecutar el `init` del modelo manualmente vía shell de
  Odoo o reiniciar el módulo con `-u luis_botello_informes_tablero`.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| `spreadsheet_dashboard` | Puede no estar disponible en Odoo Community puro |
| Zona horaria de compañía | Usa `partner.tz`; si no está configurado, usa UTC |
| Sin filtro de fecha por defecto en gráficos | Los gráficos muestran todos los datos sin rango de fechas por defecto |
| Dashboards JSON hardcoded | El contenido de los dashboards Spreadsheet está en ficheros JSON; no se actualiza automáticamente con nuevos datos estructurales |

---

## Notas de mantenimiento

- Modelos: `report/pos_daily_report.py`, `report/pos_hourly_report.py`.
- Vistas: `views/pos_daily_report_views.xml`, `views/pos_hourly_report_views.xml`,
  `views/menu_views.xml`.
- Datos: `data/spreadsheet_dashboards.xml`, `data/files/*.json`.
- Las vistas SQL se reconstruyen completamente en cada `init`; no dejan registros
  huérfanos.
- Si se modifica la estructura de `pos_order`, revisar las CTEs de ambos `init`.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
