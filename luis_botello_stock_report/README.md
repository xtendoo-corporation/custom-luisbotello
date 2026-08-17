# luis_botello_stock_report

## Propósito y valor para el cliente

Proporciona un **informe de stock consolidado** que muestra, en una sola vista,
las existencias de todos los productos sumando todos los almacenes. Permite al
equipo de almacén ver de un vistazo el stock total, reservado y disponible sin
necesidad de filtrar almacén por almacén, con acceso a vistas pivot y lista desde
el menú de informes de inventario.

---

## Alcance y fuera de alcance

**En alcance:**
- Modelo SQL `luis_botello.stock_report` (vista PostgreSQL, `_auto = False`).
- Campos: producto, plantilla, categoría, unidad de medida, compañía, almacén,
  cantidad total, cantidad reservada, cantidad disponible.
- Vista lista con suma de disponibles y vista pivot por almacén.
- Filtro «Con Stock» (cantidad > 0) activado por defecto.
- Menú **Inventario → Informes → Stock consolidado**.
- Acceso restringido a `stock.group_stock_user` (solo lectura).

**Fuera de alcance:**
- No muestra stock por ubicación (solo por almacén).
- No incluye valoración contable del stock.
- No permite editar ni crear registros desde la vista.
- No incluye vista gráfica ni kanban.
- No hay tests implementados.

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `stock` | Odoo Community |
| `product` | Odoo Community |

Sin dependencias externas.

---

## Instalación y activación

1. Copie el módulo en el `addons-path`.
2. Actualice la lista de aplicaciones.
3. Instale `luis_botello_stock_report`.

```bash
odoo --stop-after-init -u luis_botello_stock_report -d <nombre_bd>
```

La vista SQL se crea o reemplaza automáticamente al instalar/actualizar.

---

## Configuración

No requiere configuración. El acceso está disponible para todos los usuarios con
el perfil `stock.group_stock_user`.

---

## Flujo funcional paso a paso

1. Ir a **Inventario → Informes → Stock consolidado**.
2. La vista muestra por defecto solo productos con stock > 0 (filtro «Con Stock»).
3. Puede cambiar entre:
   - **Lista:** columnas Producto y Disponible (con suma total).
   - **Pivot:** filas por Producto, columnas por Almacén, medida Disponible.
4. Buscar por producto o categoría usando la barra de búsqueda.
5. Quitar el filtro «Con Stock» para ver también productos sin existencias.

---

## Modelos, campos y métodos relevantes

### `luis_botello.stock_report` — `models/stock_report.py`

Modelo de solo lectura (`_auto = False`). La vista SQL agrega `stock_quant`
uniendo `product_product`, `product_template` y `stock_location`.

| Campo | Tipo | Descripción |
|---|---|---|
| `product_id` | `Many2one('product.product')` | Variante de producto |
| `product_tmpl_id` | `Many2one('product.template')` | Plantilla de producto |
| `categ_id` | `Many2one('product.category')` | Categoría del producto |
| `uom_id` | `Many2one('uom.uom')` | Unidad de medida |
| `company_id` | `Many2one('res.company')` | Compañía |
| `warehouse_id` | `Many2one('stock.warehouse')` | Almacén (desde `stock_location.warehouse_id`) |
| `qty` | `Float` | Suma de `stock_quant.quantity` |
| `reserved_qty` | `Float` | Suma de `stock_quant.reserved_quantity` |
| `available_qty` | `Float` | `qty - reserved_qty` |

| Método | Descripción |
|---|---|
| `init` | Crea/reemplaza la vista SQL `luis_botello_stock_report` en PostgreSQL |

**SQL de la vista:**

