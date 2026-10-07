/** @odoo-module */
// Construye RedsysService + transporte según la configuración del método de
// pago. Sin dependencias de Odoo (loader y documento se inyectan).

import { RedsysService } from "../redsys/redsys_service.js";
import { RealHttpTransport } from "../redsys/transports/real_http_transport.js";
import { RealJsTransport } from "../redsys/transports/real_js_transport.js";
import { MockTransport } from "../redsys/mock/mock_transport.js";
import { isSimConsoleRequested, mountSimConsole, shouldShowSimConsole } from "../redsys/mock/sim_console.js";
import { chooseTransportKind, validateMethodConfig } from "./redsys_pos_logic.js";

/**
 * @param {Object} p
 * @param {Object} p.method registro pos.payment.method (campos redsys_*)
 * @param {string} p.signKey clave de firma (solo memoria)
 * @param {string} [p.search] location.search + location.hash
 * @param {Function} [p.loader] carga tpvpc-impl.js (transporte js)
 * @param {Document} [p.document]
 * @param {Object} [p.serviceOptions] opciones de RedsysService
 * @returns {{error:string}|{redsys:RedsysService, transport:Object, kind:string, destroy:Function}}
 */
export function createRedsysEntry({ method, signKey, search = "", loader, document: doc, serviceOptions = {} }) {
    const error = validateMethodConfig(method, signKey);
    if (error) {
        return { error };
    }
    const kind = chooseTransportKind({
        transport: method.redsys_transport,
        simulation: method.redsys_simulation,
        search,
        flagCheck: isSimConsoleRequested,
    });
    let transport;
    if (kind === "mock") {
        transport = new MockTransport();
    } else if (kind === "http") {
        transport = new RealHttpTransport();
    } else {
        transport = new RealJsTransport({ loader });
    }
    // QA-22: exclusión entre pestañas con Web Locks (si el navegador no los tiene, se degrada al guardián del datáfono).
    const locks = (typeof navigator !== "undefined" && navigator.locks) || null;
    const redsys = new RedsysService({ locks, ...serviceOptions }).configure({
        merchant: method.redsys_merchant_code,
        terminal: method.redsys_terminal_number,
        signKey,
        port: method.redsys_com_port,
        version: method.redsys_protocol_version,
        transport,
    });
    let simConsole = null;
    if (doc && shouldShowSimConsole({ search, methodSimulation: method.redsys_simulation, transport })) {
        simConsole = mountSimConsole(transport, { document: doc });
    }
    return {
        redsys,
        transport,
        kind,
        destroy() {
            if (simConsole && simConsole.destroy) {
                simConsole.destroy();
            }
            simConsole = null;
        },
    };
}
