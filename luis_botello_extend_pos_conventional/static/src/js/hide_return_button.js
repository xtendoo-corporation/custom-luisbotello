/** @odoo-module */

import { hooks } from '@web/rest';
// Simple patch: on POS app start, if the config flag is enabled, hide any button-like elements
// that contain the word 'Devolver' (Spanish label used in translations).
// This is a pragmatic, non-invasive approach: it hides UI elements that match the text.

const HIDE_TEXT = 'Devolver';

function hideReturnButtons() {
    try {
        // look for buttons, links and elements with role=button
        const selectors = ['button', 'a', '[role="button"]', 'input[type="button"]'];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (el.innerText && el.innerText.trim().includes(HIDE_TEXT)) {
                    el.style.display = 'none';
                }
            });
        });
    } catch (err) {
        // ignore errors silently to avoid breaking POS
        console.error('hide_return_button: error while hiding return buttons', err);
    }
}

// Hook into DOMContentLoaded and a short timeout to cover dynamically rendered buttons
window.addEventListener('DOMContentLoaded', () => {
    // If pos is available on window (POS frontend), check config
    try {
        const pos = window.pos || (window.odoo && window.odoo.__POS__);
        // pos may not be available immediately; schedule a small delay
        setTimeout(() => {
            const cfg = pos && pos.config;
            if (cfg && cfg.hide_return_button) {
                hideReturnButtons();
                // also observe mutations to hide buttons added later
                const observer = new MutationObserver(() => hideReturnButtons());
                observer.observe(document.body, { childList: true, subtree: true });
            }
        }, 300);
    } catch (e) {
        // fallback: still try to hide after a short delay
        setTimeout(hideReturnButtons, 500);
    }
});

