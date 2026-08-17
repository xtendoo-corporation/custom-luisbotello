# luis_botello_login

## Propósito y valor para el cliente

Muestra automáticamente un **wizard de entrada/salida de asistencia** justo
después de que un usuario inicia sesión en el backend de Odoo. El wizard crea o
cierra un registro `hr.attendance` para el empleado asociado al usuario, lo que
evita que los empleados olviden fichar al llegar o al salir. La presentación del
wizard puede desactivarse por usuario.

---

## Alcance y fuera de alcance

**En alcance:**
- Wizard modal `luis.attendance.wizard` que muestra empleado, fecha/hora y
  mensaje de confirmación.
- Creación de `hr.attendance` (entrada) si no hay asistencia abierta para el
  empleado.
- Cierre de `hr.attendance` (salida) si ya existe una asistencia abierta.
- Campo `require_attendance` en `res.users` para activar/desactivar el wizard
  por usuario.
- Controlador HTTP `/luis_botello_login/check_show_simple` que evalúa si el
  wizard debe mostrarse.
- Parche de `NavBar` (OWL) que consulta el endpoint al montar la barra de
  navegación y abre el wizard si corresponde.
- CSS para ocultar el botón de cierre del modal.
- Ocultación del botón de cierre del modal mediante `MutationObserver`.

**Fuera de alcance:**
- No gestiona múltiples empleados por usuario.
- No valida horarios ni turnos.
- No modifica la pantalla de login (`/web/login`): el controlador `Home.web_login`
  marca la sesión, pero la lógica principal pasa por `check_show_simple`.
- No incluye tests automatizados.

---

## Dependencias

Declaradas en `__manifest__.py`:

| Módulo | Origen |
|---|---|
| `web` | Odoo Community |
| `hr_attendance` | Odoo Community |

Sin dependencias externas.

---

## Instalación y activación

1. Copie el módulo en el `addons-path`.
2. Actualice la lista de aplicaciones.
3. Instale `luis_botello_login`.

```bash
odoo --stop-after-init -u luis_botello_login -d <nombre_bd>
```

Tras la instalación, el wizard se activa para todos los usuarios con
`require_attendance = True` (valor por defecto).

---

## Configuración

### Por usuario

1. Ir a **Ajustes → Usuarios y compañías → Usuarios**.
2. Abrir el usuario.
3. Pestaña **Preferencias** → grupo **Otras preferencias** → campo
   **«Requiere entrada de asistencia»**.
4. Desmarcar para desactivar el wizard para ese usuario.

### Vinculación empleado–usuario

El wizard busca el empleado del usuario con esta prioridad:
1. `user.employee_id` (si existe la relación directa).
2. `hr.employee.search([('user_id', '=', user.id)])`.

Si no se encuentra empleado, el wizard muestra una notificación de advertencia
sin registrar asistencia.

---

## Flujo funcional paso a paso

1. El usuario accede al backend de Odoo (POST a `/web/login`).
2. El parche de `NavBar` (`login_wizard.js`) llama a
   `/luis_botello_login/check_show_simple` al montar la barra de navegación.
3. El controlador evalúa:
   - Si `require_attendance = False` → `show: false`.
   - Si existe asistencia abierta (`check_out = False`) → `show: false` (ya fichó
     entrada).
   - En cualquier otro caso → `show: true` + acción del wizard.
4. Si `show: true`, el frontend ejecuta la acción mediante
   `env.services.action.doAction(action)` o, como fallback, redirige al hash del
   wizard.
5. El modal del wizard aparece. El botón de cierre queda oculto via CSS
   (`.o_modal_no_close`) para evitar que el usuario lo descarte sin confirmar.
6. El usuario pulsa **Confirmar** → `action_confirm`:
   - Si hay asistencia abierta: registra `check_out` + `out_mode = 'manual'`.
   - Si no hay asistencia abierta: crea nueva con `check_in` + `in_mode = 'manual'`.
   - Cierra el modal.

---

## Modelos, campos y métodos relevantes

### `res.users` — `models/res_users.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `require_attendance` | `Boolean` | Activa/desactiva el wizard post-login para este usuario (default `True`) |

### `luis.attendance.wizard` — `models/wizard.py`

| Campo | Tipo | Descripción |
|---|---|---|
| `message` | `Char` | Texto del wizard (default: `'Realiza la entrada de asistencia'`) |
| `employee_id` | `Many2one('hr.employee')` | Empleado asociado (readonly) |
| `ts` | `Datetime` | Fecha y hora de creación del wizard (readonly) |

| Método | Descripción |
|---|---|
| `_get_employee_for_user` | Busca el empleado vinculado al usuario |
| `action_confirm` | Crea o cierra asistencia para el empleado; con `sudo()` sobre `hr.attendance` |

### Controladores HTTP

