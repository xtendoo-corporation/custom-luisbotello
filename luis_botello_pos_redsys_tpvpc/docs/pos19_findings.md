# Hallazgos POS Odoo 19 (investigador, solo lectura)

Rutas relativas a `odoo/custom/src`. POS = `odoo/addons/point_of_sale/static/src/app`.

## PaymentInterface (POS/utils/payment/payment_interface.js)

- `setup(pos, payment_method_id)`; `supports_reversals=false` por defecto; getter
  `fastPayments` (true => envía al seleccionar).
- `sendPaymentRequest(uuid)` -> Promise<boolean>: true hecho, false reintentar, rechazo
  = estado manual. En éxito: `line.setReceiptInfo()`, `line.transaction_id`,
  `line.card_type`.
- `sendPaymentCancel(order, uuid)` -> Promise<boolean>: solo cancela.
  `sendPaymentReversal(uuid)` opcional (requiere `supports_reversals=true`). `close()`.
- Registro: `register_payment_method(use_payment_terminal, Class)` desde
  `@point_of_sale/app/services/pos_store`; PosStore.setup crea
  `pm.payment_terminal = new Interface(pos, pm)`.
- `payment_status` es string libre: pending, retry, force_done, waitingCard, waiting,
  waitingCancel, waitingCapture, reversing, done, reversed, timeout. `isDone()`:
  vacío/done/reversed. `pay()` pone "waiting", espera `sendPaymentRequest`, luego
  `handlePaymentResponse(bool)`.
- Hook de devolución: `updateRefundPaymentLine(refundedLine)` (vacío por defecto).
- PaymentScreen: `addNewPaymentLine` bloquea si `pos.paymentTerminalInProgress`;
  `deletePaymentLine` solo envía cancel en waiting/waitingCard/timeout; líneas done no
  se pueden borrar; `electronicPaymentInProgress` true si estado != done/reversed.

## pos_adyen (referencia)

- Manifest depende de `point_of_sale`; assets en `point_of_sale._assets_pos`.
- Python: `_get_payment_terminal_selection`, `_load_pos_data_fields` (solo campos no
  secretos), campos secretos con `groups`.
- Vista: xpath tras `use_payment_terminal`, campos
  `invisible="use_payment_terminal != '...'"`.
- Reanudación tras recarga: patch de `PaymentScreen.setup` con `onMounted` que busca
  líneas no done.
- Adyen no soporta devoluciones; razorpay/stripe: guardan id externo en `transaction_id`
  y lo copian en `updateRefundPaymentLine` a `uiState`; razorpay pre-crea líneas de
  devolución negativas en `addNewPaymentLine`.

## Campos reutilizables de pos.payment

`transaction_id`, `payment_ref_no`, `card_type`, `card_brand`, `card_no`,
`cardholder_name`, `payment_method_authcode`, `ticket`, `payment_status` (se sincroniza
al servidor). Campos nuevos de pos.payment se cargan al POS automáticamente (mixin
default `[]` = todos).

## Suite pos*conventional*\* y luis_botello_extend_pos_conventional

- No sobrescriben PaymentScreen/PosPayment en el frontend; solo parchean PosStore
  (cash_drawer), Orderline y recibo.
- Riesgos: (1) `hide_return_button.js` oculta botones con texto "Devolver" (puede
  ocultar el "Refund" del terminal si `hide_return_button` activo) y importa
  `@web/rest`, que quizá no existe en 19; (2) el wizard backend excluye métodos con
  terminal del pago rápido y hace `payment_ids.unlink()` (puede borrar un cobro
  confirmado) ; (3) `pos.payment._search` filtra por cookie `access_slug`; (4) revisar
  `pos_order_workflow_utils.payOrderWithMethod` (core).
- Mitigación: no depender de ellos; proteger líneas Redsys done frente a unlink
  (constraint) en backend.

## addons.yaml

`custom-luisbotello: ["*"]` activo; `xtendoo-pos-conventional: ["*"]` activo.
