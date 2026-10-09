# Informe QA independiente, ronda 2 - luis_botello_pos_redsys_tpvpc

Revisor: QA independiente (no participó en el desarrollo ni en las correcciones). Solo
se han añadido tests (`tests/test_redsys_qa2.py`, `tests_js/qa/qa2.test.js`) y este
informe; ningún fichero de producción modificado. Rama `feat/redsys-tpvpc` (HEAD
`a55c97d`). Referencias: `docs/qa_report.md`, `DECISIONS.md`, plan §4.5, §7, Fase 3,
§11. Las correcciones se han verificado leyendo el código y el código del core 19 con el
que interactúan, no el informe.

## 1. Veredicto

**NO APTO para pasar a pruebas con hardware.**

Motivo: las correcciones de la ronda 1 cierran los escenarios que describían (ver §3),
pero al revisar su interacción con el flujo real del POS aparecen **dos caminos nuevos
de cobro sin registro** que el core 19 deja abiertos y que el módulo no cubre. Son
BLOQUEANTES porque se alcanzan con acciones normales de cajero (un clic) y pierden un
cargo en tarjeta:

- **QA2-01**: "Cancelar pedido" / ticket screen / "Cancel Orders" del cierre de sesión
  borran el pedido entero, con sus líneas Redsys `authorized`/`unknown`, sin pasar por
  `deletePaymentLine` (QA-23 solo protege la línea).
- **QA2-02**: `validateOrder` del core elimina toda línea no `done` antes de
  sincronizar; una línea Redsys `unknown` (`force_done`) no cuenta como pagada, así que
  pagar el resto en efectivo la **borra** al validar.

Ambas se arreglan con parches pequeños en cliente (ver arreglos). Con ellas cerradas, el
resto de hallazgos nuevos son ALTO/MEDIO/BAJO y no impedirían una sesión de pruebas
supervisada con un solo puesto; los ALTOS (QA2-03, QA2-04, QA2-10) hay que cerrarlos
antes de uso en producción.

| Severidad  | Hallazgos nuevos                       |
| ---------- | -------------------------------------- |
| BLOQUEANTE | QA2-01, QA2-02                         |
| ALTO       | QA2-03, QA2-04, QA2-10                 |
| MEDIO      | QA2-05, QA2-06, QA2-09, QA2-11, QA2-12 |
| BAJO       | QA2-13, QA2-14, QA2-15, QA2-16, QA2-17 |

Dónde está cada test: `JS` = `tests_js/qa/qa2.test.js` (los abiertos llevan `{ todo }`,
describen lo DESEADO, hoy fallan sin romper la suite; al corregir, quitar `todo`). `PY`
= `tests/test_redsys_qa2.py` (`test_qa2_known_issue_*` afirman el comportamiento ACTUAL
y fallarán a propósito al corregirlo).

## 2. Ejecución (resultado exacto, sin filtrar)

| Suite  | Comando                                                                                                                                                                                         | Resultado                                                                                                                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS     | `docker run --rm -v "$PWD":/m -w /m --entrypoint sh odoo_19-odoo:latest -c 'node --test tests_js/'`                                                                                             | **227 tests, 211 pass, 0 fail, 0 cancelled, 0 skipped, 16 todo.** Antes de esta ronda: 211 tests, 203 pass, 8 todo. Los 16 todo = 8 BAJOS de la ronda 1 (QA-03/05/06/07/08/09/12 y su duplicado de QA-05) + 8 nuevos de esta ronda. |
| Python | `docker compose run --rm -e PGDATABASE=qa2_final_tmp odoo odoo -d qa2_final_tmp -i luis_botello_pos_redsys_tpvpc --test-tags /luis_botello_pos_redsys_tpvpc --stop-after-init --log-level=test` | **48 tests, 0 failed, 0 error(s)** (`odoo.tests.result: 0 failed, 0 error(s) of 48 tests`). Antes: 37. Nuevos: 11. BD temporal borrada (`DROP DATABASE` de `qa2_base_tmp` y `qa2_final_tmp`; sin BD `qa%` residual).                |

Notas: durante la instalación Odoo escribe avisos docutils
(`<string>:177: (ERROR/3) Unexpected indentation`, etc.) justo tras "Loading module
luis_botello_pos_redsys_tpvpc"; no se ha podido atribuir a un fichero concreto del
módulo (no hay README.rst en la raíz). Cosmético, no afecta a los tests.