| Ruta | Método | Descripción |
|---|---|---|
| `/luis_botello_login/check_show` | JSON-RPC POST | Devuelve `{'show': bool}` basado en estado de asistencia |
| `/luis_botello_login/check_show_simple` | HTTP GET | Devuelve JSON con `{'show': bool, 'action': ...}`; crea instancia del wizard |
| `/web/login` (override en `controllers/home.py`) | POST | Marca `luis_show_attendance = True` en sesión (no se usa en el flujo principal actual) |

---

## Vistas, menús y acciones

| Elemento | Descripción |
|---|---|
| `view_luis_attendance_wizard_form` (`views/wizard_view.xml`) | Formulario del wizard con empleado, hora y botón Confirmar |
| `view_users_form_inherit_require_attendance` (`views/res_users_views.xml`) | Añade `require_attendance` en la pestaña Preferencias del usuario |
| `action_attendance_wizard` (`data/actions.xml`) | Acción `ir.actions.act_window` para abrir el wizard en modal |

No se añaden elementos de menú propios.

---

## Permisos y seguridad

Fichero: `security/ir.model.access.csv`

| Acceso | Modelo | Grupo | Leer | Crear |
|---|---|---|---|---|
| `access_luis_attendance_wizard` | `luis.attendance.wizard` | (todos los usuarios) | ✓ | ✓ |

Las operaciones de escritura sobre `hr.attendance` se realizan con `sudo()` para
evitar problemas de permisos en usuarios sin acceso directo al modelo de
asistencia.

---

## Assets frontend

Registrados en `__manifest__.py` bajo `web.assets_backend`:

| Fichero | Descripción |
|---|---|
| `static/src/css/hide_modal_close.css` | Oculta el botón × del modal cuando tiene la clase `o_modal_no_close` |
| `static/src/js/login_wizard.js` | Parche de `NavBar` (OWL): consulta `check_show_simple` y abre el wizard |
| `static/src/js/wizard_modal_lock.js` | `MutationObserver` que añade `o_modal_no_close` al dialog del wizard |

---

## Datos y compatibilidad

- Versión declarada en manifest: **1.0** (sin prefijo de versión Odoo; recomendable
  normalizar a `19.0.1.0.0`).
- Licencia: no declarada en manifest.
- No incluye datos de demo.

---

## Pruebas existentes

**No hay tests implementados para este módulo.** No existe directorio `tests/`.

> ⚠️ **Riesgo documentado:** La ausencia de tests impide verificar el flujo de
> registro de asistencia de forma automatizada. Se recomienda cubrir al menos:
> - Usuario con empleado → wizard aparece → confirmar → `hr.attendance` creada.
> - Usuario sin empleado → notificación sin error.
> - `require_attendance = False` → wizard no aparece.
> - Asistencia abierta → wizard cierra asistencia.

---

## Operación y diagnóstico

- Si el wizard no aparece tras el login, verificar en el navegador que la petición
  `GET /luis_botello_login/check_show_simple` devuelve `{"show": true}`.
- Si `show: false` de forma inesperada, comprobar que el usuario tiene
  `require_attendance = True` y que no hay una asistencia abierta sin `check_out`.
- Si el wizard aparece pero no crea asistencia, revisar que el usuario tiene un
  empleado vinculado en el módulo `hr`.
- El método `action_confirm` usa `sudo()` internamente para crear/cerrar
  asistencias; los permisos de `hr.attendance` del usuario no son relevantes para
  la operación.

---

## Limitaciones y riesgos conocidos

| Limitación / Riesgo | Detalle |
|---|---|
| Sin tests | No hay cobertura automatizada |
| Botón × no eliminado, solo oculto | Un usuario con CSS desactivado puede cerrar el modal sin confirmar |
| Fallback JS con hash | Si `action.doAction` falla, redirige a hash de acción; puede no funcionar en todas las configuraciones |
| El controlador `home.py` marca sesión pero no se usa | `luis_show_attendance` se fija en sesión pero la lógica principal ya no depende de esa marca |
| Consulta en cada montaje de NavBar | `check_show_simple` se llama en cada carga del backend, no solo al login |
| Versión no normalizada en manifest | Campo `version = '1.0'` sin prefijo |

---

## Notas de mantenimiento

- Ficheros clave: `models/wizard.py`, `models/res_users.py`,
  `controllers/main.py`, `controllers/home.py`.
- JS: `static/src/js/login_wizard.js`, `static/src/js/wizard_modal_lock.js`.
- Si Odoo cambia la estructura de `NavBar` (OWL), el parche en `login_wizard.js`
  necesitará actualización.
- El `MutationObserver` en `wizard_modal_lock.js` usa el selector
  `.o_modal_no_close_marker` del DOM para identificar el wizard; asegurarse de que
  la vista XML mantiene ese marcador oculto.

---

> **Aviso:** Esta documentación se ha generado a partir del código real del módulo.
> No sustituye la validación en una base de datos de pruebas antes de desplegar en
> producción.
