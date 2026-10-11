(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';
    var PROXY_DEFAULT = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';

    var Config = {
        proxy: Lampa.Storage.get('rd_bridge_proxy') || PROXY_DEFAULT,
        token: Lampa.Storage.get('rd_bridge_token') || ''
    };

    function boot() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: COMPONENT,
            name: 'Real-Debrid',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
        });

        var params = [
            {
                key: 'rd_bridge_proxy',
                name: 'URL прокси',
                desc: 'Cloudflare Worker',
                type: 'input',
                default: PROXY_DEFAULT,
                get: function () {
                    return Config.proxy;
                },
                set: function (value) {
                    Config.proxy = String(value || '').trim();
                    Lampa.Storage.set('rd_bridge_proxy', Config.proxy);
                }
            },
            {
                key: 'rd_bridge_token',
                name: 'API-токен Real-Debrid',
                desc: 'Личный токен Real-Debrid',
                type: 'input',
                default: '',
                get: function () {
                    return Config.token;
                },
                set: function (value) {
                    Config.token = String(value || '').trim();
                    Lampa.Storage.set('rd_bridge_token', Config.token);
                },
                mask: true
            }
        ];

        params.forEach(function (p) {
            var currentField = null;

            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: {
                    name: p.key,
                    type: p.type,
                    values: '',
                    default: p.default
                },
                field: {
                    name: p.name,
                    description: p.desc
                },
                onChange: function (value) {
                    var actual = value && typeof value === 'object'
                        ? value.value
                        : value;
                    p.set(actual);

                    if (currentField) {
                        var input = currentField.find('input');
                        if (input.length) input.val(p.get());
                    }
                },
                onRender: function (field) {
                    currentField = field;
                    var input = field.find('input');

                    if (input.length) {
                        input.val(p.get());
                        if (p.mask) input.attr('type', 'password');
                    }
                }
            });
        });

        if (Lampa.Noty) {
            Lampa.Noty.show('Real-Debrid: настройки загружены');
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
