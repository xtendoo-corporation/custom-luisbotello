/** @odoo-module */

const WIZARD_SELECTOR = ".o_cash_calculator_wizard";
const QTY_INPUT_SELECTOR = ".o_cash_qty_group input";

/**
 * Al pulsar Enter en una cantidad del recuento de efectivo, salta a la
 * siguiente (billetes/monedas, en orden visual). En la última, pasa al
 * botón Confirmar.
 * @returns {boolean} true si se ha gestionado el evento
 */
export function focusNextCashInput(ev) {
    if (ev.key !== "Enter" || ev.isComposing) {
        return false;
    }
    const target = ev.target;
    if (!(target instanceof HTMLInputElement) || !target.matches(QTY_INPUT_SELECTOR)) {
        return false;
    }
    const wizard = target.closest(WIZARD_SELECTOR);
    if (!wizard) {
        return false;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const inputs = [...wizard.querySelectorAll(QTY_INPUT_SELECTOR)];
    const next = inputs[inputs.indexOf(target) + 1];
    if (next) {
        next.focus();
        next.select();
    } else {
        // Fuerza el commit del valor y deja el foco en Confirmar
        target.blur();
        wizard.querySelector("button[name='action_confirm']")?.focus();
    }
    return true;
}

document.addEventListener("keydown", focusNextCashInput, true);
