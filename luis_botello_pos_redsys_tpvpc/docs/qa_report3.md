# Informe QA independiente, ronda 3 - luis_botello_pos_redsys_tpvpc

Revisor: QA independiente (no participó en el desarrollo ni en las rondas previas). Rama `feat/redsys-tpvpc`, HEAD `09ad89e`.
Solo se han añadido tests (`tests/test_redsys_qa3.py`, `tests_js/qa/qa3.test.js`, línea en `tests/__init__.py`) y este
informe; ningún fichero de producción modificado. Las correcciones se han verificado leyendo el código del módulo y el del core 19
(`point_of_sale`, `pos_restaurant`, `pos_self_order`) y de la suite `xtendoo-pos-conventional`, no los informes.

## 1. Veredicto

* **Pruebas con hardware (datáfono real, sesión supervisada, un solo puesto, POS estándar): APTO**, con las condiciones de §1.1.
  Los dos BLOQUEANTES de la ronda 2 (QA2-01, QA2-02) y los ALTOS (QA2-03, QA2-04, QA2-10) están cerrados en las rutas del
  POS estándar: no he encontrado ningún clic de cajero en el POS que borre una línea o un pedido Redsys `authorized`/`unknown`.
* **Producción: NO APTO** hasta cerrar R3-01, R3-02, R3-04, R3-06 y el pre-commit obligatorio (R3-08).

### 1.1 Condiciones para la sesión con hardware
1. Usar el POS estándar (no el flujo backend de `pos_conventional_payment_wizard`) y no añadir el método Redsys desde wizards backend (R3-01).
2. Ver qué cajas del cliente son `pos_non_touch` (R3-09): en esas el datáfono no se invoca desde la UI backend.
3. No recargar el navegador justo después de usar "No se cobró: permitir reintentar" sobre una línea ya sincronizada (R3-06).
4. Tener un usuario manager a mano (liberar líneas con rastro de Redsys y conciliar es solo suyo) y comprobar los puntos de §6.

| Severidad | Hallazgos nuevos |
|---|---|
| ALTO | R3-01, R3-02 |
| MEDIO | R3-04, R3-06, R3-08, R3-11 |
| BAJO | R3-03, R3-05, R3-07, R3-10 |
| INFO | R3-09 |

## 2. Ejecución (resultado exacto)

| Suite | Comando | Resultado |
|---|---|---|
| JS | `docker run --rm -v "$PWD":/m -w /m --entrypoint sh odoo_19-odoo:latest -c 'node --test tests_js/'` | **235 tests, 225 pass, 0 fail, 0 cancelled, 0 skipped, 10 todo.** Antes de esta ronda: 231 / 223 pass / 8 todo. Nuevos: 4 (2 `todo` = R3-06 y R3-07). Los 8 todo anteriores son los BAJOS de la ronda 1. |
| Python | `docker compose run --rm -e PGDATABASE=qa3_full_tmp odoo odoo -d qa3_full_tmp -i luis_botello_pos_redsys_tpvpc --test-tags /luis_botello_pos_redsys_tpvpc --stop-after-init --log-level=test` | **59 tests, 0 failed, 0 error(s)** (`odoo.tests.result: 0 failed, 0 error(s) of 59 tests`; la línea `tests.stats` dice "67 tests" porque cuenta también tests de módulos dependientes/post). Antes: 50. Nuevos: 9. BD temporal eliminada (también la de la actualización `-u`). |
| Actualización | misma imagen, `-u luis_botello_pos_redsys_tpvpc` sobre BD ya instalada | OK. Con duplicados previos (simulados por SQL en `test_qa3_03`) `init()` no falla ni aborta la transacción, no crea el índice y lo crea cuando se corrigen los datos. Efecto lateral: Odoo escribe dos líneas `ERROR odoo.sql_db: bad query ... could not create unique index` en el log (R3-10). |

Linters (todos disponibles vía `pre-commit`; ejecutados sobre una COPIA, porque `ruff --fix`/`ruff-format` de la config modifican ficheros):

* `oca-checks-odoo-module`: pasa. `pylint_odoo` opcional: **falla** con W8110 (`init`, `_onchange_use_payment_terminal`), W8113, C8113, C8101 (autor).
  `pylint_odoo` **obligatorio (`.pylintrc-mandatory`): falla (exit 22)** por `E8103 sql-injection` (`models/pos_payment.py:91`, el `f"CREATE UNIQUE INDEX ..."` de `init`) y `E8140 no-raise-unlink` (`pos_payment.py:312`, `unlink` lanza `UserError`; es decisión de diseño D6/D10, hay que documentarla con `# pylint: disable=no-raise-unlink`) -> R3-08.
