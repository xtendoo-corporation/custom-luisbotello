# Informe QA independiente - luis_botello_pos_redsys_tpvpc

Revisor: QA independiente (no ha escrito ni modificado código de producción; solo `tests/test_redsys_qa.py`,
`tests_js/qa/**` y este informe). Rama `feat/redsys-tpvpc`, commit base `730245f`. Plan de referencia: §4.5, §7, Fase 3, Fase 6, §11.

## 1. Veredicto

**No apto para entrega: 4 hallazgos BLOQUEANTES (doble cobro o cobro sin registro).** No se ha encontrado fuga de la
clave de firma ni de PAN en logs, `localStorage`, red, XML guardado, `redsys_xml` ni DECISIONS (ver §5), pero la clave es
más accesible de lo que el diseño declara (QA-16/QA-17, ALTO). La matriz Fase 3 y Fase 4 pasa entera contra el simulador;
los fallos están en los caminos que el simulador/servicio no cubren: recarga con el cobro aún en curso, timeout local,
y la UI del POS (borrar líneas dudosas, doble clic).

| Severidad | Hallazgos |
|---|---|
| BLOQUEANTE | QA-01, QA-02, QA-13, QA-23 |
| ALTO | QA-04, QA-11, QA-16, QA-19, QA-20, QA-22 |
| MEDIO | QA-10, QA-14, QA-15, QA-17, QA-21, QA-24 |
| BAJO | QA-03, QA-05, QA-06, QA-07, QA-08, QA-09, QA-12, QA-18, QA-25 |

Cada hallazgo con test automático lleva su ID en el nombre del test. Los de JS son tests `todo` (describen el
comportamiento DESEADO, hoy fallan y no rompen la suite: al corregir el código pasan solos y hay que quitar la marca
`todo`). Los de Python (`test_qa_known_issue_*`) afirman el comportamiento ACTUAL y fallarán a propósito al corregirlo.

## 2. Ejecución

| Suite | Comando | Resultado |
|---|---|---|
| JS (todo el módulo) | `docker run --rm -v "$PWD":/m -w /m --entrypoint sh odoo_19-odoo:latest -c 'node --test tests_js/'` | 193 tests: 175 pass, 0 fail, 18 todo (hallazgos abiertos). Antes de QA: 116 pass. |
| JS solo QA | `node --test tests_js/qa/` | matrix 23/23, adversarial y pos_flow con todos los `todo` esperados |
| Python | `docker compose run --rm -e PGDATABASE=qa_redsys_tmp odoo odoo -d qa_redsys_tmp -i luis_botello_pos_redsys_tpvpc --test-tags /luis_botello_pos_redsys_tpvpc --stop-after-init` | 26 tests (14 previos + 12 QA), 0 failed, 0 errors. BD temporal eliminada. |
| Instalar/desinstalar | `-i` y luego `button_immediate_uninstall` por `odoo shell` en la BD temporal | Instala limpio, desinstala limpio (0 campos `redsys_*` residuales) |
| Logs del servidor | `--log-level=test`, grep de la clave (`QA-SECRET-KEY`, `SECRET-KEY`, `OTHER-CASH`) | 0 apariciones |

**No ejecutado (sin navegador/hardware en el entorno):** tour del POS, compatibilidad con la suite `pos_conventional_*` y con
`luis_botello_extend_pos_conventional` (Fase 6.2), `pre-commit`/linters, `overrides/payment_screen.js` en navegador,
persistencia real de `redsys_reference` en IndexedDB antes de una recarga (ver §6). `PaymentRedsysTpvpc`, el servicio OWL
`redsys_tpvpc` y el parche de `PosPayment` sí se ejercitan con la implementación real sobre stubs de Odoo
(`tests_js/qa/harness/`, réplica del core 19); `PaymentScreen` no.

## 3. Matriz de escenarios (contra el simulador, servicio y mock reales)

