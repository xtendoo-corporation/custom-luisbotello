# Luis Botello - Permisos

Módulo para Odoo 19 Community que gestiona permisos personalizados de la instalación:

- Visibilidad de **márgenes y costes** en ventas, facturas, productos y TPV.
- Control de **traspasos entre almacenes** (quién puede crearlos y quién solo recepcionar).

## Traspasos entre almacenes

Permite separar dos responsabilidades sobre los traspasos internos de stock:

- **Crear y validar traspasos**: reservado a los usuarios del grupo autorizado.
- **Recepcionar**: disponible para el resto de usuarios de inventario.

### Cómo funciona

Se apoya en un grupo de seguridad y dos reglas de registro (`ir.rule`) sobre
`stock.picking`:

- **Grupo `Traspasos entre almacenes`** (`group_warehouse_transfer`): implica
  `stock.group_stock_user` y da acceso total a los albaranes.
- **Regla sin permiso**: a los usuarios de inventario les impide crear, editar o
  borrar albaranes de tipo `internal` (dominio `picking_type_id.code != 'internal'`).
  No restringe la lectura ni las recepciones.
- **Regla con permiso**: los miembros del grupo tienen acceso completo a
  `stock.picking`.

Está diseñado para traspasos en **2 pasos**: salida (`internal`) en el almacén origen
y recepción (`incoming`) en el almacén destino.

| Acción                          | Con el grupo | Sin el grupo         |
| ------------------------------- | ------------ | -------------------- |
| Crear traspaso interno          | ✅           | ❌ (error de acceso) |
| Validar / editar traspaso       | ✅           | ❌                   |
| Ver traspasos                   | ✅           | ✅ (solo lectura)    |
| Recepcionar (entradas)          | ✅           | ✅                   |
| Entregas a cliente y demás      | ✅           | ✅                   |

## Instalación

1. Asegúrese de que el módulo esté en su `addons-path`.
2. Actualice la lista de aplicaciones en Odoo.
3. Busque `luis_botello_permisions` e instálelo (o actualícelo si ya está instalado):

   ```bash
   docker compose run --rm odoo bash -c \
     "odoo --stop-after-init --workers=0 -u luis_botello_permisions"
   ```

## Uso

1. Vaya a **Ajustes → Usuarios y compañías → Usuarios**.
2. Abra cada usuario que deba poder hacer traspasos.
3. En el privilegio **Permisos Especiales** (categoría *Luis Botello Permisos*),
   marque el grupo **Traspasos entre almacenes**.
4. Guarde.

Los usuarios sin ese grupo mantienen su acceso de inventario habitual pero no podrán
crear ni validar traspasos internos; sí podrán recepcionarlos.

Para una explicación orientada al usuario final, consulte
[docs/guia_cliente_traspasos.md](docs/guia_cliente_traspasos.md).

> Aviso: la restricción aplica a **todos** los usuarios de inventario. Cualquier
> persona que deba realizar traspasos —incluidos responsables— debe pertenecer al
> grupo.

## Tests

```bash
docker compose run --rm odoo bash -c \
  "odoo --test-enable --stop-after-init --workers=0 \
   -u luis_botello_permisions --test-tags /luis_botello_permisions"
```
