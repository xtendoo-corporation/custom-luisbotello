# tpvpc-impl.js (librería de Redsys)

Coloque aquí, SIN modificar, el fichero `tpvpc-impl.js` entregado por Redsys:

    static/lib/tpvpc/tpvpc-impl.js

- NO va en `static/src/` (el glob de assets lo empaquetaría) ni en el manifest:
  el servicio `redsys_tpvpc` lo carga bajo demanda y solo con transporte `js`
  desde `/luis_botello_pos_redsys_tpvpc/static/lib/tpvpc/tpvpc-impl.js`
  (primero `import()` como módulo ESM; si no expone `TpvpcImplantado`, como
  script clásico y se busca en `window.tpvpcImpl` / `Tpvpc.TpvpcImplantado`).
- Si el fichero falta, el POS arranca igual: el datáfono real mostrará
  "tpvpc-impl.js no está cargado". El mock y el transporte HTTP no lo necesitan.
- [SUPUESTO-HW] S4: la forma exacta de exponer la clase no se ha verificado
  con el fichero real. Ver DECISIONS.md (J8, I1).
- Revise la licencia de Redsys antes de versionar el fichero (puede estar en .gitignore).
