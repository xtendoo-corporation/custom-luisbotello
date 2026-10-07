# Guía para quien coordina la sesión de pruebas con el cliente

Para la persona de Xtendoo que dirige la sesión remota (máx. 90 min) con el comercio.
El guion paso a paso para el cliente está en `diagnostic_kit/README_SESION.md` (raíz del
repositorio); aquí está lo que hay que preparar, pedir y anotar.

## Material del kit

| Fichero (en `diagnostic_kit/`) | Para qué |
|---|---|
| `README_SESION.md` | Guion para el cliente (preparar PC, abrir la página, init/check/cobro 0,01 EUR/consulta/devolución) y tabla de anotaciones S1-S5 |
| `index.html` | Página de diagnóstico que ejecuta los chequeos y descarga el informe `.json` |
| `index_https_odoo.md` | Cómo servir el kit desde un origen HTTPS (Odoo, opción A recomendada) para que S1 sea representativo |

`file://` y `http://localhost` no son representativos para S1. Ensayo sin datáfono:
añadir `?mock=1` a la dirección (no valida nada real).

## Antes de la sesión (lo que hay que conseguir)

Pedir **pronto** (no debe ser el cuello de botella). Lista del plan §9:

1. Del portal `canales.redsys.es`: **`tpvpc-impl.js`**, el **MSI del servicio** (versión
   de pruebas INTE y, más adelante, la de explotación) y los drivers **`DRIVERSVERIFONE`**.
2. **Credenciales de pruebas** (comercio, terminal, clave de firma) a través del banco
   del cliente. No pegarlas en el repo ni en el chat: van a un fichero local ignorado por git
   (`*credentials*`, `diagnostic_kit/*.local.*`).
3. **Confirmación escrita de Redsys/banco** de que el P400 está habilitado para TPV-PC
   Implantado con el servicio JS (S2) y qué `cConfPuerto`/`cVersion` usar (S3). El manual
   solo nombra Vx820 e iPP320.
4. Una **sesión remota de ~90 min** con el cliente (PC Windows con el P400).
5. Una **instancia Odoo de pruebas con HTTPS** accesible desde el PC del cliente.

Además, para el cierre: preguntar al banco qué debe imprimir la boleta y si exige
certificación o pruebas de aceptación firmadas (S7), y cómo se consulta un cobro
dudoso en `canales.redsys.es` (las operaciones se conservan 4 meses).

Del cliente: PC Windows 10/11 de la caja con Internet, el P400 y su cable USB, una
tarjeta real (se cobra 0,01 EUR y se devuelve) y 90 minutos sin usar la caja.

## Durante la sesión

- Servir el kit por HTTPS junto con `tpvpc-impl.js` (ver `index_https_odoo.md`).
- El cliente escribe la clave de firma; no se guarda ni sale en el informe.
- Seguir el guion de `README_SESION.md`; un botón cada vez.
- Máximo 2-3 intentos de `Init` con otro puerto o versión (los indica usted).
- Si el cobro se cuelga o da `-2`: **no repetir**; usar Consultar.
- Anotar: S1 (¿Init da 0 desde https?), S2 (¿P400 como COM?), S3 (puerto/versión que
  funcionan), S4 (¿carga `tpvpc-impl.js` sin errores?), S5 (servicio HTTP directo),
  cobro de 0,01 EUR (estado, pedido, RTS) y devolución.
- Recoger los dos informes `.json`.

## Cuándo parar y avisar (plan §9)

Parar y avisar al responsable si: falla S1 (HTTPS a localhost) o S2 (el P400 no funciona
con el servicio); `Init` da `-19` o `-21` de forma persistente; `tpvpc-impl.js` o el
servicio exigen algo no documentado (certificado, otra versión, proxy); o se va a hacer
algo irreversible (cobro real, devolución real, tocar producción). No cambiar de
arquitectura por cuenta propia.

## Después de la sesión

1. Rellenar `SPIKE.md` (plan §11) con S1-S7.
2. Con los informes, ajustar el simulador y añadir tests de regresión.
3. Segunda tanda en la instancia Odoo ya con el módulo: cobro, denegación (importes/
   tarjetas de prueba del banco), devolución total y parcial, consulta, doble clic.
4. Pruebas de fallo reales: desconectar el USB a mitad, cortar Internet, recargar el
   navegador a mitad, reiniciar el servicio Windows, apagar el datáfono.
5. Pasar a entorno real solo con aprobación explícita: primer cobro de 1 EUR y su devolución.
6. Borrar de `static/` del servidor Odoo la copia del kit y de `tpvpc-impl.js` si no es del módulo.