* `ruff`: 213 × E501 (línea > 88; el módulo escribe líneas de ~100), C901 (`_redsys_validate_authorization`, 19 > 16), I001/F401/B017/B018 en tests; `ruff-format` reformaría 8 ficheros; `refurb` 9 avisos FURB173/184 en tests.
* `eslint`/`prettier`: sin ficheros que comprobar con el hook (no hay binario `eslint` ejecutable fuera del hook; no verificado).

## 3. Verificación de QA2-01 .. QA2-17 (intentando romperlas)

| ID | Veredicto | Evidencia y rutas probadas |
|---|---|---|
| QA2-01 | **Cierra en el POS estándar; quedan rutas servidor/otros módulos** | Rutas del core que eliminan pedidos (leídas): `onDeleteOrder` -> `beforeDeleteOrder` -> `deleteOrders` -> `_onBeforeDeleteOrder` (botón "Cancelar pedido" `control_buttons.js:152`, ticket screen `ticket_screen.js:405`, "Cancel Orders" `closing_popup.js:316`): los dos ganchos están parcheados (`overrides/pos_store.js`). Servidor: `action_pos_order_cancel` guardado (`models/pos_order.py:18`), `unlink` por ondelete guardado (`:42`), `remove_from_ui` (core, usado por pos_self_order) revienta en `payment_ids.sudo().unlink()` y se revierte todo (`test_qa3_01`), `sudo()` solo no activa el bypass (`test_qa3_02`). Rutas NO cubiertas: `pos.order.write({'state':'cancel'})` (R3-02), `PosStore.removeOrder`/`localDeleteCascade` directos (restaurante, debug) y `syncAllOrders` con borrados pendientes (R3-11). |
| QA2-02 | **Cierra** | `isOrderValid` se ejecuta antes del `removePaymentline` de `validateOrder` (`order_payment_validation.js:118-128`), y también lo usa el pago rápido (`pos_store.js:3170` -> `validation.validateOrder`). `finalizeValidation` solo borra si `!line.amount === 0` (siempre falso). Una refund sin enviar al datáfono no valida por `isRefundInProcess()` del core (`pos_order.js:580`; la línea de refund nace sin `payment_status`, ver `pos_order.js:503`). Probado con réplica del core; sin tour. |
| QA2-03 | **Cierra las vías de UI** | `_cannot_close_session` (cierre POS y `post_closing_cash_details`) y `action_pos_session_closing_control` (botón backend `pos_session_view.xml:11`, wizard `pos_close_session_wizard.py:18`, pos_self_order). Pero `action_pos_session_validate`/`action_pos_session_close` son públicos y van directo a `_validate_session`: R3-03. Salida del manager: conciliar (menú). El popup del cierre convencional (`pos_conventional_session_management/closing_popup.js:209-226`) ignora el resultado de `post_closing_cash_details`, deja la sesión en `closing_control` y muestra el aviso como toast: recuperable (el manager concilia y se cierra de nuevo; `closing_control` sigue siendo reanudable, `pos_config.py:442`). |
| QA2-04 | **Cierra el flujo; deja R3-06** | `redsys_release_unknown` (`pos_payment.py:410`): comprobado que no sirve para `authorized`, `unknown` con XML/RTS/pedido ni para pedidos pagados (tests existentes) y que tras liberar el sync `[2,id]` + efectivo cierra. Intento de romperlo: tras liberar y recargar sin sincronizar, la línea vuelve del servidor como `not_charged` con `payment_status` que el POS trata como pendiente (R3-06). Cualquier `group_pos_user` puede liberar una línea de cualquier cajero/sesión (no se comprueba pertenencia): BAJO, aceptable con un único puesto. |
| QA2-05 | PARCIAL (declarado) | Borrable en borrador; en pedido pagado se queda y el wizard avisa (`pos_payment_reconcile.py:33`). Sin cambios. |
| QA2-06 | **Cierra** | `_redsys_validate_authorization` + `_redsys_refund_errors` (`pos_payment.py:176-190, 231-277`): signo, original `authorized` del mismo método, unicidad, suma <= original. Intentos de rotura: devolución sin `redsys_original_pedido` cae en la búsqueda de duplicados (no hay `continue`); dos devoluciones parciales legítimas pasan. Hueco menor: `redsys_reconcile` (manager) convierte una `unknown` negativa en `refund` sin pasar por estas validaciones (confianza en el manager, aceptado). |
| QA2-09 | **Cierra** | `write` (`:372-384`): `unknown` sobre una línea ya `authorized/refund/not_charged` es no-op de campos Redsys. |
| QA2-10 | **Cierra por ORM** | `@api.ondelete(at_uninstall=False)` impide el borrado y se ejecuta antes de la cascada; límite SQL documentado. `pos_conventional_core` (`models/pos_order.py:125`, `unlink` con `sudo()`; `action_delete_cancelled_order`) pasa por el mismo ondelete: bloqueado. |
| QA2-11 / QA2-12 | **Cierra (según lo declarado)** | `init`/`checkStatus` bajo el cerrojo; el huérfano retiene el cerrojo hasta el retorno tardío u `orphanMs`. Revisado el código del cerrojo (`redsys_service.js:105-330`); el comportamiento real de la DLL es inverificable (S4/S8). |
| QA2-13 / QA2-14 | **Cierra** | `recoverLine` devuelve `skipped` con BUSY (`redsys_tpvpc_service.js:204-231`); `recoverOrder` solo restaura `true` si sigue `true` (`:365`). |
| QA2-15 / QA2-16 | **Cierra** | `makeStartMarks`: validación `isValidMark` (13 dígitos) y `purge` por edad; una marca vencida de una línea aún sin resolver da gracia nueva (sentido conservador). |
| QA2-17 | **Cierra** | Índices parciales (`authorized`, valor no vacío, por método) creados en `init()`; no rompen instalación ni actualización con datos duplicados (`test_qa3_03`); refunds fuera del índice. Ver R3-05 y R3-10. |

