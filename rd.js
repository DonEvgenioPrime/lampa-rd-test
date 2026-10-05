try {
    (function () {
        'use strict';

        var PLUGIN_NAME = 'rd_test';

        function boot() {
            console.log('[RD TEST] boot');

            if (Lampa.Noty) {
                Lampa.Noty.show('Real-Debrid TEST: ЗАПУЩЕН');
            }

            if (!Lampa.SettingsApi) {
                if (Lampa.Noty) {
                    Lampa.Noty.show('RD TEST: SettingsApi не найден');
                }
                return;
            }

            Lampa.SettingsApi.addComponent({
                component: PLUGIN_NAME,
                name: 'Real-Debrid TEST',
                icon:
                    '<svg width="22" height="22" viewBox="0 0 24 24">' +
                    '<circle cx="12" cy="12" r="9" fill="none" ' +
                    'stroke="currentColor" stroke-width="2"/>' +
                    '</svg>'
            });

            Lampa.SettingsApi.addParam({
                component: PLUGIN_NAME,

                param: {
                    name: 'rd_test_info',
                    type: 'static',
                    default: ''
                },

                field: {
                    name: 'Real-Debrid работает',
                    description: 'Тестовый плагин загружен'
                }
            });

            console.log('[RD TEST] ready');
        }

        if (window.Lampa && Lampa.Activity) {
            boot();
        } else {
            var bootOnce = Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') {
                    boot();
                    Lampa.Listener.remove('app', bootOnce);
                }
            });
        }

    })();

} catch (e) {

    console.error('[RD TEST] fatal error', e);

    try {
        if (window.Lampa && Lampa.Noty) {
            Lampa.Noty.show(
                'RD TEST ошибка: ' +
                (e.message || String(e))
            );
        }
    } catch (_) {}
}
