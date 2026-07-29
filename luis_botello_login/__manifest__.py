{
    'name': 'Luis Botello Login',
    'version': '1.0',
    'category': 'Tools',
    'summary': 'Mostrar un wizard de entrada de asistencia justo después del login',
    'description': 'Al iniciar sesión muestra un wizard que dice "Realiza la entrada de asistencia"',
    'author': 'xtendoo',
    'depends': ['web', 'hr_attendance'],
    'data': [
        'views/wizard_view.xml',
        'data/actions.xml',
        'security/ir.model.access.csv',
    ],
    'assets': {
        'web.assets_backend': [
            'luis_botello_login/static/src/css/hide_modal_close.css',
            'luis_botello_login/static/src/js/login_wizard.js',
            'luis_botello_login/static/src/js/wizard_modal_lock.js',
        ],
    },
    'installable': True,
    'application': False,
}

