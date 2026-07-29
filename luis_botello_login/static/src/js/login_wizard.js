/** @odoo-module */

import { NavBar } from '@web/webclient/navbar/navbar';
import { patch } from '@web/core/utils/patch';

patch(NavBar.prototype, {
    setup() {
        super.setup(...arguments);
        // Comprobación no bloqueante para mostrar el wizard post-login
        try {
            fetch('/luis_botello_login/check_show_simple', {credentials: 'same-origin'})
                .then(function (resp) { return resp.ok ? resp.json() : null; })
                .then(function (result) {
                    if (result && result.show && result.action) {
                        var self = this;
                        // Delay to ensure webclient is ready
                        setTimeout(function () {
                            try {
                                if (self.env && self.env.services && self.env.services.action && self.env.services.action.doAction) {
                                    console.debug('luis_botello_login: opening action from backend', result.action);
                                    self.env.services.action.doAction(result.action);
                                    return;
                                }
                            } catch (errAction) {
                                console.warn('luis_botello_login: action service failed', errAction);
                            }
                            // fallback: if action contains res_model == wizard, open by hash
                            try {
                                console.debug('luis_botello_login: opening wizard via hash fallback');
                                window.location = '/web#action=luis_botello_login.action_attendance_wizard';
                            } catch (e) {
                                console.warn('luis_botello_login: cannot open wizard', e);
                            }
                        }, 500);
                    }
                }.bind(this)).catch(function (e) {
                    // Ignorar errores
                });
        } catch (e) {
            console.warn('luis_botello_login: error checking show flag', e);
        }
    },
});