## 3. Verificación de cada corrección (leyendo el código)

| ID          | Veredicto                                         | Evidencia y esfuerzo por romperla                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-01       | **Cierra el escenario**                           | `interpretQuery` (`redsys_pos_logic.js:133-217`) exige gracia de 2 min desde el INICIO del cobro y `checkStatus==0`; `recoverLine` (`redsys_tpvpc_service.js:186-241`) nunca pasa a `retry` por una consulta vacía, solo por denegación registrada; el resto queda `unknown`/`force_done` hasta `releaseLine` (confirmación del cajero). Test nuevo con temporizador real (QA-01 ciclo completo): reconsulta automática, sigue bloqueada, solo `releaseLine` libera. Marcas de inicio corruptas/futuras/storage que lanza nunca acortan la gracia (salvo `""`/`"0"`, QA2-16, BAJO). Límite: la gracia depende de que la DLL termine en <2 min (S8c, sin verificar). |
| QA-02       | **Cierra el escenario en una pestaña**            | `-98` => `_recover(strict)` => nunca `NOT_CHARGED` (`redsys_service.js:591,660`); `isBusy()` incluye `_orphan` (5 min). Se rompe entre pestañas: el cerrojo se libera en el `finally` de `pay()` mientras `_orphan` solo vive en la instancia que expiró (QA2-12).                                                                                                                                                                                                                                                                                                                                                                                                  |
| QA-04       | **Cierra**                                        | `_recover` coteja importe (`AMOUNT_MISMATCH`) y `interpretPayResult` lo trata como `unknown`. Sigue abierta la variante QA-05 (importe con coma / ausente), BAJO ya conocido.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| QA-10       | **Cierra la parte servidor/XML; la UI no**        | Firma `MOCK...` en el XML simulado y rechazo servidor si `redsys_simulation` falso (test `test_qa_10_server_*`). Sigue sin insignia fija en el POS (declarado). La marca no impide el forjado deliberado de un XML (ver §5).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| QA-11       | **Cierra**                                        | `_run` (`payment_redsys_tpvpc.js:115-131`) rechaza `unknown` y trata `authorized/refund` como hechas. Intento de rotura nuevo: línea `unknown` con estado `retry` (botón "Force cancel" del core) => no llega al datáfono y vuelve a `force_done` (test verde).                                                                                                                                                                                                                                                                                                                                                                                                     |
| QA-13       | **Cierra**                                        | Mapa `uuid -> Promise` (`payment_redsys_tpvpc.js:75-92`). Test nuevo: 5 `pay()` simultáneos tras una denegación => 1 cobro adicional, estado final `done` coherente en las 5 llamadas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| QA-14       | **Cierra el caso descrito, deja otro**            | Contador de bloqueos correcto, pero `blockSaved` se captura al empezar: si el core pone `paymentTerminalInProgress=false` durante la recuperación, se restaura `true` (QA2-14, BAJO).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| QA-15       | **Cierra**                                        | `recoverLine` salta `activeLines` y métodos ocupados (`redsys_tpvpc_service.js:195-202`). Pero un `BUSY` por cerrojo de OTRA pestaña no se trata como "saltar" (QA2-13, BAJO).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| QA-16       | **Cierra**                                        | `groups='point_of_sale.group_pos_manager'` (`pos_payment_method.py:22-29`); RPC con sudo. Un cajero que no sea el responsable de la sesión no obtiene la clave (test nuevo con otro usuario).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| QA-17       | **Cierra**                                        | `redsys_get_signature_key` (`pos_payment_method.py:63-92`): sesión abierta y responsable = usuario (o manager). Limitación declarada (sesión compartida) se mantiene.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| QA-19       | **Cierra con el flujo real**                      | Test nuevo con `pos.order.sync_from_ui` real (el `[0,0,vals]` con uuid existente se convierte en update): el reenvío de la misma línea y la resolución `unknown -> authorized` con el XML de la consulta (J11) sincronizan; un XML con otro importe se rechaza y deja la línea `unknown`. Los comandos `(5,)` y `(6,0,[])` del pedido pasan por `unlink` y siguen bloqueados. Quedan dos interacciones malas (QA2-04, QA2-09).                                                                                                                                                                                                                                      |
| QA-20 / J11 | **Cierra parcialmente (declarado)**               | Validación XML/importe/pedido/RTS/comercio/terminal/unicidad correcta y verificada con sync real. Huecos nuevos: unicidad omitida en cualquier `refund` con `redsys_original_pedido` (QA2-06); el XML lo aporta el cliente y no se verifica la firma, por lo que un cajero deshonesto forja un cobro (test de caracterización `test_qa2_server_cannot_tell_a_forged_xml_from_a_real_one`; límite ya admitido).                                                                                                                                                                                                                                                      |
| QA-21       | **Parcial (declarado)**                           | Menú, filtros y wizard existen y funcionan. Falta el aviso al cerrar sesión: confirmado que la sesión cierra sin aviso con una línea `unknown` (QA2-03). Efectos laterales nuevos: QA2-05, QA2-09.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| QA-22       | **Cierra solo pay/refund/query**                  | `init()` y `checkStatus()` no toman el cerrojo (QA2-11); el cerrojo no cubre el `orphan` (QA2-12). Los cerrojos se liberan siempre (excepción, `-1`, timeout local) y nunca quedan eternos: test nuevo.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| QA-23       | **Cierra la línea, NO el pedido**                 | `deletePaymentLine` bloquea el borrado de línea (`payment_screen.js:35-48` + `canDeleteRedsysLine`), pero el pedido entero se borra y la validación elimina líneas pendientes (QA2-01, QA2-02).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| QA-24       | **Cierra**                                        | `refundInfoFor` resuelve por `redsys_original_pedido` y rechaza si es ambiguo (`payment_redsys_tpvpc.js:45-63`). En el servidor el vínculo no se valida (QA2-06).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| QA-18       | **Decisión aceptable, con un efecto no previsto** | `unknown -> False` es la liberación del cajero. Si la línea ya estaba en servidor, el borrado posterior (`[2,id]`) es rechazado y el pedido no cierra (QA2-04).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| J11         | **Cierra**                                        | `parseQueryXml().rawXml` se persiste en `redsys_xml` y el servidor lo valida (sync real verificado).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 4. Hallazgos nuevos

