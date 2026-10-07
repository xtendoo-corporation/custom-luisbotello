# DECISIONS
- D1: Módulo depende solo de `point_of_sale`; sin dependencias con otros luis_botello_*.
- D2: Licencia OPL-1, versión 19.0.1.0.0.
- D3: Toda la lógica Redsys en `static/src/app/redsys/`; transportes intercambiables (RealJs, RealHttp, Mock).
- D4 (riesgo aceptado): la clave de firma viaja al navegador (necesario para fnDllIniTpvpcLatente). Solo para group_pos_user y solo del método de la caja.
- D5: Devoluciones vía `updateRefundPaymentLine` copiando pedido/RTS de la línea original (patrón razorpay/stripe). `transaction_id` = pedido Redsys.
- D6: Proteger líneas Redsys confirmadas frente a `unlink` (el wizard backend de pos_conventional las borra).
