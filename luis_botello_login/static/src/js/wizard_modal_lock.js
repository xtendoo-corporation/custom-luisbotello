
odoo.define('luis_botello_login.wizard_modal_lock', [], function (require) {
    "use strict";

    // This script only hides the close button visually for the attendance wizard
    // by adding a CSS class to the modal. It does NOT remove elements or
    // intercept events, so it won't interfere with footer buttons like Confirm.

    function markModalNoClose(dialog) {
        try {
            // Primer intento: detectamos si el propio contenido del modal incluye
            // un marcador (añadido en la vista XML) que identifica este wizard.
            // Es la forma más fiable y evita depender del título.
            try {
                if (dialog.querySelector('.o_modal_no_close_marker')) {
                    dialog.classList.add('o_modal_no_close');
                    return;
                }
            } catch (e) {
                // continue to backend check if marker is not present or fails
            }

            // Fallback: consultamos al backend si debemos mostrar/forzar el wizard.
            try {
                fetch('/luis_botello_login/check_show', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                }).then(function (resp) {
                    return resp.ok ? resp.json() : null;
                }).then(function (result) {
                    if (!result) { return; }
                    if (result.show) {
                        // Si el backend indica que debe mostrarse, ocultamos la X
                        dialog.classList.add('o_modal_no_close');
                    }
                }).catch(function (e) {
                    // En caso de error, no hacemos nada
                    console.warn('wizard_modal_no_close: check_show failed', e);
                });
            } catch (e) {
                console.warn('wizard_modal_no_close: fetch failed', e);
            }

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