Invariante comprobada en cada caso: lo que declara el servicio coincide con el dinero movido en el almacén del simulador y
`fnDllOperPinPad` se llama el nº de veces esperado. Fichero: `tests_js/qa/matrix.test.js` y `pos_flow.test.js`.

| Escenario | Resultado | Evidencia |
|---|---|---|
| Autorizado | OK: 1 cargo, pedido/RTS coherentes, eventos 1,4,3 | matrix |
| Denegado (F/Denegada y estado G) | OK: 0 cargos, reintento cobra 1 vez | matrix, pos_flow |
| -2 + cobrado | OK: recupera por consulta, 1 llamada de cobro, 1 cargo | matrix |
| -2 + no cobrado | OK: NOT_CHARGED reintentable, 0 cargos | matrix |
| -2 + consulta falla | OK: `unknown`, 1 cobro, nunca reintento; la línea queda `force_done`, bloquea otro cobro del pedido | matrix, pos_flow |
| XML malformado/cortado tras cobrar | OK: consulta y recupera (no se toma como fallo) | matrix |
| Recarga a mitad, operación ya terminada | OK: servicio nuevo la encuentra por referencia | matrix, pos_flow |
| **Recarga a mitad, operación AÚN en curso** | **FALLA: se declara "no cobrado" (QA-01)** | adversarial |
| -1 con recuperación / -1 persistente / -99 | OK: 1 reintento, init acotado, sin reintento ciego en -99 | matrix |
| -40 (init y en cobro) | OK: LIB_EXPIRED, sin bucle | matrix |
| Bucle de init (50 cobros con init roto) | OK: <= 2 llamadas a init (enfriamiento) | matrix |
| Doble clic (20 llamadas) / referencias distintas | OK en servicio (1 cargo); **FALLA en UI (QA-13, QA-23)** | matrix, pos_flow |
| Operaciones concurrentes durante cobro | OK: BUSY sin tocar el transporte | matrix |
| Devolución total / parcial acumulada / excesiva | OK: límites en cliente y en simulador (TPV-PC0100) | matrix, pos_flow |
| Devolución sin RTS / RTS erróneo / pedido inexistente / de cobro denegado / de devolución | OK: sin RTS el simulador acepta solo con pedido (la UI lo bloquea); el resto rechazado | matrix, pos_flow |
| Devolución -2 (cobrada / no cobrada / consulta falla) | OK | matrix, pos_flow |
| Dos pestañas contra el mismo servicio | Solo frena el guardián del datáfono (-3); sin exclusión propia (QA-22) | adversarial |

## 4. Hallazgos

### BLOQUEANTES

**QA-01 - Recarga mientras el cobro sigue en el datáfono se interpreta como "no cobrado" (cobro duplicado/huérfano).**
`static/src/app/services/redsys_tpvpc_service.js:167-197` (`recoverLine`) y `static/src/app/utils/redsys_pos_logic.js:174-177`
(`interpretQuery` devuelve `not_charged` ante una consulta vacía). Escenario: el cliente está pasando la tarjeta, el cajero pulsa
F5; el POS restaura la línea (`waitingCard`), consulta por referencia, aún no existe la operación, `retry`; el cajero cobra
otra vez y a los segundos el primer cobro se autoriza. Resultado: cargo sin línea POS o dos cargos. Test: `adversarial.test.js`
"QA-01" (el cobro original termina autorizado tras `not_charged`). Arreglo: no concluir `not_charged` hasta pasada una ventana
de gracia desde `payment_date` (>= timeout de la DLL, S8c 40 s, mejor 2 min) y con `checkStatus == 0`; mientras tanto
`unknown` con mensaje "espere"; reconsultar periódicamente; exigir confirmación explícita al cajero para pasar a `retry`.

