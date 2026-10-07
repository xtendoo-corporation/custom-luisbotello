/** @odoo-module */
/**
 * Consola de simulación Redsys: panel DOM mínimo (sin OWL ni dependencias de Odoo) para
 * forzar a mano el resultado de la siguiente operación del MockTransport.
 *
 * Doble puerta (ambas obligatorias):
 *   1. Parámetro de URL explícito `?redsys_sim=1` (o `#...&redsys_sim=1`).
 *   2. El método de pago tiene `redsys_simulation = true` (campo solo-admin en backend).
 * Además el transporte debe ser un MockTransport (`transport.isMock === true`).
 *
 * Uso desde el servicio (`redsys_tpvpc_service`), solo tras elegir MockTransport:
 *   import { shouldShowSimConsole, mountSimConsole } from "./mock/sim_console.js";
 *   if (shouldShowSimConsole({ search: window.location.search + window.location.hash,
 *                              methodSimulation: method.redsys_simulation, transport })) {
 *       this._simConsole = mountSimConsole(transport, { document });
 *   }
 *   // ... y this._simConsole?.destroy() al parar el servicio.
 * La consola nunca muestra clave ni PAN: solo pedido, importe, estado y escenarios.
 */
import {DENIAL_CODES, SCENARIOS} from "./scenarios.js";

export const SIM_URL_FLAG = "redsys_sim";

/** Consulta si la URL pide la consola (`redsys_sim=1`). */
export function isSimConsoleRequested(search = "") {
  const q = String(search).replace(/^[?#]/, "").replace(/#/g, "&").replace(/\?/g, "&");
  return new URLSearchParams(q).get(SIM_URL_FLAG) === "1";
}

/** Decide si se muestra la consola: URL + flag del método + transporte mock. */
export function shouldShowSimConsole({
  search = "",
  methodSimulation = false,
  transport = null,
} = {}) {
  return (
    methodSimulation === true &&
    Boolean(transport) &&
    transport.isMock === true &&
    isSimConsoleRequested(search)
  );
}

/** Construye la especificación de escenario a partir de los valores del formulario. */
export function buildScenarioSpec({
  name,
  code,
  denialCode,
  cardRead,
  charged,
  keysUpdating,
} = {}) {
  const spec = {name};
  if (name === "init_error" || name === "return_code") {
    spec.code = Number(code);
  }
  if ((name === "denied" || name === "denied_g") && denialCode) {
    spec.denialCode = String(denialCode);
  }
  if (cardRead !== undefined && cardRead !== "" && !Number.isNaN(Number(cardRead))) {
    spec.latency = {cardRead: Number(cardRead)};
  }
  if (keysUpdating) {
    spec.keysUpdating = true;
  }
  if ((name === "malformed_xml" || name === "truncated_xml") && charged === false) {
    spec.charged = false;
  }
  return spec;
}

/**
 * Monta el panel. `doc` es el document (inyectable para tests). Devuelve {element, destroy, refresh}.
 */
export function mountSimConsole(
  transport,
  {document: doc = globalThis.document, container} = {}
) {
  const el = (tag, props = {}, children = []) => {
    const node = doc.createElement(tag);
    const {role, text, ...rest} = props;
    if (role) {
      node.setAttribute("data-role", role);
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    Object.assign(node, rest);
    children.forEach((c) => node.appendChild(c));
    return node;
  };
  const option = (value, label) => el("option", {value, text: label});

  const select = el(
    "select",
    {role: "scenario"},
    Object.entries(SCENARIOS).map(([name, def]) =>
      option(name, `${def.label} [${name}]`)
    )
  );
  const denial = el(
    "select",
    {role: "denial"},
    Object.entries(DENIAL_CODES).map(([code, msg]) => option(code, `${code} - ${msg}`))
  );
  const code = el("input", {
    role: "code",
    type: "number",
    value: "-16",
    placeholder: "código",
  });
  const cardRead = el("input", {
    role: "card-read",
    type: "number",
    value: "",
    placeholder: "ms lectura",
  });
  const keys = el("input", {role: "keys", type: "checkbox"});
  const queue = el("div", {role: "queue"});
  const ops = el("div", {role: "operations"});

  const refresh = () => {
    queue.textContent =
      "Cola: " + (transport.queue.map((s) => s.name).join(", ") || "(vacía)");
    const last = transport.operations
      .slice(-8)
      .map((o) => `${o.tipoOper} #${o.pedido} ${o.cents / 100} EUR ${o.resultado}`);
    ops.textContent = "Operaciones: " + (last.join(" | ") || "(ninguna)");
  };
  const apply = el("button", {
    role: "force",
    type: "button",
    text: "Forzar siguiente",
    onclick: () => {
      transport.forceNext(
        buildScenarioSpec({
          name: select.value,
          code: code.value,
          denialCode: denial.value,
          cardRead: cardRead.value,
          keysUpdating: keys.checked,
        })
      );
      refresh();
    },
  });
  const clear = el("button", {
    role: "clear",
    type: "button",
    text: "Vaciar cola",
    onclick: () => {
      transport.clearForced();
      refresh();
    },
  });
  const close = el("button", {
    role: "close",
    type: "button",
    text: "Cerrar",
    onclick: () => destroy(),
  });

  const panel = el("div", {role: "sim-console"}, [
    el("strong", {text: "Simulador Redsys (solo pruebas)"}),
    select,
    denial,
    code,
    cardRead,
    el("label", {}, [keys, el("span", {text: " evento 'actualizando claves'"})]),
    apply,
    clear,
    close,
    queue,
    ops,
  ]);
  panel.style.cssText =
    "position:fixed;bottom:8px;right:8px;z-index:99999;max-width:360px;padding:8px;" +
    "background:#fff8e1;border:2px solid #f9a825;font:12px sans-serif;display:flex;" +
    "flex-direction:column;gap:4px;";

  const host = container || doc.body;
  host.appendChild(panel);
  refresh();

  function destroy() {
    if (panel.parentNode) {
      panel.parentNode.removeChild(panel);
    }
  }
  return {element: panel, destroy, refresh};
}
