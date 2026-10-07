# Instalación en el PC Windows de la caja

Para quien instala el servicio de Redsys y el datáfono Verifone P400. Los pasos
del servicio y los drivers están tomados del guion de la sesión de pruebas
(`diagnostic_kit/README_SESION.md`, en la raíz del repositorio); lo no verificado
con hardware se marca [SUPUESTO-HW].

## 1. Requisitos del PC

- Windows 10 u 11, equipo fijo de la caja (no portátil que se mueva, tablet ni móvil).
- .NET Framework 4.8 instalado.
- Internet estable.
- Puertos **9100, 10205 y 10305** libres (el servicio los usa; ningún otro programa).
- Chrome o Edge actualizado. El POS de Odoo se abrirá **siempre** en este navegador.
- Datáfono Verifone P400 con cable USB. [SUPUESTO-HW] S2: que el banco lo tenga
  habilitado para TPV-PC Implantado y que Windows lo vea como puerto COM.

## 2. Ficheros necesarios (los facilita Redsys/el banco, no están en el repo)

- Instalador `.msi` del servicio **TpvpcPinPadImplantadoService**: versión de pruebas
  (INTE) para pruebas; versión **de explotación** para producción.
- Drivers `DRIVERSVERIFONE`.
- `tpvpc-impl.js` (va en el servidor Odoo, ver README del módulo).

## 3. Instalación

1. Conecte el datáfono por USB y enciéndalo.
2. Instale los drivers de Verifone (ejecutar como administrador, Siguiente hasta
   Finalizar; reiniciar si lo pide).
3. Instale el servicio de Redsys (`.msi`): doble clic, Siguiente hasta Finalizar;
   acepte el aviso de Windows.
4. **Puerto COM**: clic derecho en Inicio > Administrador de dispositivos > "Puertos
   (COM y LPT)". Anote el puerto del Verifone, p. ej. `COM9`. Si no aparece
   ningún puerto nuevo, deténgase: es una pista de que el driver o el modelo no
   encajan (S2).
5. **Servicio**: abra "Servicios" y compruebe que `TpvpcPinPadImplantadoService`
   está "En ejecución" y con **inicio automático** (propiedades > Tipo de inicio).
6. **Puerto COM fijo**: use siempre el mismo puerto USB físico y compruebe que el
   número COM no cambia al reenchufar. Si cambia, fíjelo en las propiedades del
   puerto (Configuración avanzada).

## 4. Cadena de configuración del puerto

En el método de pago de Odoo, el campo "Redsys COM port" lleva:

```
COM<n>:,19200,N,8,1        ejemplo: COM9:,19200,N,8,1
```

Versión del protocolo: `8.1` (por defecto) o `6.1`. [SUPUESTO-HW] S3: ni la
velocidad ni la versión están verificadas para el P400; si `Init` da `-20` (puerto
COM incorrecto) o `-21` (versión incompatible), revise el COM y pruebe la otra versión.

## 5. Antivirus y cortafuegos

Si el POS no consigue hablar con `localhost:10305` (síntoma: el indicador del
datáfono en rojo y -98 "tpvpc-impl.js no está cargado" o fallo de conexión),
compruebe antivirus/cortafuegos y el permiso del navegador de "acceso a la red
local". [SUPUESTO-HW] S1.

## 6. Comprobación

Antes de usar el POS, ejecute el kit de diagnóstico (`diagnostic_kit/`, ver
`docs/session_guide.md`). `Init` con `Response=0` y `CheckStatus` con `Response=0`
indican que el entorno es correcto.

## 7. Pasar a explotación

Desinstale el servicio de pruebas, instale el MSI de explotación, configure las
credenciales reales en Odoo y use la `tpvpc-impl.js` de producción (la de pruebas
no vale). Ver el checklist del README del módulo.

## Códigos de `Init` frecuentes

`-16` sin conexión con Redsys · `-18` comercio/terminal/clave incorrectos · `-19`
pinpad mal configurado (llamar al banco) · `-20` puerto COM incorrecto · `-21` versión
incompatible · `-40` librería caducada (actualizar). No repita `Init` en bucle: puede
bloquear la cuenta del servicio.