**QA-02 - Timeout local de 180 s (`callTimeoutMs`) trata -98 como -2 verificado y declara NOT_CHARGED.**
`static/src/app/redsys/redsys_service.js:222-227` (temporizador), `:506-508` (-98 => `_recover`), `:573-576` (NOT_CHARGED
reintentable). Si la DLL sigue esperando la tarjeta/PIN más de 180 s (o el servicio local es lento), `_exec` resuelve solo y
la consulta vacía da "no cobrado, puede reintentarla"; el cobro original se autoriza después. Test: "QA-02" (cobro
autorizado después de NOT_CHARGED). Con el timeout de la DLL (-2 a los ~40 s, S8c) el caso real es menos probable, pero el
código no lo garantiza. Arreglo: un fallo/timeout de transporte sin respuesta de la DLL no es evidencia de "no cobrado":
devolver `unknown` (nunca NOT_CHARGED) salvo `checkStatus` OK y ventana de gracia; o no usar timeout local mientras la DLL
no haya contestado.

**QA-13 - Doble clic en "Reintentar": el 2º `sendPaymentRequest` deja la línea en `retry` mientras el 1º sigue en curso.**
`static/src/app/payment/payment_redsys_tpvpc.js:68-87,154-168` + `overrides/pos_payment.js:25-35`. El 2º cobro recibe BUSY,
`interpretPayResult` => `retry`, el core hace `handlePaymentResponse(false)` => `retry` sobre una línea con cobro en curso.
En `retry` el POS permite borrar la línea (ver QA-23) y reintentar; si se borra, el cobro del 1º se autoriza sobre una línea
inexistente. El datáfono recibe un solo cobro (test "doble clic... UN solo cobro" en verde), pero el estado queda
inconsistente. Test: "QA-13". Arreglo: un mapa `uuid -> Promise` en `PaymentRedsysTpvpc`; si ya hay una operación en curso
para esa línea, devolver la misma promesa (idempotente) sin tocar el estado; BUSY de OTRA línea sí es `retry`.

**QA-23 - Una línea Redsys `unknown` (`force_done`) se puede borrar desde la UI y el cobro dudoso desaparece.**
`overrides/payment_screen.js` no sobrescribe `deletePaymentLine`. `payment_lines.xml:16-19` muestra el botón borrar salvo
en done/reversed/waitingCard/waitingCapture; `payment_screen.js:268-293` (core) hace `removePaymentline` directo cuando el
estado es `force_done` o `retry` (solo llama a `sendPaymentCancel` en waiting/waitingCard/timeout, donde sí está el guardián).
Al borrarla desaparece también el bloqueo `unresolvedLines` y el cajero cobra de nuevo: doble cobro. D10 protege solo líneas
ya sincronizadas con el servidor. Test: "QA-23" (no existe el override). Arreglo: parchear `deletePaymentLine` para líneas
Redsys: rechazar con explicación si `redsys_state` es unknown/authorized/refund o hay operación en curso; en `retry` sin
`redsys_state` y servicio libre, permitir.

### ALTOS

**QA-04 - La recuperación de un -2 no coteja el importe.** `redsys_service.js:541-562`: acepta como `authorized` cualquier
operación F/Autorizada con la misma referencia aunque su importe sea otro (p. ej. reintento tras editar el importe de la línea:
referencia estable por uuid). La recarga sí lo cotejaría (`redsys_pos_logic.js:153`). Test "QA-04". Arreglo: `AMOUNT_MISMATCH` en `_recover`
(misma lógica que `interpretQuery`).

**QA-11 - Una línea `unknown`/`authorized` puede volver a cobrarse invocando de nuevo su propia `pay()`.**
`payment_redsys_tpvpc.js:89-99`: `unresolvedLines(order.payment_ids, line.uuid)` excluye la propia línea y `_run` no mira su
`redsys_state`. Misma referencia en el reintento (no hay referencia nueva), así que solo Redsys (TPV-PC0118/0117) lo frenaría;
el simulador no. Test: "QA-11". Arreglo: al inicio de `_run`, rechazar si `line.redsys_state` en {unknown, authorized, refund} o `payment_status == 'done'`.