```sql
SELECT
    row_number() OVER () AS id,
    sq.product_id,
    pp.product_tmpl_id,
    pt.categ_id,
    pt.uom_id,
    sq.company_id,
    sl.warehouse_id,
    SUM(COALESCE(sq.quantity, 0)) AS qty,
    SUM(COALESCE(sq.reserved_quantity, 0)) AS reserved_qty,
    SUM(COALESCE(sq.quantity, 0) - COALESCE(sq.reserved_quantity, 0)) AS available_qty
FROM stock_quant sq
JOIN product_product pp ON pp.id = sq.product_id
JOIN product_template pt ON pt.id = pp.product_tmpl_id
JOIN stock_location sl ON sl.id = sq.location_id
GROUP BY sq.product_id, pp.product_tmpl_id, pt.categ_id, pt.uom_id, sq.company_id, sl.warehouse_id
```

> ⚠️ La vista **no filtra por tipo de ubicación**. Incluye todas las ubicaciones
> de `stock_quant` (internas, de tránsito, virtuales). Esto puede inflar los
> totales respecto a los informes estándar de Odoo que solo cuentan ubicaciones
> internas.

---

## Vistas, menús y acciones

Fichero: `views/luis_botello_stock_report_views.xml`

| Elemento | Descripción |
|---|---|
| `view_luis_botello_stock_report_search` | Búsqueda por producto y categoría; filtro «Con Stock» |
| `view_luis_botello_stock_report_list` | Lista: Producto y Disponible (suma); sin crear ni editar |
| `view_luis_botello_stock_report_pivot` | Pivot: Producto × Almacén, medida Disponible |
| `action_luis_botello_stock_report` | Acción: modos pivot, list, form; filtro «Con Stock» por defecto |
| `menu_luis_botello_stock_report` | **Inventario → Informes → Stock consolidado** |

---

## Permisos y seguridad

Fichero: `security/ir.model.access.csv`

| Acceso | Modelo | Grupo | Leer |
|---|---|---|---|
| `access_luis_botello_stock_report_user` | `luis_botello.stock_report` | `stock.group_stock_user` | ✓ |

Solo lectura. No se permiten escritura, creación ni borrado (la vista SQL es de
solo lectura por naturaleza).

---

## Datos y compatibilidad

- Versión Odoo: **19.0** (declarado en manifest).
- Licencia: **LGPL-3**.
- No incluye datos de demo.
- La vista SQL se recrea en cada `init` del modelo (DROP + CREATE OR REPLACE).

---

## Pruebas existentes

**No hay tests implementados para este módulo.**

> ⚠️ **Riesgo documentado:** La ausencia de tests impide verificar el SQL de la
> vista. Se recomienda crear al menos un test que:
> - Verifique que la vista se puede consultar sin errores.
> - Compruebe que el `available_qty` coincide con el stock real de un producto de
>   prueba.
> - Valide el filtro por almacén en la vista pivot.

---

## Operación y diagnóstico

- Si el menú **Stock consolidado** no aparece, verifique que el usuario tiene el
  perfil `stock.group_stock_user`.
- Si los totales difieren de los informes estándar de Odoo, es probable que la
  vista incluya ubicaciones no internas. Para alinearse con el estándar, habría
  que añadir `JOIN stock_location sl ON sl.usage = 'internal'` al SQL.
- Si la vista SQL presenta errores tras una actualización de Odoo, revisar el
  esquema de `stock_quant`, `stock_location`, `product_product` y
  `product_template`.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| Sin filtro de tipo de ubicación | Puede incluir stock en ubicaciones de tránsito o virtuales |
| Sin tests | No hay cobertura automatizada |
| Vista pivot sin total acumulado | La lista muestra suma en `available_qty`, el pivot no filtra por defecto |
| `warehouse_id` de `stock_location` | Si una ubicación no está vinculada a un almacén, `warehouse_id` será NULL |

---

## Notas de mantenimiento

- Fichero único de lógica: `models/stock_report.py`.
- Vista XML: `views/luis_botello_stock_report_views.xml`.
- Si se añaden nuevas columnas, el `init` debe reconstruir la vista completa.
- Considerar añadir `WHERE sl.usage = 'internal'` al SQL para excluir
  ubicaciones no físicas.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
