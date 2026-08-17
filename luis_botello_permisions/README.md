# luis_botello_permisions

## Propósito y valor para el cliente

Centraliza y amplía el control de acceso en cuatro áreas:

1. **Visibilidad de márgenes y costes:** campo `standard_price`, márgenes y
   porcentajes de margen en ventas, facturas, productos y TPV; solo visible para
   usuarios del grupo «Mostrar Márgenes y Costes».
2. **Control de traspasos entre almacenes:** separa quién puede *crear* traspasos
   internos de quién solo puede *recepcionar*.
3. **Botón «Crear factura» en pedidos de compra:** visiblez controlada por
   `purchase.group_purchase_user`.
4. **Asistente de sincronización de categorías TPV → Producto:** permite copiar
   las categorías de TPV como categorías de producto bajo una categoría padre
   elegida.

---

## Alcance y fuera de alcance

**En alcance:**
- Grupo `group_show_margin` (categoría «Luis Botello Permisos») que restringe
  la visibilidad de márgenes/costes en vistas de venta, factura, producto y TPV.
- Grupo `group_warehouse_transfer` con reglas de registro para crear/editar
  albaranes internos.
- Grupo `group_warehouse_transfer_receiver` para validar albaranes internos
  existentes sin poder crearlos.
- Wizard `pos.category.to.product` para copiar categorías TPV a categorías de
  producto.
- Override del formulario de pedido de compra para añadir el botón «Crear
  factura».

**Fuera de alcance:**
- No restringe la visibilidad de márgenes en el frontend TPV OWL (solo backend).
- No cubre el módulo `account_invoice_margin` para el campo `purchase_price` en
  líneas de factura en Odoo 19 (comentado en el código porque el campo no existe
  en la versión actual).
- No gestiona permisos de otros módulos de la suite.

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `base` | Odoo Community |
| `sale_margin` | Odoo Community |
| `point_of_sale` | Odoo Community |
| `account` | Odoo Community |
| `account_invoice_margin` | Odoo Community / OCA |
| `product` | Odoo Community |
| `pos_conventional_core` | Xtendoo (externo) |
| `purchase` | Odoo Community |
| `stock` | Odoo Community |

> ⚠️ `account_invoice_margin` debe estar instalado. `pos_conventional_core` es de
> la suite POS Convencional de Xtendoo.

---

## Instalación y activación

1. Asegúrese de que `pos_conventional_core` y `account_invoice_margin` están
   instalados.
2. Copie el módulo en el `addons-path`.
3. Instale `luis_botello_permisions`.

```bash
odoo --stop-after-init -u luis_botello_permisions -d <nombre_bd>
```

---

## Configuración

### Grupo «Mostrar Márgenes y Costes»

1. Ir a **Ajustes → Usuarios y compañías → Usuarios**.
2. Abrir el usuario.
3. En el privilegio **«Permisos Especiales»** (categoría *Luis Botello Permisos*),
   marcar **«Mostrar Márgenes y Costes»**.

Los usuarios administrador (`base.user_root`, `base.user_admin`) tienen este
grupo asignado por defecto en el XML de datos.

### Grupo «Traspasos entre almacenes»

1. Ir a **Ajustes → Usuarios y compañías → Usuarios**.
2. Abrir el usuario.
3. En el privilegio **«Permisos Especiales»**, marcar **«Traspasos entre
   almacenes»**.

Los usuarios administrador tienen este grupo asignado por defecto.

### Grupo «Recepcionar traspasos entre almacenes»

Asignar a usuarios que solo deben poder *validar* traspasos ya creados (no crear
nuevos albaranes internos).

### Asistente de sincronización de categorías

**Punto de venta → Configuración → Productos → Sincronizar Categorías**

Acceso restringido a `point_of_sale.group_pos_manager`.

---

## Flujo funcional: traspasos entre almacenes

1. Usuario SIN grupo `group_warehouse_transfer` → intento de crear albarán
   `internal` → `AccessError`.
2. Usuario CON grupo `group_warehouse_transfer` → puede crear, editar y validar
   albaranes internos.
3. Usuario CON grupo `group_warehouse_transfer_receiver` → puede editar albaranes
   internos existentes (validarlos), pero **no** crearlos.
4. Todos los usuarios de inventario siguen pudiendo crear y gestionar recepciones
   (`incoming`) y entregas (`outgoing`).

### Matriz de acceso a `stock.picking`

| Operación | `group_stock_user` solo | `group_warehouse_transfer` | `group_warehouse_transfer_receiver` |
|---|---|---|---|
| Crear interno | ❌ | ✓ | ❌ |
| Editar/validar interno | ❌ | ✓ | ✓ |
| Ver internos | ✓ (lectura) | ✓ | ✓ |
| Crear/editar entradas y salidas | ✓ | ✓ | ✓ |

> **Nota técnica:** Las reglas de registro (`ir.rule`) aplican por operación. La
> regla `rule_stock_picking_no_transfer` solo restringe escritura/creación/borrado
> (no lectura) para `group_stock_user`. La regla `rule_stock_picking_transfer`
> permite todo a `group_warehouse_transfer`. La regla
> `rule_stock_picking_transfer_receiver` solo permite escritura.

---

## Modelos, campos y métodos relevantes

No se añaden modelos propios. Se heredan vistas mediante XPath para controlar
visibilidad con atributo `groups`.

### Wizard `pos.category.to.product` — `wizard/pos_category_to_product.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `parent_id` | `Many2one('product.category')` | Categoría padre bajo la que se crearán las categorías |

