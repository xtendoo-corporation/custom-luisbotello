# Contrato de `RedsysService` (fijado por el Orquestador)

Ubicación: `static/src/app/redsys/`. Lógica pura, sin dependencias de Odoo salvo el
wrapper OWL `redsys_tpvpc_service.js`.

## Ficheros y propietarios

| Fichero                                                                                     | Dueño           |
| ------------------------------------------------------------------------------------------- | --------------- |
| `redsys/redsys_service.js` (clase `RedsysService`, máquina de estados, recuperación −2)     | Servicio JS     |
| `redsys/xml_parser.js` (`parsePayXml`, `parseQueryXml`, `isAuthorized`)                     | Servicio JS     |
| `redsys/errors.js` (mapa códigos retorno y TPV-PCxxxx → mensajes en español)                | Servicio JS     |
| `redsys/transports/real_js_transport.js`, `real_http_transport.js`                          | Servicio JS     |
| `redsys/mock/mock_transport.js`, `mock/scenarios.js`, `mock/sim_console.js`                 | Simulador       |
| `static/src/app/**` fuera de `redsys/` (PaymentInterface, registro, UI, recibo, devolución) | Integración POS |
| `models/`, `views/`, `security/`, `tests/test_*.py`                                         | Backend         |
| `diagnostic_kit/**`                                                                         | Kit diagnóstico |

## Interfaz de transporte (las 3 implementaciones)

Misma forma que `TpvpcImplantado` de Redsys:

```
initFnDll(args[comercio, terminal, clave, puerto, version], cb({Response:int, Result:string|null}))
execFnDll(command:string, args:string[], cb(ret))
subscribeEvent('pinpadImplantadoEvent_1..7', cb)
EnableLog() / DisableLog()
```

Los transportes NUNCA registran la clave ni XML con PAN.

## RedsysService

```
configure({merchant, terminal, signKey, port, version, transport})
async init()                -> {ok, code, message}   // idempotente; re-init solo ante -1/-99, un único reintento con backoff
async checkStatus()         -> {code: 0|-1|-2|-3}
async pay({amount, reference}) -> PayResult
async refund({pedido, rts, amount, reference}) -> PayResult
async query({reference, from, to, type}) -> QueryResult
on(event, cb)   // 'cardReading'(1) 'keysUpdating'(2) 'transactionEnd'(3) 'cardOk'(4) 'error'(5) 'dcc'(6) 'extraPayments'(7)
async stop()
isBusy()  // true mientras haya operación en curso: una sola transacción simultánea
```

```
PayResult = { status: 'authorized'|'denied'|'unknown'|'error',
              pedido, rts, reference, authCode, cardBrand, maskedPan, date,
              rawXml, errorCode?, userMessage }
QueryResult = { found: bool, operations: [{estado, resultado, pedido, rts, factura, importe, fecha}], error? }
```

Reglas:

- Importe: `"12.34"` (punto, 2 decimales, sin miles).
- `isAuthorized(xml) ⇔ estado=="F" && resultado.toLowerCase()=="autorizada"`; todo lo
  demás no autoriza.
- `pay` con retorno −2: guardar `t0` antes, consultar ±10 min por `reference`;
  encontrada autorizada → `authorized`; no encontrada → `error` (reintentable); consulta
  falla/−2 → `unknown` (nunca reintento ciego).
- `reference` ≤ 20 caracteres, única, derivada del uuid de la línea POS: `ODOO-<8 hex>`.
- `pay`/`refund` mientras `isBusy()` → `{status:'error', errorCode:'BUSY'}` sin llamar
  al transporte.
- `init` solo al arrancar o tras −1/−99; nunca en bucle. −40 = librería caducada
  (mensaje específico).
- `[SUPUESTO-HW]` con ID S1–S7 en comentarios y DECISIONS.md para todo lo no verificado.

## Datos persistidos en `pos.payment` (Backend)

Reutilizar: `transaction_id` (=pedido), `payment_ref_no` (=reference/factura),
`card_brand`, `card_no` (últimos 4), `payment_method_authcode`, `ticket`. Nuevos:
`redsys_rts`, `redsys_xml`, `redsys_state` (`authorized|unknown|refund`),
`redsys_reference`. Campos de `pos.payment.method`: `redsys_merchant_code`,
`redsys_terminal_number`, `redsys_signature_key` (groups restringidos, no copiable),
`redsys_com_port`, `redsys_protocol_version`, `redsys_transport` (js/http),
`redsys_simulation` (solo administrador).