**QA-16 - La clave de firma es legible por cualquier cajero con un `read`/`search_read` normal.**
`models/pos_payment_method.py:25` (`groups="point_of_sale.group_pos_user"`). D7 dice que solo el RPC la entrega, pero el
campo es legible por todo `group_pos_user` para TODOS los métodos Redsys de la compañía. Como el RPC usa `sudo()`, el campo
puede ser `group_pos_manager` (como pedía el plan §5.3). Test: `test_qa_known_issue_key_readable_by_any_pos_user`.
Valoración: D4 acepta que el cajero de esa caja reciba la clave en el navegador; no acepta que lea las de otras cajas/comercios
(QA-17). En un despliegue de un único comercio el impacto adicional es bajo; con varios comercios es una fuga. Se clasifica ALTO
(no BLOQUEANTE) por esa razón; si el cliente tiene más de un comercio/terminal, tratarlo como BLOQUEANTE.

**QA-19 - D10 bloquea el reenvío de una línea Redsys con los MISMOS valores (pedidos que no sincronizan).**
`models/pos_payment.py:56` (`forbidden = REDSYS_LOCKED_FIELDS & vals.keys()`). El POS serializa una línea ya sincronizada
y modificada como `[1, id, <todos los campos>]` (`serialization.js`, `toUpdate`) y `_process_order` hace
`pos_order.write({'payment_ids': ...})`. Con el pedido ya guardado en servidor (pedido guardado, `unknown` resuelto tras recarga,
cualquier cambio posterior de la línea) la sincronización lanza `UserError` y el pedido no se puede cerrar. Test:
`test_qa_known_issue_resync_with_same_values_is_blocked`. Arreglo: comparar valores (permitir si cada clave bloqueada es igual al
valor actual) y mantener la protección solo para cambios reales.

**QA-20 - El servidor no valida la autorización contra la línea (plan §7.5 "cuando sea posible": sí lo es).**
`models/pos_payment.py` (sin `create`/constraint). Un cajero (o devtools, o el mock - QA-10) puede registrar un "cobro con
tarjeta" de 500 EUR con `redsys_xml` vacío, de 0,01 EUR o `estado T/Denegada`, y duplicar el mismo `transaction_id`/RTS en dos
pedidos. Test: `test_qa_known_issue_server_does_not_validate_authorization_against_line`. Arreglo: al crear/escribir con
`redsys_state in (authorized, refund)`: parsear el XML y exigir `estado F`, `resultado Autorizada`, importe == `abs(amount)`,
`factura == redsys_reference`, `pedido == transaction_id`, RTS == `redsys_rts`, comercio/terminal del método, y unicidad de
`(método, transaction_id)`; verificar la `firma` de la respuesta con la clave (el servidor la tiene) si el manual la documenta.

**QA-22 - Sin exclusión entre pestañas.** `RedsysService.isBusy()` es por instancia (`redsys_service.js:192`). Dos pestañas del
POS en el mismo PC cobrando el mismo pedido con líneas distintas dependen solo de que el servicio local rechace la 2ª operación
(S8f, no verificado: el manual dice que no está pensado para operaciones simultáneas). Test "QA-22" (todo) y
`dos pestañas ... guardián (-3)` (verde con el simulador). Arreglo: `navigator.locks.request('redsys-<comercio>-<terminal>')` durante
toda operación (y durante la recuperación) o `BroadcastChannel` con un registro de operación en curso (sin secretos).

### MEDIOS

- **QA-10 - El mock activo no deja marca en lo persistido.** La "doble puerta" (`redsys_simulation` + `?redsys_sim=1`,
  `redsys_factory.js:29-50`, `redsys_pos_logic.js:319`) es toda de cliente (el campo viaja en los datos del POS y la URL la pone
  quien quiera): no es una frontera de seguridad. Un admin que deje el flag en un método de producción y cualquier cajero con la URL
  generan "cobros" con `redsys_state=authorized` indistinguibles de reales. Test "QA-10". Arreglo: marca inequívoca en el XML
  simulado (p. ej. `<firma>MOCK</firma>`), y el servidor rechaza líneas con esa marca si `method.redsys_simulation` es falso en BD
  (se ata a QA-20); mostrar la insignia "SIMULACIÓN" fija en el POS; deshabilitar el flag fuera de `debug`.
