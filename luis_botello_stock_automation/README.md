# luis_botello_stock_automation

## Propósito y valor para el cliente

Permite configurar en un albarán (o en cada movimiento de stock individual) un
**«siguiente tipo de operación»**. Al validar el albarán, el sistema crea
automáticamente un nuevo albarán del tipo indicado, con los mismos productos y
cantidades, listo para ser asignado y validado. Elimina la creación manual de
operaciones encadenadas y evita olvidos en flujos multi-paso.

---

## Alcance y fuera de alcance

**En alcance:**
- Campo `next_picking_type_id` en `stock.picking` y en `stock.move`.
- Creación automática de un albarán hijo al validar el padre.
- Prioridad: el tipo del movimiento individual prevalece sobre el de la cabecera
  del albarán.
- Enlace bidireccional entre albarán padre e hijos (`parent_picking_id`,
  `child_picking_ids`).
- Smart buttons en el formulario del albarán para navegar al padre y a los hijos.
- El campo de automatización solo se muestra visualmente cuando el tipo de
  operación es `internal` (restricción en la vista XML).

**Fuera de alcance:**
- Cadenas de más de un nivel no se configuran aquí directamente: cada albarán
  generado puede tener a su vez su propio `next_picking_type_id` si se desea.
- No genera picking automático para tipos `incoming` ni `outgoing` desde la vista
  (aunque no hay bloqueo en el código si se usa programáticamente).
- No hay configuración de reglas de reordenamiento ni abastecimiento.

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `stock` | Odoo Community |

Sin dependencias externas.

---

## Instalación y activación

1. Copie el módulo en el `addons-path`.
2. Actualice la lista de aplicaciones.
3. Instale `luis_botello_stock_automation`.

```bash
odoo --stop-after-init -u luis_botello_stock_automation -d <nombre_bd>
```

---

## Configuración

No requiere configuración global. El comportamiento se activa por albarán:

- **A nivel de cabecera:** campo `Siguiente tipo de operación` en el formulario
  del albarán. Se aplica a todos sus movimientos que no tengan tipo propio.
- **A nivel de línea:** campo `Siguiente tipo de operación` en el detalle de cada
  movimiento de stock.

Ambos campos solo son visibles si el tipo de operación del albarán es `internal`.

---

## Flujo funcional paso a paso

1. Crear o abrir un albarán de tipo **interno**.
2. Asignar el campo `Siguiente tipo de operación` en la cabecera o en uno o más
   movimientos de línea.
3. Confirmar y asignar el albarán.
4. Validar el albarán (`Validar`).
5. El sistema ejecuta `button_validate`:
   - Llama al `super()` estándar (valida el albarán original).
   - Si el estado queda `done`, ejecuta `_create_next_pickings`.
6. Para cada tipo de operación detectado (de línea o cabecera):
   - Se crea un nuevo `stock.picking` con origen = nombre del albarán original,
     `parent_picking_id` = albarán original.
   - Se crean los `stock.move` correspondientes con la cantidad validada.
   - El nuevo albarán se confirma (`action_confirm`) y se asigna
     (`action_assign`).
7. El albarán original muestra el smart button **«Sig. Traslados»** con el conteo
   de hijos. Los hijos muestran el smart button **«Origen Auto»**.

---

## Modelos, campos y métodos relevantes

### `stock.move` — `models/stock_move.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `next_picking_type_id` | `Many2one('stock.picking.type')` | Tipo de operación a crear tras validar este movimiento |

### `stock.picking` — `models/stock_picking.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `next_picking_type_id` | `Many2one('stock.picking.type')` | Tipo aplicado a todos los movimientos del albarán (si la línea no tiene uno propio) |
| `parent_picking_id` | `Many2one('stock.picking')` | Albarán que generó este automáticamente |
| `child_picking_ids` | `One2many('stock.picking', 'parent_picking_id')` | Albaranes generados desde este |
| `child_picking_count` | `Integer` (computed) | Número de albaranes hijos |