## 4. Hallazgos nuevos

### ALTOS

**R3-01 - Un pago de un método Redsys sin pasar por el datáfono se acepta en servidor ("tarjeta registrada sin cobro").**
Rutas: `pos_conventional_payment_wizard/models/pos_order.py:280-330` (`get_payment_popup_data` lista TODOS los
métodos de la caja, `add_payment_from_ui`, `action_register_payments_and_validate`) y `wizard/pos_make_payment_wizard.py:184-191`
(`available_payment_method_ids = config.payment_method_ids`; `_add_payment`). El pago rápido sí excluye los métodos con terminal
(`pos_order.py:242`, `:31`), pero el popup/wizard de pago no. El módulo no exige estado Redsys a un `pos.payment` de un método
`redsys_tpvpc`. Escenario: en un pedido borrador del flujo convencional el cajero elige "Redsys" en el popup de pago: se crea un
`pos.payment` de 10 EUR sin `redsys_state`, el pedido pasa a pagado y contabiliza una cobro con tarjeta que nunca existió.
Test: `test_qa3_known_issue_06`. Arreglo: restricción en `pos.payment.create/write` (no `su`): si el método es `redsys_tpvpc`,
`redsys_state` vacío y `payment_status` en (`False`, `done`) -> `UserError` (las líneas en curso del POS llevan `pending/waiting*`
y se siguen pudiendo sincronizar como borrador). Complemento fuera de este repo: excluir métodos con terminal del popup/wizard convencional.

**R3-02 - `pos.order.write({'state': 'cancel'})` salta la guarda de `action_pos_order_cancel`.**
`models/pos_order.py:18` protege solo `action_pos_order_cancel`. Cualquier cajero (ACL write de `pos.order`) y el propio código de
`pos_conventional_session_management` (`models/pos_session.py:41` `_cancel_empty_draft_orders`, `wizard/pos_session_closing_wizard.py:147`,
sobre pedidos borrador "sin líneas") cancelan por `write`. Un pedido sin líneas de producto pero con un cobro `authorized` (se
borraron las líneas tras cobrar) queda `cancel` con el cobro dentro, fuera de la contabilidad de la sesión, y la sesión cierra.
Test: `test_qa3_known_issue_05`. Arreglo: mover la guarda a `pos.order.write` (si `vals.get('state') == 'cancel'` y hay cobros en
`REDSYS_CHARGE_STATES` y no es bypass) y dejar que `action_pos_order_cancel` (que escribe `cancel`) la herede.

### MEDIOS

