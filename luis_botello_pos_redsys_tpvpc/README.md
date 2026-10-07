# Luis Botello POS Redsys TPV-PC

Cobro con datáfono **Verifone P400** mediante **Redsys TPV-PC Implantado** desde el
POS de Odoo 19. Versión `19.0.1.0.0`, licencia OPL-1, depende solo de `point_of_sale`.

> Estado: **desarrollado y probado solo contra el simulador**. Nada de lo marcado
> `[SUPUESTO-HW]` se ha verificado con el datáfono real. No usar en producción
> sin pasar la sesión de pruebas con hardware (ver `docs/session_guide.md`).

## Qué hace

- Añade el terminal de pago **Redsys TPV-PC** a los métodos de pago del POS.
- El navegador del POS habla con el servicio Windows de Redsys en `localhost`
  (librería JS `tpvpc-impl.js`, o servicio HTTP en el puerto 10305 como alternativa).
- Cobro, denegación, devolución total o parcial, consulta de operaciones y
  **recuperación de cobros dudosos** (retorno -2, recarga del navegador, corte de red)
  sin reintentar nunca a ciegas, para evitar el doble cobro.
- Guarda en `pos.payment`: pedido Redsys (`transaction_id`), referencia, RTS, XML
  de la respuesta, estado (`authorized`, `unknown`, `refund`, `not_charged`) y
  datos de recibo (marca, últimos 4 dígitos, autorización).
- Indicador de estado del datáfono en la barra superior del POS.
- Conciliación auditada de pagos dudosos para el administrador.
- Simulador (modo simulación) para desarrollar y formar sin datáfono.

## Requisitos

- **PC de la caja**: Windows 10/11 fijo, .NET Framework 4.8, Internet estable,
  puertos **9100, 10205 y 10305** libres.
- El **POS debe abrirse en el navegador (Chrome/Edge) del mismo PC** donde está
  conectado el datáfono. No funciona desde tablet, móvil ni Linux.
- Servicio `TpvpcPinPadImplantadoService` de Redsys y drivers `DRIVERSVERIFONE`
  (los facilita Redsys/el banco; no están en el repositorio).
- `tpvpc-impl.js` oficial de Redsys.
- Credenciales: código de comercio (FUC), terminal y clave de firma, de pruebas
  primero y reales después. **No se guardan en el repositorio.**
- Odoo 19 con HTTPS accesible desde ese PC. [SUPUESTO-HW] S1: que un POS en HTTPS
  pueda llamar a `localhost` (contenido mixto / CORS / permiso de red local de
  Chrome) no está verificado.
- Una sola transacción simultánea por datáfono (limitación de Redsys).

## Instalación

### 1. En el PC de la caja (Windows)

Ver [docs/install_windows.md](docs/install_windows.md): drivers, servicio, puerto COM.

### 2. En Odoo

```bash
# Instalar (BD de pruebas primero)
odoo --stop-after-init -i luis_botello_pos_redsys_tpvpc -d <bd>
# Actualizar
odoo --stop-after-init -u luis_botello_pos_redsys_tpvpc -d <bd>
```

### 3. Librería de Redsys

Copiar el fichero **sin modificar** a:

```
luis_botello_pos_redsys_tpvpc/static/lib/tpvpc/tpvpc-impl.js
```

No va en `static/src/` ni en el manifest: el POS lo carga bajo demanda solo con
transporte `js`. Si falta, el POS arranca igual y el datáfono real muestra
"tpvpc-impl.js no está cargado". Revise la licencia de Redsys antes de
versionarlo. [SUPUESTO-HW] S4: la forma en que el fichero real expone la clase
no está verificada.

## Configuración del método de pago

Punto de venta > Configuración > Métodos de pago > nuevo método, **Usar un terminal
de pago = Redsys TPV-PC**, y añadirlo a la configuración del TPV de esa caja.

| Campo | Valor |
|---|---|
| Redsys merchant code (FUC) | Código de comercio, 9 dígitos |
| Redsys terminal | Número de terminal (por defecto `1`) |
| Redsys signature key | Clave de firma (solo visible para administradores del POS) |
| Redsys COM port | `COM<n>:,19200,N,8,1`, p. ej. `COM9:,19200,N,8,1` (por defecto). `<n>` es el que muestra el Administrador de dispositivos. [SUPUESTO-HW] S3: velocidad/parámetros para el P400 sin verificar |
| Redsys protocol version | `8.1` (por defecto) o `6.1`. [SUPUESTO-HW] S3: cuál acepta el P400 se determina en la sesión; `-21` indica versión incompatible |
| Redsys transport | `JavaScript library` (recomendado) o `HTTP service` ([SUPUESTO-HW] S5: método/ruta HTTP no documentados) |
| Redsys simulation mode | Solo administradores; **dejar desmarcado en producción** |

