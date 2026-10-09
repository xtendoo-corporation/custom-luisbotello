# Guion de la sesión de pruebas con el datáfono (máx. 90 min)

Para: persona del comercio (no hace falta ser técnico). Le acompañamos por videollamada con pantalla compartida.
Objetivo: comprobar que el PC de la caja, el navegador y el datáfono Verifone P400 se entienden con el servicio de Redsys, y que el cobro se hace desde una página segura (HTTPS) como lo hará el TPV de Odoo.

## Antes de la sesión (lo prepara quien dirige, no el cliente)
- Que el kit esté publicado en una dirección que empiece por `https://` (ver `index_https_odoo.md`) y que junto a `index.html` esté el fichero `tpvpc-impl.js` oficial de Redsys. Sin ese fichero los botones de operación salen desactivados.
- Tener a mano: comercio, terminal, clave de firma, y el instalador (.msi) del servicio **TpvpcPinPadImplantadoService** y los drivers del Verifone (DRIVERSVERIFONE) que facilitan Redsys/el banco.
- Pedir al cliente: PC Windows 10/11 de la caja con Internet, el P400 y un cable USB, una tarjeta real (se cobrará 0,01 € y se devolverá) y 90 minutos sin usar la caja.
- La clave de firma se la dicta o se la escribe el cliente al principio: no se guarda en ningún sitio ni sale en el informe.

## Guion (tiempos orientativos)

### 1. Preparar el PC (15-25 min)
1. Conecte el datáfono al PC por USB y enciéndalo.
2. Instale los drivers del Verifone (ejecute el instalador como administrador, Siguiente hasta Finalizar). Si pide reiniciar, reinicie.
3. Instale el servicio de Redsys (.msi): doble clic, Siguiente hasta Finalizar. Si Windows pregunta si permite cambios, pulse Sí.
4. Abra el "Administrador de dispositivos" (clic derecho en Inicio) y despliegue "Puertos (COM y LPT)". Anote el nombre del puerto del Verifone, por ejemplo `COM9`. Comparta pantalla para que lo veamos. Si no aparece ningún puerto nuevo, avise: es una pista importante.
5. Abra "Servicios" de Windows (escriba "servicios" en Inicio) y compruebe que **TpvpcPinPadImplantadoService** está "En ejecución". Si no, clic derecho y "Iniciar".

### 2. Abrir la página (5 min)
1. Abra **Chrome o Edge** y escriba la dirección `https://...` que le indicamos (empieza por https).
2. Debe ver "Kit de diagnóstico Redsys". Si arriba aparece un recuadro rojo (no se pudo cargar tpvpc-impl.js), avise y no siga con el apartado 4.
3. Si el navegador pregunta si permite acceder a "dispositivos de la red local" o similar, pulse **Permitir**.
4. Los chequeos de la sección 1 se ejecutan solos. Cuando acaben, pulse **"Descargar informe .json"** (guarda la foto de cómo está el entorno) y apunte si alguna línea está en rojo (FALLO). No intente arreglarla.

### 3. Datos (3 min)
Rellene: Comercio, Terminal, Clave de firma, **Puerto** con el formato `COM9:,19200,N,8,1` (cambie COM9 por el suyo) y **Versión** `8.1` (si falla, probaremos `6.1`).

### 4. Pruebas con el datáfono (30-40 min). Un botón cada vez; espere a que aparezca respuesta
1. **Init**. Debe aparecer `Response=0`. Si no, no repita en bucle: copie/capture el mensaje y avise. Hacemos como mucho 2-3 intentos con otro puerto o versión (lo indicamos nosotros).
2. **CheckStatus**. Debe dar `Response=0`.
3. **Cobrar 0,01 €**. Confirme el aviso. Pase/inserte la tarjeta en el datáfono, y marque el PIN si lo pide. Espere sin tocar nada (puede tardar 30-60 s). Debe verse "AUTORIZADA".
   - Si se queda colgado o sale `-2`: **NO pulse Cobrar otra vez**. Pulse **Consultar**.
4. **Consultar**. Debe aparecer la operación recién hecha.
5. **Devolver 0,01 €**. Confirme. Debe verse autorizada la devolución (el cargo vuelve a la tarjeta).
6. **Parar**.

### 5. Cierre (5-10 min)
1. Pulse **"Descargar informe .json"** otra vez (ahora incluye todas las pruebas).
2. Envíenos ese fichero (correo o el canal acordado). Es seguro: no lleva la clave ni números de tarjeta.
3. Cierre la pestaña. Si desea, desinstale lo que no vaya a usar.

## Qué anotamos nosotros durante la sesión
| Pregunta | Resultado |
|---|---|
| S1: ¿Init da 0 desde la página https? | |
| S2: ¿el P400 aparece como COM y responde? | |
| S3: puerto y versión que funcionaron | |
| S4: ¿cargó tpvpc-impl.js, sin errores en consola? | |
| S5: ¿responde el servicio HTTP directo (botón "Probar servicio HTTP directo")? | |
| Cobro 0,01 €: estado/resultado, pedido, RTS | |
| Devolución | |

## Si algo sale mal
- Recuadro rojo de tpvpc-impl.js: falta el fichero o se abrió con file://. Reabrir por la dirección https.
- Chequeo "localhost:10305" en FALLO: servicio parado, antivirus/firewall, o el navegador bloquea la llamada a red local. Anote el mensaje rojo de la consola (F12, pestaña Consola) y envíelo.
- `-16` sin conexión con Redsys; `-18` comercio/terminal/clave incorrectos; `-20` puerto COM incorrecto; `-21` versión incompatible; `-40` librería caducada. Avise, no insista.
- Prohibido reintentar un cobro dudoso sin consultar antes (riesgo de cobrar dos veces).
- Para ensayar la página sin datáfono: añada `?mock=1` a la dirección (simulador del kit; no sirve para validar nada real).
