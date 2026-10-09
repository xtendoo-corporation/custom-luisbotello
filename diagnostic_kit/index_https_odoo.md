# Ejecutar el kit desde un origen HTTPS (el de Odoo)

## Por qué
En producción el POS de Odoo se carga por HTTPS y llamará desde ahí a `http://localhost:10305` (servicio de Redsys). Que eso funcione (S1: contenido mixto, CORS, Private Network Access / permiso de red local de Chrome) depende del **origen** de la página. Por tanto:

- `file://` no es representativo.
- `http://localhost:<puerto>` (por ejemplo `python3 -m http.server`) **no es representativo para S1**: localhost se trata como origen de confianza y no sufre contenido mixto ni el permiso de red local. Sirve solo para ensayar con `?mock=1` o para depurar el kit.
- Es válido: cualquier `https://` real, idealmente el **mismo dominio** que usará el POS.

## Qué tiene que estar junto a index.html
- `tpvpc-impl.js` oficial de Redsys (portal canales.redsys.es, Documentación). No está en el repositorio ni debe subirse (comprobar permiso de redistribución).
- Se carga con `import('./tpvpc-impl.js')` como módulo ES: el servidor debe servir `.js` con `Content-Type` JavaScript.

## Opción A: servir el kit desde el propio Odoo (recomendada, misma origen que el POS)
Solo en una base/entorno de pruebas o con acceso controlado.
1. Elegir un addon ya instalado cualquiera, por ejemplo el propio módulo del proyecto, y copiar la carpeta dentro de su `static/` (fuera del control de versiones o con `*.local.*`/gitignore):
   `cp -r diagnostic_kit <addon>/static/diagnostic_kit` y añadir ahí `tpvpc-impl.js`.
2. Abrir `https://<dominio-odoo>/<addon>/static/diagnostic_kit/index.html`. (En Odoo los ficheros de `static/` se sirven sin login.)
3. Ejecutar el guion de `README_SESION.md`. En el informe, el campo `entorno.url` indica el origen usado.
4. Al terminar, borrar la copia de `static/` (contiene `tpvpc-impl.js`) y reiniciar si procede.

## Opción B: cargarlo desde una página de Odoo ya autenticada
Si el origen debe ser idéntico y además con sesión, crear una página de prueba (vista QWeb o ruta de un módulo temporal) que incluya el contenido de `index.html` o un `<iframe src="/<addon>/static/diagnostic_kit/index.html">`. El iframe mantiene el origen de Odoo; si el iframe da problemas de permisos, añadir `allow="local-network-access"` o abrir la URL directamente (Opción A).

## Opción C: otro hosting HTTPS
Cualquier alojamiento estático con HTTPS (subdominio de pruebas, almacenamiento con HTTPS, túnel temporal). Útil para una primera pasada, pero un origen distinto de Odoo puede dar resultados distintos en S1: **confirme después desde el dominio de Odoo** (A o B).

## Cómo interpretar S1
- `Init` con `Response=0` desde origen HTTPS: S1 superado.
- Chequeos `localhost:10305` en FALLO con el servicio en marcha: mirar consola (F12): "Mixed Content", "blocked by CORS policy" o "Private Network Access"/"Local Network Access" indican la causa. Probar con el navegador actualizado, aceptar el permiso de red local si aparece y volver a ejecutar.
- Si falla S1, **parar y avisar** (plan §9): no cambiar de arquitectura por cuenta propia.