Reglas: la pareja (comercio, terminal) es única entre métodos Redsys. La clave
nunca se carga con los datos del POS: se pide por RPC al abrir y solo vive en memoria.

## Entorno de pruebas vs. real

| | Pruebas (INTE) | Real (explotación) |
|---|---|---|
| Servicio Windows | versión de pruebas | versión **de explotación** |
| Credenciales | las de pruebas del banco | las reales |
| Librería `tpvpc-impl.js` | de pruebas | **la de producción: la de pruebas no vale** |

Pasar a real solo con aprobación explícita: primer cobro real de 1 EUR y su
devolución. Cambiar credenciales en el método de pago, sustituir el MSI y la
librería, y volver a ejecutar el checklist de producción.

## Modo simulación

Sustituye el datáfono por un simulador en el navegador (escenarios: autorizado,
denegado, desconocido, errores de init, XML mal formado...).

- **Quién**: solo `group_pos_manager` puede marcar `Redsys simulation mode`
  (comprobado en el servidor al crear/escribir).
- **Doble puerta** para activarlo: método con `redsys_simulation` marcado **y**
  `redsys_sim=1` en la URL del POS. Con ambos se usa el transporte simulado y se
  monta la consola del simulador; sin la URL, el POS usa el datáfono real aunque
  el flag esté marcado.
- Los XML simulados llevan `<firma>MOCK...`; el servidor rechaza esas líneas si el
  método no tiene simulación activa.
- El simulador **no valida nada real**: sirve para formación y desarrollo.

## Flujo de cobro

1. El cajero elige el método Redsys y pulsa para cobrar. Se genera la referencia
   `ODOO-<8 hex>` (única, <= 20 caracteres) y se guarda **antes** de enviar.
2. El datáfono pide la tarjeta (estados "esperando tarjeta"/"esperando"). Cancelar
   solo se permite antes de leer la tarjeta; después, se cancela en el datáfono.
3. **Autorizado** solo si el XML trae `estado = F` y `resultado = Autorizada`
   (un retorno 0 no basta). Se guardan pedido, RTS, XML y datos de recibo.
4. **Denegado/error**: línea en reintento con diálogo explicativo.
5. El servidor valida que el XML guardado coincide con el importe, pedido, RTS y
   comercio/terminal de la línea.

## Cobro dudoso (unknown) y conciliación

Si no se sabe si se cobró (retorno -2, timeout local, recarga con el cobro en curso,
estado P), el POS **consulta a Redsys por referencia** (ventana +-10 min) en lugar
de reintentar. Resultado:

- Encontrada autorizada: la línea se da por cobrada (`recovered`).
- Denegada o no encontrada tras 2 min de gracia con el datáfono sano: se permite reintentar.
- Sin certeza: línea `unknown` bloqueada (no se borra ni se modifica), con reconsulta automática.

El cajero puede usar **Forzar** (confirmación manual) y se comprueba antes con Redsys.
**Nunca** debe repetirse un cobro dudoso sin consultar.

Conciliación (solo `group_pos_manager`): menú **Punto de venta > Redsys payments to
reconcile** (filtro `unknown` activo) o acción sobre la lista de pagos. Se elige
"cobrado" (`authorized`/`refund`) o "no cobrado" (`not_charged`), con nota obligatoria;
queda registrado quién y cuándo. La comprobación se hace en el portal
`canales.redsys.es` (módulo de administración; las operaciones se conservan 4 meses).
Una línea `not_charged` sigue sumando en el pedido: corregir el pedido es manual.

## Devoluciones

- En un pedido de devolución, al elegir el método Redsys se busca el cobro Redsys
  original del pedido (por pedido Redsys y RTS) y se propone `-min(pendiente, original)`.
- Parcial o total; nunca más que el original menos lo ya devuelto (acumulado por
  `redsys_original_pedido`; Redsys lo impone además con `TPV-PC0100`).
- Si el cobro original no es Redsys autorizado con pedido y RTS, no se añade la línea.
- La acumulación solo cuenta pedidos cargados en el POS.