### BLOQUEANTES

**QA2-01 - Borrar el pedido (o "Cancel Orders" al cerrar sesión) destruye líneas Redsys
`authorized`/`unknown`.** Código del core:
`point_of_sale/static/src/app/services/pos_store.js:601-683` (`onDeleteOrder` ->
`deleteOrders` -> `removeOrder` -> `localDeleteCascade`), `ticket_screen.js:405`,
`control_buttons.js:152`, `closing_popup.js:316`. El módulo no sobrescribe
`_onBeforeDeleteOrder` ni `beforeDeleteOrder` (`static/src/app/overrides/` solo parchea
`PaymentScreen` y `PosPayment`). Escenario: el cobro queda `unknown` (o `authorized` y
el cliente cambia de idea) en un pedido NO sincronizado (venta minorista: solo se
sincroniza al validar o "guardar"); el cajero pulsa "Cancelar pedido" (o el cierre de
sesión se queja de pedidos abiertos y pulsa "Cancel Orders"); el pedido y su línea
desaparecen del navegador sin dejar rastro en servidor: **cargo en tarjeta sin
registro**. Si el pedido ya estaba en servidor, `action_pos_order_cancel` lo deja en
`cancel` con la línea intacta (sin devolución) y nadie se entera. Test: `qa2.test.js`
"QA2-01" (todo). Arreglo:
`patch(PosStore.prototype, { async _onBeforeDeleteOrder(order) { ... } })` que devuelva
`false` (con diálogo) si el pedido tiene líneas Redsys con `redsys_state` en
authorized/unknown/refund o en curso, y ofrezca "Guardar el pedido para conciliación"
(sincronizarlo en borrador). Hay que contemplar que `closing_popup.js:316` ignora el
retorno de `deleteOrders` y llama a `closeSession()`: el servidor lo rechazará mientras
existan pedidos en borrador, lo cual es lo deseado.

