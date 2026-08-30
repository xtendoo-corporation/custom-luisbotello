# luis_botello_stock_count_add

## Propósito y valor para el cliente

Modifica el comportamiento del conteo de inventario de Odoo para que sea
**aditivo**: cuando se introduce una cantidad contada en una sesión de ajuste de
inventario activa, la nueva cantidad se **suma** a la ya registrada en lugar de
sobrescribirla. Esto permite registrar el recuento en varias pasadas o por
diferentes operarios sobre el mismo producto/ubicación sin perder los conteos
anteriores de la misma sesión no aplicada.

---

## Alcance y fuera de alcance

**En alcance:**
- Override de `stock.quant.create` para acumular `inventory_quantity` cuando
  el quant ya existe y tiene `inventory_quantity_set = True`.
- Comportamiento aditivo solo activo en **modo inventario** (`_is_inventory_mode()`).
- Comportamiento `auto_apply` (`inventory_quantity_auto_apply`) no modificado:
  mantiene la lógica estándar.
- Compatibilidad con importación de fichero (`import_file`): en ese caso se
  mantiene la lógica original de merge.

**Fuera de alcance:**
- No modifica el proceso de aplicación del inventario (`action_apply_inventory`).
- No afecta al stock real hasta que el inventario se aplica.
- No añade interfaces de usuario ni campos visibles adicionales.
- No gestiona el caso de múltiples compañías de forma diferente al estándar.

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
3. Instale `luis_botello_stock_count_add`.

```bash
odoo --stop-after-init -u luis_botello_stock_count_add -d <nombre_bd>
```

El módulo no requiere configuración posterior.

---

## Configuración

No requiere configuración. El comportamiento aditivo se activa automáticamente
siempre que Odoo esté en modo inventario. No hay ajustes de empresa ni de usuario.

---

## Flujo funcional paso a paso

1. Ir a **Inventario → Operaciones → Ajuste de inventario** (o cualquier interfaz
   de inventario físico).
2. Registrar la primera cantidad contada para un producto/ubicación. Odoo crea o
   actualiza el `stock.quant` con `inventory_quantity` y marca
   `inventory_quantity_set = True`.
3. Volver a introducir una cantidad para el mismo producto/ubicación **sin haber
   aplicado el inventario**.
4. Con este módulo instalado, la nueva cantidad se **suma** a la existente:
   `inventory_quantity_nuevo = inventory_quantity_existente + cantidad_nueva`.
5. Si no se había contado antes (`inventory_quantity_set = False`), se comporta
   como el estándar: fija la cantidad sin sumar.
6. Aplicar el inventario normalmente cuando el conteo esté completo.

---

## Modelos, campos y métodos relevantes

### `stock.quant` — `models/stock_quant_merge.py`

| Método | Descripción |
|---|---|
| `create` (override) | Lógica aditiva: si el quant existe y `inventory_quantity_set = True`, suma en lugar de sobrescribir `inventory_quantity` |

**Lógica clave en `create`:**

```
si modo_inventario Y el quant ya existe Y inventory_quantity_set=True:
    inventory_quantity = valor_existente + valor_nuevo
sino:
    comportamiento estándar (fijar)
```

El método replica internamente parte de la lógica del `create` original de
`stock.quant` para garantizar la compatibilidad con el contexto `import_file` y
con el manejo de lotes (`lot_id`).

---

## Vistas, menús y acciones

No se añaden vistas, menús ni acciones. El módulo opera exclusivamente en la
capa del modelo.

---

## Permisos y seguridad

No se definen grupos ni reglas de acceso propios. Los permisos heredan los de
`stock.quant` estándar.

No existe fichero `security/ir.model.access.csv`.

---

## Datos y compatibilidad

- Versión Odoo: **19.0** (declarado en manifest).
- Licencia: **AGPL-3**.
- No incluye datos de demo ni de inicialización.
- No hay vistas ni datos XML.

La vista estándar de ajuste de inventario también incorpora una mejora de teclado
limitada al contexto `inventory_mode`: las nuevas líneas heredan la última ubicación
seleccionada, el foco comienza en `product_id`, y `TAB` salta a `inventory_quantity`
(o a `lot_id` para productos por lote o serie). `ENTER` en la cantidad conserva el
guardado estándar y prepara la siguiente línea sin modificar la navegación de otras
listas de Odoo.

---

## Pruebas existentes

El directorio `tests/` contiene únicamente `__init__.py` vacío.

**No hay tests implementados para este módulo.**

> ⚠️ **Riesgo documentado:** La ausencia de tests impide verificar el
> comportamiento aditivo de forma automatizada. Se recomienda crear tests que
> cubran al menos:
> - Primer conteo (comportamiento estándar).
> - Segundo conteo del mismo producto/ubicación (suma).
> - Caso con `auto_apply` (no debe sumar).
> - Caso con `import_file` en contexto (debe mantener comportamiento original).

---

## Operación y diagnóstico

- El comportamiento aditivo solo se activa cuando `_is_inventory_mode()` devuelve
  `True`. En Odoo 19, esto ocurre cuando el contexto incluye `{'inventory_mode': True}`,
  que es el que activa la interfaz de ajuste de inventario.
- Si se observa que el inventario sigue sobrescribiendo en lugar de sumar,
  verifique que `inventory_quantity_set` está en `True` en el quant antes del
  segundo conteo.
- Logs relevantes: no se generan logs propios; cualquier error aparecerá en el
  log estándar de Odoo como `UserError` del `stock.quant`.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| Sin tests | No hay cobertura automatizada del comportamiento aditivo |
| Override extenso | El método `create` replica lógica interna de Odoo; puede desincronizarse en actualizaciones de versión |
| No se suman `auto_apply` | Si se usa `inventory_quantity_auto_apply`, el comportamiento es el estándar (no aditivo) |
| Sin deshacer parcial | No hay forma de restar una cantidad contada ya sumada sin aplicar y corregir manualmente |

---

## Notas de mantenimiento

- Fichero único de lógica: `models/stock_quant_merge.py`.
- El método `create` de `stock.quant` puede cambiar entre versiones menores de
  Odoo 19. Revisar tras cualquier actualización de Odoo.
- Se recomienda añadir tests unitarios antes de desplegar en entornos de
  producción con inventarios activos.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