## Seguridad

- **Riesgo aceptado D4**: la clave de firma viaja al navegador (la necesita
  `fnDllIniTpvpcLatente`). Mitigaciones: campo `groups='point_of_sale.group_pos_manager'`,
  no incluido en la carga del POS, RPC `redsys_get_signature_key` que exige
  `group_pos_user`, sesión abierta de la caja por el propio usuario (o manager) y
  devuelve solo los métodos Redsys de esa caja; solo en memoria, sin `localStorage`
  ni logs. En BD está en texto plano.
- No se registra la clave ni PAN completo (Redsys devuelve el PAN enmascarado).
- `redsys_simulation` solo editable por administradores del POS.
- Las líneas `authorized`/`unknown`/`refund` no se pueden borrar ni modificar.

## Tests

```bash
# JS (sin Odoo, Node >= 18), desde la raíz del módulo
docker run --rm -v "$PWD":/m -w /m --entrypoint sh odoo_19-odoo:latest -c 'node --test tests_js/'
# (o directamente: node --test tests_js/ si hay Node instalado)

# Python (BD temporal; desde la raíz del proyecto Doodba)
docker compose run --rm -e PGDATABASE=<bd_temporal> odoo odoo -d <bd_temporal> \
  -i luis_botello_pos_redsys_tpvpc --test-tags /luis_botello_pos_redsys_tpvpc \
  --stop-after-init --without-demo=all
```

Resultado verificado el 2026-10-07: JS 211 tests (203 pass, 0 fail, 8 `todo`);
Python 37 tests, 0 failed, 0 errors. Borre la BD temporal al terminar.

No cubierto (sin navegador ni hardware): tour del POS, `PaymentScreen` real,
compatibilidad con la suite `pos_conventional_*` y con
`luis_botello_extend_pos_conventional`, linters `pre-commit`.

## Checklist de producción

- [ ] PC Windows 10/11 fijo, .NET 4.8, Internet estable, puertos 9100/10205/10305 libres.
- [ ] Servicio `TpvpcPinPadImplantadoService` **de explotación** (no el de pruebas), arrancando con Windows.
- [ ] Drivers `DRIVERSVERIFONE` instalados; COM correcto y fijo (no cambia al reenchufar).
- [ ] Comercio, terminal y clave **reales** en el método de pago; `tpvpc-impl.js` de producción.
- [ ] Simulación desmarcada.
- [ ] POS abierto siempre en el navegador de ese PC.
- [ ] Banco informado y pruebas de aceptación firmadas si las exige.
- [ ] Procedimiento de cobro dudoso: quién consulta en `canales.redsys.es` y cómo se concilia.
- [ ] Contacto de soporte Redsys/entidad a mano.
- [ ] Primer cobro real de 1 EUR y su devolución, con aprobación explícita.

## Limitaciones conocidas

Hallazgos QA de severidad BAJA sin corregir (detalle en `docs/qa_report.md`; sus
tests están como `todo`): QA-03 (`init` sin timeout propio), QA-05 (importe con
coma/ausente), QA-06 (no cotejo de factura/comercio/terminal/moneda de la respuesta),
QA-07 (errores de negocio -3 pierden el texto), QA-08 (sin allow-list en campos al
ticket), QA-09 (regex ignora comentarios XML), QA-12 (`util.inspect` muestra la clave
del servicio), QA-25 (cualquier excepción marca `unknown`). QA-18 queda como decisión
(`unknown -> False` es la liberación del cajero). Además: falta aviso al cerrar
sesión con líneas `unknown`; no hay insignia fija de simulación; la `firma` de la
respuesta no se verifica (algoritmo no documentado); sin DCC, eventos 6/7 ni preautorización.

Supuestos sin hardware: S1 HTTPS a localhost; S2 que el P400 esté habilitado por el
banco para TPV-PC Implantado (el manual solo cita Vx820 e iPP320); S3 puerto/versión;
S4 comportamiento real de `tpvpc-impl.js`; S5 HTTP en 10305; S6 contrato
`PaymentInterface` (leído del código de Odoo 19, sin tour en navegador); S7 contenido
del recibo/certificación; S8 detalles del simulador (orden de eventos, errores de
devolución, timeout de 40 s, formato de consulta, hora local en consultas).

Decisiones y razones: [DECISIONS.md](DECISIONS.md). Contrato del servicio:
[docs/service_contract.md](docs/service_contract.md).