**QA2-02 - `validateOrder` borra la línea Redsys pendiente cuando el resto se paga con
otro método.** Core:
`point_of_sale/static/src/app/utils/order_payment_validation.js:118-129`
(`if (!line.isDone() || ...) removePaymentline`) y
`models/accounting/pos_order_accounting.js:186-196` (`amountPaid` solo suma líneas
`done`). Módulo: `overrides/payment_screen.js:49-58` (`addNewPaymentLine` solo bloquea
OTRAS líneas Redsys) y `redsys_pos_logic.js:422-431` (`unresolvedLines` no se consulta
al validar). Escenario: cobro de 10 EUR queda `unknown`/ `force_done` (posible cargo);
el cliente dice "te pago en efectivo"; el cajero añade efectivo 10 EUR (permitido); el
pedido pasa `isPaid()`; al validar el core elimina la línea Redsys por no estar `done` y
sincroniza solo el efectivo. Resultado: el cliente pagó dos veces y la operación Redsys
no queda registrada en ningún sitio (tampoco aparece en conciliación). Lo mismo con una
devolución `unknown` pagada luego en efectivo (doble devolución). Test: `qa2.test.js`
"QA2-02" (todo). Arreglo:
`patch(OrderPaymentValidation.prototype, { async isOrderValid(...) })` (o
`PaymentScreen.validateOrder`) que devuelva `false` con aviso si
`unresolvedLines(order.payment_ids)` no está vacío o hay operación en curso, salvo
líneas ya resueltas a mano (`done`).

### ALTOS

**QA2-03 - La sesión se cierra con líneas `unknown` sin aviso ni bloqueo** (pendiente
declarado de QA-21). `models/` no extiende `pos.session`; `pos_session.py:597`
(`close_session_from_ui`) no sabe de Redsys. Test PY
`test_qa2_known_issue_session_closes_silently_with_unknown_payments`: pedido pagado con
una línea `unknown` (la que fuerza el cajero con "Está autorizada"), sesión cerrada con
éxito y el cobro sigue `unknown`; el apunte contable ya se generó como cobro con
tarjeta. Arreglo: sobrescribir `pos.session._cannot_close_session` (o
`close_session_from_ui`) para devolver `{successful: False, message, redirect: False}`
si hay `pos.payment` `redsys_state='unknown'` en la sesión, con enlace a la acción de
conciliación.

**QA2-04 - Una línea `unknown` ya sincronizada no se puede borrar aunque el cajero la
libere: el pedido no cierra.** `models/pos_payment.py:211-222` (`unlink`) +
`_process_order` del core (`pos_order.py:108-125`). Escenario: pedido guardado en
borrador con la línea `unknown` en servidor; el cajero comprueba en el portal que no
hubo cargo, usa "No se cobró: permitir reintentar" (`releaseLine`, cambio solo local),
borra la línea y valida con otro método; el POS envía `[2, id]` y el servidor lanza
`UserError` (D10). El pedido queda sin cerrar y el cajero no tiene salida desde el POS.
Test PY `test_qa2_known_issue_synced_unknown_line_cannot_be_removed_by_the_pos`.
Arreglo: permitir `unlink` de una línea `unknown` sin XML/RTS cuando la petición
proviene del sync del POS y el pedido pasa a `paid` con otras líneas que cubren el total
y se registra la liberación (nota/usuario) - o, mejor, que `releaseLine` fuerce una
sincronización de `redsys_state=False` antes de permitir el borrado y que el servidor lo
trate como `not_charged` auditado.

**QA2-10 - Un cajero puede borrar un pedido borrador con cobros `authorized`/`unknown`
por RPC (`pos.order.unlink`).** `security` del core da `unlink` a `group_pos_user` sobre
`pos.order`; `pos.payment.pos_order_id` es `ondelete='cascade'`
(`point_of_sale/models/pos_payment.py:21`) y el cascade en BD no pasa por el `unlink`
del ORM (límite ya anotado en D10, pero alcanzable por un cajero normal). Test PY
`test_qa2_known_issue_cashier_can_unlink_draft_order_with_authorized_payment`. Arreglo:
`@api.ondelete(at_uninstall=False)` en una herencia de `pos.order` que impida el borrado
si alguna línea tiene `redsys_state` protegido (el bypass `redsys_force_unlink` con
`env.su` se conserva).

### MEDIOS

**QA2-05 - Una línea `not_charged` queda atrapada en el pedido.**
`pos_payment.py:7,211-222`. Tras la conciliación el pedido sigue contando ese importe en
`amount_paid` y no hay forma de borrarla ni siquiera por un manager (venta sin cobro y
contabilidad con un cobro con tarjeta inexistente). Test PY
`test_qa2_known_issue_not_charged_line_is_stuck_in_the_order`. Arreglo: definir el
tratamiento (excluir `not_charged` de la contabilización, o un asistente de manager que
anule la línea con traza y ajuste el pedido), o al menos avisar en el wizard de
conciliación de que el pedido queda contabilizado como cobrado.

