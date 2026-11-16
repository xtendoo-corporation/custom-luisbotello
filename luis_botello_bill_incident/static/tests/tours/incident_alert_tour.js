import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("luis_botello_bill_incident_tour", {
    steps: () => [
        {
            content: "El aviso de incidencias aparece al abrir la factura",
            trigger: ".modal .modal-body:contains('Mercancía dañada')",
        },
        {
            content: "Cerrar el aviso",
            trigger: ".modal .modal-footer button:contains('Entendido')",
            run: "click",
        },
        {
            content: "El aviso se ha cerrado",
            trigger: "body:not(:has(.modal-body:contains('Mercancía dañada')))",
        },
    ],
});
