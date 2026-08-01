/** @odoo-module */

import { rpc } from "@web/core/network/rpc";

const HIDE_TEXT = 'Devolver';

function hideReturnButtons() {
    try {
        const selectors = ['button', 'a', '[role="button"]', 'input[type="button"]'];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (el.innerText && el.innerText.trim().includes(HIDE_TEXT)) {
                    el.style.display = 'none';
                }
            });
        });
    } catch (err) {
        console.error('hide_return_button_backend: error', err);
    }
}

function parseIdFromHref(href, modelName) {
    try {
        const url = new URL(href, window.location.origin);
        // legacy URLs have fragment like /web#id=123&model=pos.session&view_type=form
        if (url.hash && url.hash.includes('model=' + modelName)) {
            const params = new URLSearchParams(url.hash.replace('#', ''));
            const id = params.get('id');
            return id ? parseInt(id, 10) : false;
        }
        // direct query param
        const params = new URLSearchParams(url.search);
        const id2 = params.get('id');
        const model2 = params.get('model');
        if (model2 === modelName && id2) {
            return parseInt(id2, 10);
        }
    } catch (e) {
        // ignore
    }
    return false;
}

async function checkAndMaybeHide() {
    try {
        // find a link to pos.session in the form (Sesión field)
        const anchors = Array.from(document.querySelectorAll('a'));
        let sessionId = false;
        for (const a of anchors) {
            const href = a.getAttribute('href') || '';
            if (href.includes('model=pos.session') || href.includes('model%3Dpos.session')) {
                const id = parseIdFromHref(href, 'pos.session');
                if (id) {
                    sessionId = id;
                    break;
                }
            }
            // Sometimes the anchor has dataset with model
            if (a.dataset && a.dataset.model === 'pos.session' && a.dataset.id) {
                sessionId = parseInt(a.dataset.id, 10);
                break;
            }
        }
        if (!sessionId) {
            return;
        }
        const sessions = await rpc('/web/dataset/call_kw', {
            model: 'pos.session',
            method: 'read',
            args: [[sessionId], ['config_id']],
            kwargs: {},
        });
        if (!sessions || !sessions[0]) {
            return;
        }
        const config = sessions[0].config_id && sessions[0].config_id[0];
        if (!config) {
            return;
        }
        const configs = await rpc('/web/dataset/call_kw', {
            model: 'pos.config',
            method: 'read',
            args: [[config], ['hide_return_button']],
            kwargs: {},
        });
        if (configs && configs[0] && configs[0].hide_return_button) {
            hideReturnButtons();
        }
    } catch (err) {
        console.error('checkAndMaybeHide error', err);
    }
}

// Run when DOM ready and observe mutations
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkAndMaybeHide, 300);
    const observer = new MutationObserver(() => checkAndMaybeHide());
    observer.observe(document.body, { childList: true, subtree: true });
});