**QA2-06 - Una `refund` con `redsys_original_pedido` salta unicidad, signo y vínculo.**
`pos_payment.py:157-158` (`continue`). Test PY
`test_qa2_known_issue_forged_refund_skips_uniqueness_and_link_checks`: (a) la MISMA
devolución (mismo pedido/RTS) se registra en dos pedidos; (b) una "devolución" con
importe positivo y un `redsys_original_pedido` inventado se acepta usando el XML de un
cobro. Arreglo: para `refund` exigir `amount < 0`, un original `authorized` del mismo
método con ese `transaction_id`, saldo suficiente (suma de devoluciones previas + esta
<= original) y unicidad por (método, pedido, RTS) entre devoluciones; permitir solo
compartir identificadores con el cobro original, no entre devoluciones.

**QA2-09 - Conciliación del manager frente a la copia obsoleta del POS bloquea la
sincronización.** `pos_payment.py:249-255`. Test PY
`test_qa2_known_issue_manager_reconcile_vs_stale_pos_copy_blocks_sync`: tras
`redsys_reconcile`, el reenvío de la línea con `redsys_state=unknown` desde un POS que
no se ha refrescado lanza `UserError`; el pedido no sincroniza hasta recargar. Arreglo:
tratar como no-op el reenvío de `unknown` sobre una línea ya resuelta (y devolver el
estado del servidor al POS).

**QA2-11 - `init()` y `checkStatus()` no toman el Web Lock.** `redsys_service.js:330` y
`:397` (frente a `pay` `:431`, `refund` `:482`, `query`). Una segunda pestaña/recarga
que arranca (`boot()` -> `ensureReady` -> `init`) o el polling de 45 s llegan a la DLL
mientras otra pestaña cobra; reinicializar la DLL en mitad de una operación puede
abortarla o dar `-99` (comportamiento sin verificar, S4). Test JS "QA2-11" (todo): la
pestaña B llama a `initFnDll` y `fnDllCheckStatus` durante el cobro de A. Arreglo:
`init()` y `checkStatus()` toman el cerrojo con `ifAvailable` y, si está ocupado,
devuelven BUSY / el último estado sin tocar el transporte.

**QA2-12 - El cerrojo se libera tras un timeout local aunque la DLL siga viva.**
`redsys_service.js:284` (`_orphan` solo en la instancia) y `:468-471` (`release()` en el
`finally`). Test JS "QA2-12" (todo): tras el `-98` de la pestaña A (estado `unknown`),
la pestaña B envía un segundo `fnDllOperPinPad`. Arreglo: retener el cerrojo hasta que
acabe el `orphan` (o hasta el retorno tardío), o publicarlo en un cerrojo/registro
compartido.

### BAJOS

- **QA2-13** `recoverLine` en otra pestaña con el cerrojo ocupado marca
  `unknown`/`force_done` la línea viva (`redsys_tpvpc_service.js:205-238`,
  `redsys_service.js:688-712` devuelve BUSY y `interpretQuery` lo toma como fallo). Es
  el sentido seguro (no hay doble cobro) pero deja copias divergentes en IndexedDB. Test
  JS "QA2-13" (todo). Arreglo: BUSY por cerrojo => `skipped`.
- **QA2-14** `recoverOrder` restaura `paymentTerminalInProgress=true` si el core lo
  apagó durante la recuperación (`redsys_tpvpc_service.js:318,329`). Test JS "QA2-14"
  (todo). Arreglo: guardar el valor solo si ningún cobro propio está en curso o no
  restaurar un `true` heredado.
- **QA2-15** Las marcas `redsys_start:*` no se purgan nunca (se borran solo por
  referencia al resolver; la confirmación manual "Está autorizada" y los pedidos
  descartados las dejan). No secretas. Test JS "QA2-15" (todo). Arreglo: barrido por
  antigüedad (p. ej. > 7 días) al arrancar.
- **QA2-16** Una marca `""` (o `"0"`) en `localStorage` da la gracia por vencida
  (`redsys_pos_logic.js:252`, `Number("")===0`). Solo por corrupción/manipulación, y aun
  así el paso a `retry` exige confirmación del cajero. Test JS "QA2-16" (todo). Arreglo:
  validar `/^\d{13}$/`.