- **QA-14 - Dos `recoverOrder` solapadas dejan `pos.paymentTerminalInProgress = true` para siempre.**
  `redsys_tpvpc_service.js:227-236` (`hadBlock` por llamada; arranque + `PaymentScreen.onMounted`). Bloquea cualquier cobro con
  terminal y el polling de `checkStatus` hasta recargar. Test "QA-14". Arreglo: contador de bloqueos o `try/finally` con un único dueño.
- **QA-15 - `recoverOrder` sobre una línea con cobro EN CURSO en la misma pestaña la marca `unknown`.** `recoverLine` llama a
  `ensureReady` => BUSY => `unknown` (`redsys_tpvpc_service.js:178-181,199-216`); si el cobro termina denegado, la línea no vuelve
  a `retry` sino a `force_done`. Test "QA-15". Arreglo: saltar líneas cuyo `service.isOperationActive(method)` (operación propia).
- **QA-17 - El RPC de la clave acepta cualquier `config_id` legible.** `models/pos_payment_method.py:63-75`. Un cajero de la caja A
  obtiene la clave de la caja B. Test `test_qa_known_issue_key_rpc_ignores_which_config_is_open`. Arreglo: exigir sesión abierta del
  usuario en esa config (`config.current_session_id.user_id`/`session_ids`) o `config` en `user_id.pos_config_ids`.
- **QA-21 - Las líneas `unknown` no tienen vista de conciliación.** DECISIONS I4 las da por "marcadas para conciliación", pero no
  hay filtro/menú/informe. Test `test_qa_known_issue_no_view_to_reconcile_unknown_payments`. Arreglo: acción + filtro de `pos.payment`
  (`redsys_state = 'unknown'`) y aviso al cerrar sesión con líneas `unknown`.
- **QA-24 - Devolución con varias tarjetas Redsys en el pedido original.** `payment_redsys_tpvpc.js:54` (`find` toma la primera línea
  Redsys válida) y límite `info.amount` = importe de esa línea. Tras recarga la devolución puede ir a otra tarjeta distinta de la
  elegida. Sin test (requiere `PaymentScreen`). Arreglo: persistir el `redsys_original_pedido` desde la selección y resolver por él.

### BAJOS

- **QA-03** `_initCall` sin timeout (`redsys_service.js:236-251`): si `initFnDll` nunca llama al callback, el servicio queda `INITIALIZING`
  (BUSY) hasta recargar. No es doble cobro. Test "QA-03".
- **QA-05** `Number(parsed.importe)` (`redsys_service.js:720`): importe con coma (`"99,00"`) da NaN y no avisa; un `<importe>` ausente
  se acepta limpio. Tests "QA-05" (2).
- **QA-06** `_authorized` no coteja `factura`/`comercio`/`terminal`/`moneda` de la respuesta con la petición. Test "QA-06".
- **QA-07** Errores de negocio con retorno -3 + `<Error>` pierden el texto del Anexo VI (`redsys_service.js:474,516`); el simulador lo
  hace así (S8b). Test "QA-07".
- **QA-08** Sin allow-list/longitud para campos de Redsys que van al ticket y a BD (`redsys_pos_logic.js:23-68`): un `\n` en
  `fechaOperacion` forjaría líneas del ticket (`<pre t-esc>` escapa HTML, no saltos de línea). Redsys es fuente de confianza. Test "QA-08".
- **QA-09** El parser por regex no ignora comentarios XML (`xml_parser.js:28-45`). Teórico. Test "QA-09".
- **QA-12** `util.inspect`/`console.log(servicio)` muestran `config.signKey` (`redsys_service.js:135`; `toJSON` solo cubre
  `JSON.stringify`). El comentario de `toJSON` promete lo contrario. Test "QA-12". Arreglo: guardar la clave en un campo privado `#` o `WeakMap`.
