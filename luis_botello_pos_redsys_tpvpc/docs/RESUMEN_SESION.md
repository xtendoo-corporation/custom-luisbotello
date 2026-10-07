# Resumen de la sesión: cobro con datáfono Redsys (TPV-PC) en el POS de Odoo 19

Fecha: 2026-10-07. Rama: `feat/redsys-tpvpc` del repo `custom-luisbotello` (36 commits sobre `19.0`, sin push ni merge).

## 1. Qué se hizo

Se construyó el módulo `luis_botello_pos_redsys_tpvpc`, que permite cobrar con tarjeta desde el POS de Odoo 19 con un Verifone P400 conectado por USB al PC del cajero. El navegador del POS llama al servicio local de Redsys. Sin servidor intermedio.

Todo se desarrolló y probó **contra un simulador**. No hay datáfono, ni navegador, ni `tpvpc-impl.js` en el entorno de desarrollo.

## 2. Qué incluye el módulo

Ruta: `luis_botello_pos_redsys_tpvpc/`

| Pieza | Dónde | Qué hace |
|---|---|---|
| Backend | `models/`, `wizard/`, `views/`, `security/` | Método de pago Redsys, campos de `pos.payment` (pedido, RTS, XML, estado, referencia, vínculo de devolución), protección de líneas, validación del cobro en servidor, conciliación auditada |
| Servicio Redsys | `static/src/app/redsys/` | `RedsysService`, parser de XML, mensajes de error en español, transportes reales (JS y HTTP) |
| Simulador | `static/src/app/redsys/mock/` | `MockTransport` con operaciones coherentes entre cobro, consulta y devolución, y consola de simulación |
| Integración POS | `static/src/app/` (fuera de `redsys/`) | `PaymentInterface`, servicio OWL, indicador de estado del datáfono, recuperación tras recarga, devoluciones, recibo |
| Kit de diagnóstico | `diagnostic_kit/` (raíz del repo) | Página independiente de Odoo para la sesión con el cliente |
| Documentación | `README.md`, `docs/` | Instalación, guía de sesión, contrato, informes de QA |

Cobros desconocidos (−2): se consulta a Redsys por la referencia `ODOO-<8 hex>` antes de permitir nada. Si no se puede resolver, la línea queda `unknown` y bloquea otro cobro hasta que un gerente la concilie.

## 3. Cómo se trabajó

Un orquestador fijó el contrato (`docs/service_contract.md`) y repartió el trabajo entre agentes con ficheros disjuntos: investigador del POS, backend, servicio JS, simulador, kit de diagnóstico, integración POS y documentación. Después hubo cuatro rondas de QA independiente, cada una seguida de una ronda de corrección.

| Ronda | Resultado |
|---|---|
| QA 1 | No apto: 4 bloqueantes de doble cobro o cobro sin registro (QA-01, 02, 13, 23) |
| QA 2 | No apto: dos caminos nuevos al cruzar con el core 19 (cancelar pedido, validar con efectivo) |
| QA 3 | Apto para hardware con condiciones; no apto para producción |
| Ronda 4 | Corrige R3-01 a R3-08; sin QA independiente posterior |

El estado de cada hallazgo está en `docs/qa_report.md`, `qa_report2.md` y `qa_report3.md`. Las decisiones, en `DECISIONS.md`.

## 4. Estado actual

- Tests JS: 228 pasan, 0 fallos, 8 `todo` BAJOS de la ronda 1.
- Tests Python: 60 sin fallos ni errores. Actualización con `-u` sin errores.
- `pre-commit` pasa sobre los ficheros del módulo. Solo queda el aviso opcional C8101 (autor del manifest).
- Cifras de la ronda 4 dadas por el agente que las ejecutó.

Ejecutar los tests:

```
# JS (el host no tiene node)
docker run --rm -v "$PWD":/m -w /m --entrypoint sh odoo_19-odoo:latest -c 'node --test tests_js/'
# Python: docker compose run odoo con una BD temporal, --test-tags /luis_botello_pos_redsys_tpvpc
```

## 5. Qué NO está verificado

- Nada con el datáfono real: S1 (HTTPS a localhost), S2 (P400 habilitado), S3 (puerto y versión), S4 (comportamiento de `tpvpc-impl.js`), S5, S7 (boleta) y el comportamiento real de la DLL.
- Nada en navegador: `PaymentScreen`, los parches de `PosStore` y `OrderPaymentValidation`, el botón de gerente de R3-04, los Web Locks reales.
- Si Redsys acepta reutilizar la misma `factura` tras un cobro autorizado o una denegación.
- La firma criptográfica de la respuesta de Redsys no se verifica.

## 6. Abierto

- R3-10: un `_logger.warning` contradice la política de no registrar nada.
- R3-11 (parcial): no cubre el borrado directo desde el widget de depuración.
- R3-09 (info): cajas `pos_non_touch`, donde el datáfono no se invoca. A confirmar con el cliente.
- QA2-05 (parcial): una línea `not_charged` en un pedido ya pagado no se puede borrar y su corrección es manual.
- Hallazgos BAJOS de la ronda 1 (QA-03, 05, 06, 07, 08, 09, 12, 25).
- El asistente de pago de `pos_conventional_payment_wizard` debe excluir los métodos con terminal. Es un cambio fuera de este repo.

## 7. Decisiones pendientes del humano

- El cierre de sesión se bloquea del todo con una línea `unknown`. ¿Bloquear o solo avisar?
- Licencia OPL-1 y redistribución de `tpvpc-impl.js` (confirmar con Redsys o el banco antes de commitearlo).
- La clave de firma viaja al navegador (riesgo aceptado D4). Ahora solo la lee `group_pos_manager` por lectura directa, y el RPC la entrega a `group_pos_user` de la caja con sesión abierta.

## 8. Siguientes pasos

1. Conseguir de Redsys y del banco: `tpvpc-impl.js`, MSI del servicio, drivers `DRIVERSVERIFONE`, credenciales de pruebas y confirmación escrita sobre el P400.
2. Montar una instancia Odoo de pruebas con HTTPS y una sesión de unos 90 minutos con el cliente (`docs/session_guide.md`, `diagnostic_kit/README_SESION.md`).
3. Tras la sesión: escribir `SPIKE.md`, reajustar el simulador con lo capturado y repetir los casos de fallo reales (USB, Internet, recarga).
4. Antes de producción: tour real en navegador, nueva ronda de QA y la "Checklist de producción" de `README.md` (hacia la línea 190).

## 9. Dónde mirar

```
cd /home/dani-castillo/Odoo_19/odoo/custom/src/custom-luisbotello
git log --oneline 19.0..HEAD
git diff --stat 19.0..HEAD
```

Otros ficheros tocados fuera del módulo: `README.md` de la raíz (dos filas nuevas) y `.gitignore`.
