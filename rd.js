(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';

    function boot() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        try {
            Lampa.SettingsApi.addComponent({
                component: COMPONENT,
                name: 'Real-Debrid',
                icon: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
            });

            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: {
                    name: 'rd_bridge_status',
                    type: 'static',
                    default: ''
                },
                field: {
                    name: 'Проверка настроек',
                    description: 'Плагин загружен. Следующий шаг — добавить поля прокси и токена.'
                }
            });

            if (Lampa.Noty) {
                Lampa.Noty.show('Real-Debrid: тест настроек загружен');
            }
        } catch (error) {
            console.error('[RD bridge]', error);
            if (Lampa.Noty) {
                Lampa.Noty.show('RD: ' + (error.message || error));
            }
        }
    }

    if (window.Lampa && Lampa.SettingsApi) {
        boot();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') boot();
        });
    }
})();