**R3-04 - No hay salida de manager para un borrador abandonado con línea `authorized`.**
`pos_payment.py:312-333`, `pos_order.py:18-42`. El bypass `redsys_force_unlink` no lo usa ninguna vista ni botón. Escenario: cobro parcial
con tarjeta (p. ej. 10 de 25 EUR) y el cliente se va: ni el cajero ni el manager pueden cancelar, borrar el pedido o la línea; la sesión no cierra
mientras exista el borrador (`_cannot_close_session` del core) y "Cancel Orders" lo rechaza. La única salida es completar el pedido en el POS
(cambiar las líneas o pagar el resto). Test: `test_qa3_known_issue_08`. Arreglo: acción de manager "Cancelar con devolución registrada"
(wizard con nota obligatoria y referencia de la devolución hecha en el portal/datáfono, que registre una línea `refund` o deje trazada
la cancelación con `redsys_force_unlink`).

**R3-06 - Línea liberada (`not_charged`) que reaparece tras una recarga queda inamovible.**
`redsys_tpvpc_service.js:317-345` (`releaseLine` borra la línea solo en local; el `[2,id]` no se envía hasta la siguiente sincronización) y
`redsys_pos_logic.js:317-345, 446-458` (`canDeleteRedsysLine`, `pendingRedsysLines`, `orderDeletionBlockers`, `unresolvedLines` priorizan
`payment_status === 'force_done'` sobre `redsys_state === 'not_charged'`). Escenario: el cajero libera en servidor la línea `unknown` (queda `not_charged`), se
recarga el navegador antes de validar; el servidor devuelve la línea `not_charged` con el `payment_status` que se sincronizó (`force_done`, supuesto
no verificado sin navegador); el POS no la deja borrar ni validar ni cancelar el pedido, y "Forzar" -> "Está autorizada" crearía un `unknown` local que el
servidor ignora (QA2-09) con una línea `not_charged` contando como pagada. Test JS: `qa3.test.js` (caracterización + `todo` con lo deseado).
Arreglo: tratar `not_charged` como resuelta antes de mirar `payment_status` en las 4 funciones, y forzar `addPendingOrder` + sincronización inmediata del pedido
tras `redsys_release_unknown` para que el borrado llegue al servidor.

**R3-08 - El pre-commit obligatorio falla** (ver §2): `pos_payment.py:91` E8103 (usar `odoo.tools.SQL` / identificadores constantes),
`:312` E8140 (justificar con `# pylint: disable=no-raise-unlink`), W8110 en `init` y `_onchange_use_payment_terminal`, formato y E501 (213), C901.
Hay que pasar `ruff format`/`ruff --fix` antes de integrar.

**R3-11 - Rutas del core que borran pedidos sin pasar por `_onBeforeDeleteOrder` (condicional a módulos no instalados en retail).**
`PosStore.removeOrder` y `localDeleteCascade` se llaman directos desde `pos_restaurant` (`unsetTable`, edición de plano, `floor_screen.js:961,999`) y el
widget debug "Delete Orders" (`debug_widget.js:103-118`, solo con `?debug`). Y `removeOrder(order, true)` (configuración compartible) deja un borrado pendiente:
`syncAllOrders` hace `await this.deleteOrders([], orderIdsToDelete)` ANTES de sincronizar (`pos_store.js:1594-1597`) y sin `try`; si el servidor lo rechaza
(UserError de nuestra guarda) cada sincronización lanza y **ninguna venta se puede validar** hasta limpiar IndexedDB. Con la config actual
(`isShareable` falso, sin pos_restaurant) no se alcanza. Arreglo: parchear también `removeOrder` para pedidos `!finalized` con bloqueadores, y no registrar
borrados pendientes de pedidos con cobros Redsys.

### BAJOS / INFO

