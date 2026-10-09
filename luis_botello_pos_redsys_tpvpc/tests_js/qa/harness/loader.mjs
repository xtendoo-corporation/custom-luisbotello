// Hook de resolución de Node: redirige los especificadores de Odoo (@odoo/owl,
// @web/..., @point_of_sale/...) al módulo de stubs de este directorio, para poder
// ejecutar el servicio OWL y la PaymentInterface reales sin navegador ni Odoo.
const STUBS = new URL("./stubs.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (/^@(odoo|web|point_of_sale)\//.test(specifier)) {
    return {url: STUBS, shortCircuit: true};
  }
  return nextResolve(specifier, context);
}
