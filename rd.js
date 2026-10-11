
(function () {
    'use strict';

    var NAME = 'rd_bridge';

    function boot() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: NAME,
            name: 'Real-Debrid',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: NAME,
            param: {
                name: 'rd_info',
                type: 'static',
                default: ''
            },
            field: {
                name: 'Real-Debrid',
                description: 'Проверка настроек: плагин загружен'
            }
        });

        if (Lampa.Noty) Lampa.Noty.show('RD: тест настроек загружен');
    }

    if (window.Lampa && Lampa.SettingsApi) {
        boot();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') boot();
        });
    }
})();