| Método | Descripción |
|---|---|
| `action_copy_categories` | Crea categorías de producto desde categorías TPV; asigna `categ_id` a los productos |

---

## Vistas, menús y acciones

### Vistas de control de visibilidad de márgenes

| Vista | Modelo | Campos protegidos |
|---|---|---|
| `sale_margin_sale_order_groups` | `sale.order` | `margin`, `purchase_price`, `margin_percent` en líneas |
| `invoice_margin_form_tree_groups` | `account.move` | `margin`, `margin_percent` en líneas y totales de factura |
| `view_account_invoice_tree_groups` | `account.move` | `margin_signed`, `margin_percent` en lista |
| `product_template_form_view_groups` | `product.template` | `standard_price` |
| `product_variant_form_view_groups` | `product.product` | `standard_price` |
| `product_template_tree_view_groups` | `product.template` | `standard_price` en lista |
| `product_product_tree_view_groups` | `product.product` | `standard_price` en lista |
| `view_pos_pos_form_groups` | `pos.order` | `margin`, `margin_percent`, `total_cost` en líneas |
| `view_pos_order_tree_groups` | `pos.order` | `margin`, `margin_percent` en lista |

### Vista de pedidos de compra

| Vista | Cambio |
|---|---|
| `purchase_order_form_inherit_create_bill` | Botón «Crear factura» para `purchase.group_purchase_user` |

### Menú del asistente

**Punto de venta → Configuración → Productos → Sincronizar Categorías**
Acceso: `point_of_sale.group_pos_manager`

---

## Permisos y seguridad

Fichero: `security/security.xml`

| Grupo | XML ID | Descripción |
|---|---|---|
| Mostrar Márgenes y Costes | `group_show_margin` | Admins por defecto; añadir manualmente a otros usuarios |
| Traspasos entre almacenes | `group_warehouse_transfer` | Implica `stock.group_stock_user`; admins por defecto |
| Recepcionar traspasos | `group_warehouse_transfer_receiver` | Implica `stock.group_stock_user` |

Fichero: `security/ir.model.access.csv`

| Modelo | Grupo | Permisos |
|---|---|---|
| `pos.category.to.product` | `point_of_sale.group_pos_manager` | Leer, escribir, crear, borrar |

Reglas de registro sobre `stock.picking`:
- `rule_stock_picking_no_transfer`: bloquea creación/edición de internos a `group_stock_user`.
- `rule_stock_picking_transfer`: acceso total a `group_warehouse_transfer`.
- `rule_stock_picking_transfer_receiver`: solo escritura a `group_warehouse_transfer_receiver`.

---

## Datos y compatibilidad

- Versión declarada en manifest: **1.0** (sin prefijo de versión Odoo).
- Licencia: **LGPL-3**.
- No incluye datos de demo.
- En el XML de vistas de `account.move` hay XPaths comentados para `purchase_price`
  porque ese campo no existe en `account.move.line` en Odoo 19.

---

## Pruebas existentes

### `tests/test_permissions.py`

#### `TestLuisBotelloPermissions`

| Test | Verifica |
|---|---|
| `test_01_group_assignment` | Los grupos se asignan y detectan correctamente |
| `test_02_view_fields_visibility_logic` | Las vistas heredadas contienen las referencias al grupo en su `arch` |

#### `TestWarehouseTransferPermissions`

| Test | Verifica |
|---|---|
| `test_10_transfer_group_implies_stock_user` | El grupo de traspasos implica `group_stock_user` |
| `test_11_user_without_permission_cannot_create_internal` | Sin permiso → `AccessError` al crear interno |
| `test_12_user_without_permission_can_create_incoming` | Sin permiso sí puede crear recepciones |
| `test_13_user_with_permission_can_create_internal` | Con permiso → puede crear interno |
| `test_14_user_without_permission_cannot_write_internal` | Sin permiso → `AccessError` al editar interno |
| `test_15_receiver_can_write_internal_but_cannot_create_it` | Receiver puede editar pero no crear |

```bash
odoo --stop-after-init --test-enable -d <bd> \
  -u luis_botello_permisions --test-tags /luis_botello_permisions
```

---

## Operación y diagnóstico

- Si un usuario sigue viendo márgenes sin tener el grupo, verificar que las vistas
  se han actualizado tras la instalación y que el usuario no pertenece a un grupo
  administrador que omita las restricciones.
- Si un usuario con `group_stock_user` puede crear traspasos internos, revisar
  que las reglas de registro están activas en Ajustes → Técnico → Reglas de
  registros.
- Consultar `docs/guia_cliente_traspasos.md` para la explicación orientada al
  usuario final sobre el funcionamiento de los traspasos.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| `purchase_price` comentado en facturas | El campo no existe en Odoo 19; no se protege por grupos en factura |
| `pos_conventional_core` requerido | Dependencia de suite Xtendoo; la vista de TPV hereda de esa suite |
| Sin cobertura de visibilidad de costes en frontend POS | La protección es solo en backend |

---

## Notas de mantenimiento

- Ficheros de seguridad: `security/security.xml`, `security/ir.model.access.csv`.
- Wizard: `wizard/pos_category_to_product.py`.
- Las reglas de registro se aplican a nivel de base de datos; cualquier cambio
  requiere actualización del módulo.
- Documentación adicional orientada al cliente en `docs/guia_cliente_traspasos.md`.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