- **QA-18** D10 permite `unknown -> False` y luego `unlink` (`pos_payment.py:56-70`). Test `test_qa_known_issue_unknown_can_be_cleared_and_deleted`.
- **QA-25** `sendPaymentRequest` marca `unknown` ante CUALQUIER excepción, incluso previa al cobro (`payment_redsys_tpvpc.js:76-86`):
  seguro, pero deja la caja bloqueada hasta confirmación manual. Sin test.

## 5. Secretos, PAN, XSS, mock (revisión adversaria: resultado)

| Vector | Resultado | Evidencia |
|---|---|---|
| Clave en logs (servicio, mock con `EnableLog`, `console.*`), resultados, `callLog`, `eventLog`, almacén, `JSON.stringify(servicio)` | No aparece | adversarial "la clave no aparece..." |
| Clave en red | Solo en el RPC `redsys_get_signature_key` (servidor -> navegador) y en el cuerpo del `init` hacia `localhost:10305` (D4); las operaciones posteriores no la reenvían | adversarial "RealHttpTransport..." |
| Clave en `localStorage`/`sessionStorage`/IndexedDB/DOM, `console.log/warn/error` | Ninguno en `static/src` (test estático) | adversarial "higiene estática" |
| Clave solo en 4 ficheros esperados (+ mock sin secreto) | Cumple | adversarial "solo se menciona..." |
| Clave en la carga completa del POS (`load_data`) y en logs de Odoo a nivel `test` | No aparece | `test_qa_key_absent_from_full_pos_payload`, grep del log |
| Clave en BD | Texto plano (vista `password="True"` solo oculta en UI); legible por cajeros (QA-16) | `test_qa_key_not_in_view...` |
| PAN | Solo `************NNNN` en todos los escenarios y consultas; sin secuencias Luhn de 13-19 dígitos | adversarial "nunca hay PAN completo" |
| XML guardado (`redsys_xml`) | XML crudo completo (PAN enmascarado, `firma`, literales). Sin PAN; recomendable guardar solo etiquetas en lista blanca | revisión |
| XSS | Ticket `<pre t-esc>`, diálogos `t-out` de string (escapa), indicador en atributos; sin `innerHTML`/`t-raw`/`eval`/`markup` | adversarial "XSS", lint estático |
| Mock en producción | Estricto (===true, `redsys_sim=1` exacto, sin `flagCheck` no hay mock, `new MockTransport` solo en la fábrica); pero ambas puertas son de cliente (QA-10) | adversarial "El mock..." |
| `unknown` tratado como éxito/fallo | No en el servicio ni en `interpretPayResult`; sí hay vías de salida que lo pierden (QA-01/02/23) | adversarial "'unknown'..." |
| Importe vs línea | Advertencia `AMOUNT_MISMATCH` en pago directo y en recarga; no en recuperación de -2 (QA-04), ni validación servidor (QA-20) | adversarial "Coherencia..." |

## 6. No verificado (requiere navegador o hardware)

1. Persistencia efectiva de `redsys_reference`/`payment_ref_no`/`payment_status` en IndexedDB antes de una recarga (se asignan a la
   línea justo antes de `redsys.pay`, `payment_redsys_tpvpc.js:131-132`). Si no se persisten a tiempo, el escenario "recarga a mitad"
   no encuentra la línea a recuperar. Necesita un tour con recarga.
2. Comportamiento de `fnDllIniTpvpcLatente` (init en el arranque tras recarga) con una operación aún en curso en el servicio local
   (puede abortarla o fallar): condiciona QA-01. [SUPUESTO-HW].
3. S8c/S8f: timeout real de la DLL (-2 a ~40 s) y rechazo de operaciones simultáneas por el servicio real: condicionan QA-02/QA-22.
4. Compatibilidad con `pos_conventional_*` y `luis_botello_extend_pos_conventional` (botón "Devolver", recibo, wizard backend que hace
   `payment_ids.unlink()`; D10 lo protege).
5. `pre-commit`/linters del repo.

## 7. Orden de corrección recomendado