* **R3-03** `action_pos_session_validate`/`action_pos_session_close` (RPC públicos) cierran con líneas `unknown`; sin botón de UI. Test `test_qa3_known_issue_07`. Arreglo: guardar `_validate_session`.
* **R3-05** `redsys_reconcile` escribe con `super(PosPayment, pay).write` y no traduce el `IntegrityError` de los índices únicos: dos `unknown` con el mismo pedido conciliadas como `charged` dan un error crudo. Test `test_qa3_known_issue_09`. Arreglo: envolver con savepoint + `_redsys_integrity_error`.
* **R3-07** "Guardar el pedido para conciliación" (`overrides/pos_store.js:37-40`) llama a `syncAllOrders({orders, force:true})` sin `throw:true`; el core traga el error y el `catch` con el aviso "NO lo borre" nunca se ejecuta (sin conexión devuelve un `ConnectionLostError` sin lanzar). El cajero cree haber guardado. Test JS `todo`. Arreglo: `throw: true`.
* **R3-10** En una actualización con datos duplicados Odoo escribe dos líneas `ERROR odoo.sql_db: bad query` (el índice no se crea, se omite en silencio); conviene un `_logger.warning` explícito (la política "sin logging" del módulo impide verlo).
* **R3-09 (INFO)** En cajas `pos_non_touch` (flujo backend de `pos_conventional_*`) el datáfono no se invoca: el pago rápido con método con terminal devuelve `False` sin hacer nada y el JS del terminal vive solo en `point_of_sale._assets_pos`. Confirmar con el cliente desde qué UI cobra cada caja. `luis_botello_extend_pos_conventional` no toca pagos ni cierres (solo `_search` de `pos.payment` por cookie, recibo, botón devolver, calculadora): sin riesgo para las guardas.

## 5. Compatibilidad estática con `pos_conventional_*` y `luis_botello_extend_pos_conventional`

| Flujo | Resultado |
|---|---|
| `payment_ids.unlink()` (`pos_make_payment_wizard.py:125,325,395`, `pos_order.py:330,335`) | Pasa por `pos.payment.unlink` guardado (el `sudo()` no activa el bypass): lanza `UserError` en lugar de perder el cobro. El wizard "limpiar pagos"/"pago efectivo rápido" fallará con mensaje en un pedido con Redsys; esperado. |
| `unlink` / `action_cancel_and_delete_order` / `action_delete_cancelled_order` (`pos_conventional_core/models/pos_order.py:125-209`) | `action_pos_order_cancel` y ondelete guardados: bloqueados para authorized/unknown/refund. |
| Cancelar pedidos vacíos al cerrar (`write state=cancel`) | **Salta la guarda** -> R3-02. |
| Cierre: popup OWL conventional y wizard backend | Pasan por `close_session_from_ui`/`_cannot_close_session`: bloqueado con `unknown`. El popup deja la sesión en `closing_control` (comportamiento ya existente con borradores). |
| Popup/wizard de pago con método Redsys | **Registra pago sin cobro** -> R3-01. |
| `luis_botello_extend_pos_conventional` | Sin interacción con las guardas. Tour y botón "Devolver" siguen sin probarse en navegador. |

## 6. Lo que NO es verificable sin navegador/hardware

1. Todo el POS real/OWL: `PosStore`, `OrderPaymentValidation` y `PaymentScreen` parcheados se probaron con réplicas (`harness/stubs.mjs`) y leyendo el core; falta un tour (cancelar pedido, validar con efectivo y línea dudosa, cierre con "Cancel Orders", liberar+recargar).
2. Persistencia real en IndexedDB de `redsys_state`/`payment_status`/borrados pendientes antes de una recarga (de ello depende R3-06).
3. Con el datáfono: reutilización de `factura` tras autorización/denegación, retraso de indexación de la consulta tras `-2`, timeout real de la DLL, rechazo de operaciones simultáneas, eventos 1/4, `init`/`checkStatus` desde 2ª pestaña (QA2-11) y cerrojo con DLL viva (QA2-12).
4. Web Locks reales y HTTPS (sin contexto seguro se degrada al guardián).
5. Concurrencia real de dos sincronizaciones sobre el índice único (solo hay prueba de la ruta de error).
6. `eslint`/`prettier` del módulo (hooks sin ficheros; sin binario local).
7. Tour con la suite `pos_conventional_*` instalada y con `luis_botello_extend_pos_conventional` (botón "Devolver").
8. Comportamiento de `payment_status` del servidor en una línea liberada tras recarga (hipótesis de R3-06).

## 7. Orden de corrección recomendado
1. R3-01 y R3-02 (restricción en `pos.payment` y guarda en `pos.order.write`); quitar la inversión de las aserciones `known_issue_05/06`.
2. R3-06 y R3-04 (flujo de la línea liberada y salida de manager), R3-11.
3. R3-08 (pre-commit) antes de integrar; luego BAJOS (R3-03, 05, 07, 10).
4. Antes de producción: tour en navegador con los recorridos de §6.1 y la sesión supervisada con datáfono.

Al corregir: invertir la aserción de cada `test_qa3_known_issue_*` (renombrar a `test_qa3_NN_*`) y quitar `{ todo }` de los JS.
