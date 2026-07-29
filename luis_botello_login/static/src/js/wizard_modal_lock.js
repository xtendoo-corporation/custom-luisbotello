
odoo.define('luis_botello_login.wizard_modal_lock', [], function (require) {
    "use strict";

    // This script only hides the close button visually for the attendance wizard
    // by adding a CSS class to the modal. It does NOT remove elements or
    // intercept events, so it won't interfere with footer buttons like Confirm.

    function markModalNoClose(dialog) {
        try {
            var titleEl = dialog.querySelector('.modal-title, .o_modal_title, .o_dialog_title')
                || dialog.querySelector('h4') || dialog.querySelector('h3');
            var title = titleEl && titleEl.textContent && titleEl.textContent.trim();
            if (!title) { return; }
            if (title.indexOf('Registro de asistencia') === -1 && title.indexOf('Entrada de asistencia') === -1) {
                return;
            }
            dialog.classList.add('o_modal_no_close');
        } catch (err) {
            // Do not break the UI if something goes wrong
            console.error('wizard_modal_no_close', err);
        }
    }

    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes && m.addedNodes.forEach(function (node) {
                if (!(node instanceof Element)) { return; }
                if (node.matches && (node.matches('.modal') || node.matches('[role="dialog"]') || node.classList.contains('o_dialog'))) {
                    markModalNoClose(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('.modal, [role="dialog"], .o_dialog').forEach(markModalNoClose);
                }
            });
        });
    });

    function startObserver() {
        try {
            if (document && document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }
        } catch (err) {
            console.error('wizard_modal_no_close: could not start observer', err);
        }
    }

    if (document && document.body) {
        startObserver();
    } else {
        document.addEventListener('DOMContentLoaded', startObserver);
    }

});