| Método | Descripción |
|---|---|
| `button_validate` | Override: tras validar, llama a `_create_next_pickings` si estado es `done` |
| `_create_next_pickings` | Agrupa movimientos por tipo de operación y crea los albaranes hijos |
| `action_view_child_pickings` | Abre la vista de albaranes hijos |
| `action_view_parent_picking` | Abre el formulario del albarán origen |

---

## Vistas, menús y acciones

Fichero: `views/stock_move_views.xml`

| Vista heredada | Cambio |
|---|---|
| `stock.view_move_form` | Añade grupo «Automatización» con `next_picking_type_id` (solo visible si `picking_code = 'internal'`) |
| `stock.view_stock_move_operations` | Añade `next_picking_type_id` en el grupo de cantidad |
| `stock.view_picking_form` | Añade `next_picking_type_id` en la cabecera; smart buttons padre/hijo en `button_box`; nota informativa en pestaña Extra |

No se añaden menús ni acciones nuevas.

---

## Permisos y seguridad

No se definen grupos ni reglas de acceso propios. Los campos nuevos heredan los
permisos de `stock.picking` y `stock.move` estándar.

---

## Datos y compatibilidad

- Versión declarada en manifest: **1.0** (sin prefijo de versión Odoo; recomendable
  normalizar a `19.0.1.0.0` en futuros mantenimientos).
- Licencia: **LGPL-3**.
- No incluye datos de demo ni de inicialización.

---

## Pruebas existentes

### `tests/test_stock_automation.py`

Clase: `TestStockAutomation` (hereda `TransactionCase`)
Sin tag `@tagged` — se ejecuta con cualquier suite de tests.

| Test | Verifica |
|---|---|
| `test_picking_automation_header` | Tipo en cabecera → se crea albarán hijo con mismo producto y cantidad |
| `test_picking_automation_line` | Tipo en movimiento de línea → se crea albarán hijo |

> ⚠️ **Riesgo documentado:** Los tests crean el producto con `type = 'consu'`
> (consumible). En Odoo 19, los productos almacenables usan `type = 'storable'`. El
> uso de `consu` es válido para consumibles pero puede no reflejar el caso de uso
> real si el cliente trabaja con productos almacenables. No se ha modificado el código.

```bash
odoo --stop-after-init --test-enable -d <bd> \
  -u luis_botello_stock_automation
```

---

## Operación y diagnóstico

- Si el albarán hijo no se crea, verifique que el albarán padre quedó en estado
  `done` (no `waiting`).
- Si la localización del albarán hijo no es correcta, revise los campos
  `default_location_src_id` y `default_location_dest_id` en el tipo de operación
  configurado.
- El campo `next_picking_type_id` no es visible en tipos `outgoing` o `incoming`
  por decisión de diseño de las vistas (atributo `invisible`), pero el código no
  impide su uso si se asigna programáticamente.
- Los albaranes hijos quedan en estado `assigned` (si hay stock disponible) o
  `confirmed` (si no hay stock); deben validarse manualmente.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| Sin validación de ciclos | Si A genera B y B está configurado para generar A, se puede crear un bucle infinito en futuras validaciones |
| Sin herencia de `next_picking_type_id` | El albarán hijo no hereda el `next_picking_type_id` del padre; cada nivel debe configurarse manualmente |
| Productos con trazabilidad | No se gestionan lotes/series en los movimientos del albarán hijo |
| Versión en manifest | El campo `version` es `'1.0'` sin prefijo de versión Odoo; puede causar problemas en actualizaciones automáticas |

---

## Notas de mantenimiento

- Ficheros clave: `models/stock_picking.py`, `models/stock_move.py`.
- Vista: `views/stock_move_views.xml`.
- Si en el futuro se necesita soporte para trazabilidad (lotes/seriales), hay que
  añadir la copia de `move_line_ids` al crear los movimientos del albarán hijo.
- Considerar añadir un campo `next_picking_type_id` en `stock.picking.type` para
  autoconfigurar el siguiente paso sin intervención manual en cada albarán.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