1. QA-23 + QA-13 + QA-11 (UI/PaymentInterface: guardar líneas dudosas y operaciones en curso). Un único cambio de diseño: "una línea con
   `redsys_state` o con operación en curso no se borra, no se reenvía y no cambia a `retry`".
2. QA-01 + QA-02 (política "negativa tardía": ventana de gracia + `unknown` ante transporte sin respuesta) + QA-15.
3. QA-19 antes de usar el módulo con pedidos guardados en servidor; QA-20/QA-10 (validación y marca del mock en servidor).
4. QA-16/QA-17 (grupo del campo y alcance del RPC), QA-22 (Web Locks), QA-14, QA-21, QA-04.
5. BAJOS en un único pase de endurecimiento.

Tras cada corrección: quitar la marca `todo` del test JS correspondiente (o invertir la aserción del `test_qa_known_issue_*`).

## 8. Estado de correcciones backend (Python)

| ID | Estado | Nota |
|---|---|---|
| QA-16 | CORREGIDO | campo `redsys_signature_key` solo `group_pos_manager`; RPC con sudo. Test `test_qa_16_*` |
| QA-17 | CORREGIDO | RPC exige sesión abierta del usuario en esa config (managers: cualquier config con sesión abierta). Test `test_qa_17_*` |
| QA-19 | CORREGIDO | writes idempotentes; solo cambios reales bloquean. Tests `test_qa_19_*` |
| QA-20 | CORREGIDO (parcial) | validación XML/importe/pedido/RTS/comercio/terminal y unicidad; no se verifica `firma` ni marca MOCK (QA-10 servidor) |
| QA-21 | CORREGIDO (parcial) | vista/filtro/wizard de conciliación auditada; falta aviso al cerrar sesión (cliente) |
| QA-18 | ABIERTO | `unknown -> False` sigue permitido (lo usa el cliente) |

Los tests `test_qa_known_issue_*` Python se reescribieron para afirmar el comportamiento correcto. Ver DECISIONS.md "Correcciones QA backend".

## 9. Estado de correcciones cliente (JS)

| ID | Estado | Nota |
|---|---|---|
| QA-01 | Estado: corregido en ae3a691 | gracia 2 min desde el inicio del cobro + checkStatus 0 + confirmación del cajero (`releaseLine`); reconsulta automática |
| QA-02 | Estado: corregido en ae3a691 | `-98`/timeout local => `unknown`; `isBusy` sigue ocupado hasta retorno tardío/`orphanMs` |
| QA-04 | Estado: corregido en ae3a691 | `_recover` coteja importe (`AMOUNT_MISMATCH`) |
| QA-10 | Estado: corregido en ae3a691 (parcial) | firma `MOCK...` en el XML simulado; falta rechazo en servidor (QA-20) e insignia fija |
| QA-14 | Estado: corregido en ae3a691 | contador de bloqueos en `recoverOrder` |
| QA-15 | Estado: corregido en ae3a691 | `recoverLine` salta líneas con cobro en curso |
| QA-11 | Estado: corregido en ea86d95 | `_run` no reenvía unknown/authorized/refund |
| QA-13 | Estado: corregido en ea86d95 | `sendPaymentRequest` idempotente por línea |
| QA-22 | Estado: corregido en ea86d95 | Web Locks `redsys-<comercio>-<terminal>`; sin locks degrada al guardián -3 |
| QA-23 | Estado: corregido en ea86d95 | override `deletePaymentLine` + `canDeleteRedsysLine` |
| QA-24 | Estado: corregido en ea86d95 | `refundInfoFor` por `redsys_original_pedido`; ambiguo => rechaza |
| QA-03/05/06/07/08/09/12/25 | Estado: sin corregir (BAJOS, fuera de alcance) | sus tests siguen como `todo` |

Verificación: `node --test tests_js/` => 0 fallos (8 todo, todos BAJOS). Sin navegador: `PaymentScreen` real, `localStorage` real y Web Locks reales no se han ejercitado (réplicas/stubs). Ver DECISIONS.md "Correcciones QA cliente".