- **QA2-17** Sin restricción única en BD para (`método`, `transaction_id`)/RTS: la
  unicidad es una búsqueda Python y dos sincronizaciones concurrentes podrían registrar
  el mismo pedido Redsys. No se ha probado concurrencia. Arreglo: índice único parcial
  en `_auto_init`.

## 4.bis Estado tras las correcciones (ronda 3)

Ver DECISIONS.md, sección "Correcciones QA ronda 3". Los hallazgos de arriba se
conservan tal como se redactaron.

| ID     | Estado                                                                                      |
| ------ | ------------------------------------------------------------------------------------------- |
| QA2-01 | CORREGIDO (cliente y servidor; sin tour en navegador)                                       |
| QA2-02 | CORREGIDO (cliente; sin tour en navegador)                                                  |
| QA2-03 | CORREGIDO (se bloquea el cierre)                                                            |
| QA2-04 | CORREGIDO (RPC redsys_release_unknown, probado con sync_from_ui real)                       |
| QA2-10 | CORREGIDO (ORM; la cascada SQL queda como límite documentado)                               |
| QA2-05 | PARCIAL (borrable en borrador; en pedido pagado solo aviso en el wizard)                    |
| QA2-06 | CORREGIDO                                                                                   |
| QA2-09 | CORREGIDO                                                                                   |
| QA2-11 | CORREGIDO (comportamiento real de la DLL sin verificar)                                     |
| QA2-12 | CORREGIDO en la misma pestaña/instancia (cerrar la pestaña libera el cerrojo; sin DLL real) |
| QA2-13 | CORREGIDO                                                                                   |
| QA2-14 | CORREGIDO                                                                                   |
| QA2-15 | CORREGIDO                                                                                   |
| QA2-16 | CORREGIDO                                                                                   |
| QA2-17 | CORREGIDO (índices únicos parciales; concurrencia real sin probar)                          |

Pendiente en todos los casos: un tour en navegador y las comprobaciones con hardware de
§7.

## 5. Secretos, PAN, localStorage, Web Locks y BroadcastChannel (punto 3 del encargo)

- **localStorage**: único uso en `redsys_tpvpc_service.js:64` (inyectado a
  `makeStartMarks`, `redsys_pos_logic.js:227-269`). Claves `redsys_start:ODOO-<8 hex>`
  con un entero de 13 dígitos; derivadas del uuid de la línea (no secretas, no PAN, no
  clave de firma). Test nuevo con un `localStorage` espía: durante un cobro autorizado y
  uno `unknown` solo se escribe esa forma y se borra al resolver (el `unknown` conserva
  la marca por diseño). Riesgo residual: manipulación (acorta la gracia, QA2-16) y fuga
  lenta (QA2-15). Un storage que lanza no rompe nada (cae a memoria; la gracia empieza
  entonces en la primera recuperación, nunca antes).
- **Clave de firma**: sigue sin aparecer en `localStorage`, `console.*`, diálogos,
  avisos, `state` reactivo, ticket, `redsys_xml` (test nuevo). La clave es legible por
  `group_pos_manager` en BD y viaja en el RPC al navegador (D4, aceptado). Persiste
  QA-12 (`inspect` del servicio).
- **Web Locks**: nunca quedan retenidos tras excepción, `-1` o timeout local (test nuevo
  con 3 modos). El cerrojo se acota por `callTimeoutMs` (180 s por llamada; una
  operación con recuperación puede sumar varias llamadas); un cierre/caída de pestaña lo
  libera el navegador. Sin `navigator.locks` (contexto no seguro, HTTP en LAN) se
  degrada al guardián del datáfono sin avisar al cajero: conviene verificar que el POS
  se sirve por HTTPS. Huecos: QA2-11, QA2-12, QA2-13.
- **BroadcastChannel**: no se usa (decisión QA-22); test estático nuevo: ni
  `BroadcastChannel`, `sessionStorage`, `indexedDB`, `document.cookie` ni `postMessage`
  en `static/src` (salvo el simulador). No hay fuga ni bloqueo por ahí. La única
  comunicación entre pestañas es el cerrojo (sin datos) y el `localStorage` (marcas).
- **Mock**: la doble puerta sigue siendo de cliente (QA-10); ahora el servidor rechaza
  líneas con `<firma>MOCK` si el método no está en simulación. Un XML forjado a mano sin
  esa marca sigue siendo indistinguible de uno real (límite declarado, no se verifica la
  firma).

## 6. Interacciones revisadas (punto 2 del encargo)

