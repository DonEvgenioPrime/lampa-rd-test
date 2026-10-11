(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';
    var KEY = 'rd_bridge_proxy';
    var DEFAULT_PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';

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
                    name: KEY,
                    type: 'input',
                    default: DEFAULT_PROXY
                },
                field: {
                    name: 'URL прокси',
                    description: 'Адрес Cloudflare Worker'
                }
            });
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