| Interacción                                              | Resultado                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bloqueo de líneas en backend (D10) vs sincronización     | OK con el flujo real salvo QA2-04 (borrado tras liberar), QA2-09 (copia obsoleta tras conciliar)                                                                                                                         |
| QA-19/D10 con `sync_from_ui` real                        | OK: reenvío idempotente; `unknown -> authorized` con XML de consulta; XML incoherente rechazado                                                                                                                          |
| Líneas `unknown` que nunca se resuelven                  | El POS las bloquea bien (unresolvedLines, QA-11/13/23), pero la salida del cajero indeciso es "cancelar el pedido" (QA2-01) o pagar en efectivo (QA2-02): ambas pierden el rastro                                        |
| Pedidos que no se pueden cerrar/borrar por la protección | QA2-04 (cerrar), QA2-05 (not_charged inamovible), borrado de pedido por RPC sí posible (QA2-10)                                                                                                                          |
| Cierre de sesión con `unknown`                           | Cierra sin aviso (QA2-03)                                                                                                                                                                                                |
| Devoluciones con `redsys_original_pedido`                | Cliente correcto (QA-24: elige la tarjeta original, rechaza ambiguo); servidor no valida el vínculo (QA2-06). `previousRefunds` solo ve pedidos cargados en el POS: TPV-PC0100 sigue siendo la garantía final            |
| Doble cobro por reutilización de referencia              | La referencia es estable por línea (`ODOO-<uuid8>`): un reintento tras `releaseLine` reenvía la MISMA factura. Si Redsys rechaza facturas repetidas (TPV-PC0117/0118) `_recover` encuentra la operación original; ver §7 |

## 7. Lo que NO se pudo verificar (sin navegador ni hardware)

1. **`PaymentScreen` real, `PosStore` real y OWL**: QA2-01/QA2-02 se han demostrado
   leyendo el código del core 19 y con tests estáticos (no existe ningún override), no
   con un tour. Falta un tour con recarga y con "Cancelar pedido"/validar con efectivo.
2. **Persistencia en IndexedDB** de `redsys_reference`/`payment_status`/`redsys_state`
   antes de una recarga a mitad de cobro (supuesto de QA-01; ya anotado en la ronda 1).
3. **Reutilización de la `factura` por Redsys**: (a) tras un cobro autorizado, ¿el
   segundo envío con la misma factura da TPV-PC0117/0118? (de ello depende que
   `releaseLine`+reintento no duplique el cargo); (b) tras una DENEGACIÓN, ¿se rechaza
   la misma factura? Si sí, el botón "Reintentar" sobre la misma línea quedaría
   inservible y habría que usar otra línea.
4. **Retraso de indexación de la consulta** tras un `-2`: `_recover` consulta justo
   después; si la operación tarda en aparecer en `fnDllOperConsulta`, un cobro real se
   declararía `NOT_CHARGED` (el `-2` de la DLL no tiene gracia, solo el `-98`/recarga).
5. Comportamiento real de `init`/`checkStatus` de una segunda pestaña durante un cobro
   (QA2-11), timeout real de la DLL (~40 s, S8c), rechazo de operaciones simultáneas
   (S8f) y eventos 1/4.
6. Web Locks reales (los tests usan una réplica) y su ausencia en contextos no seguros.
7. Compatibilidad con `pos_conventional_*`/`luis_botello_extend_pos_conventional` (el
   wizard que borra `payment_ids`) y `pre-commit`.
8. Concurrencia real de sincronizaciones sobre la unicidad pedido/RTS (QA2-17).

## 8. Orden de corrección recomendado

1. QA2-01 y QA2-02 (dos parches de cliente: `PosStore._onBeforeDeleteOrder` y
   `isOrderValid`); añadir un tour con el mock que haga exactamente esos dos recorridos.
2. QA2-03, QA2-04, QA2-10 (backend/POS): aviso de cierre, salida controlada de la línea
   liberada, `ondelete` de pedido.
3. QA2-06, QA2-09, QA2-05 (validación de devoluciones, idempotencia del reenvío tras
   conciliar, tratamiento contable de `not_charged`).
4. QA2-11/12/13 (cerrojos), después BAJOS.
5. Antes de la sesión con hardware: poder responder a los puntos 3 y 4 de §7 con el
   datáfono (sesión supervisada, un solo puesto).

Tras corregir cada punto: quitar `{ todo }` del test JS o invertir la aserción del
`test_qa2_known_issue_*` Python.
