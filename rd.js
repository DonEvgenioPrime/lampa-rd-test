
(function () {
    'use strict';

    var NAME = 'rd_bridge';
    var PROXY_DEFAULT = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';

    function notify(message) {
        if (window.Lampa && Lampa.Noty) {
            Lampa.Noty.show(message);
        }
        console.log('[RD]', message);
    }

    function get(key, fallback) {
        return Lampa.Storage.get(NAME + '_' + key, fallback || '');
    }

    function set(key, value) {
        Lampa.Storage.set(NAME + '_' + key, value);
    }

    function request(path, method, body) {
        var proxy = get('proxy', PROXY_DEFAULT).trim();
        var token = get('token').trim();

        if (!token) {
            return Promise.reject(new Error('Сначала укажи токен Real-Debrid'));
        }

        var target = 'https://api.real-debrid.com/rest/1.0' + path;
        var url = proxy.replace(/\/+$/, '') +
            '?url=' + encodeURIComponent(target);

        var options = {
            method: method || 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/json'
            }
        };

        if (body) {
            options.headers['Content-Type'] =
                'application/x-www-form-urlencoded';
            options.body = body;
        }

        return fetch(url, options).then(function (response) {
            return response.text().then(function (text) {
                var data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    data = { message: text };
                }

                if (!response.ok) {
                    throw new Error(
                        data.error || data.message ||
                        'HTTP ' + response.status
                    );
                }

                return data;
            });
        });
    }

    function checkConnection() {
        notify('RD: проверяем подключение...');

        request('/user').then(function (user) {
            notify('RD подключён: ' + (user.username || 'OK'));
        }).catch(function (error) {
            notify('RD ошибка: ' + error.message);
        });
    }

    function addMagnet(magnet) {
        if (!/^magnet:\?/i.test(magnet)) {
            notify('RD: неверная magnet-ссылка');
            return;
        }

        request(
            '/torrents/addMagnet',
            'POST',
            'magnet=' + encodeURIComponent(magnet)
        ).then(function (result) {
            notify('RD: торрент добавлен, ID ' + result.id);
        }).catch(function (error) {
            notify('RD ошибка: ' + error.message);
        });
    }

    function boot() {
        if (!window.Lampa || !Lampa.SettingsApi) {
            console.error('[RD] SettingsApi недоступен');
            return;
        }

        Lampa.SettingsApi.addComponent({
            component: NAME,
            name: 'Real-Debrid',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24">' +
                '<circle cx="12" cy="12" r="9" fill="none" ' +
                'stroke="currentColor" stroke-width="2"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: NAME,
            param: {
                name: NAME + '_proxy',
                type: 'input',
                default: PROXY_DEFAULT
            },
            field: {
                name: 'URL прокси',
                description: 'Адрес Cloudflare Worker'
            },
            onChange: function (value) {
                set('proxy', value);
            }
        });

        Lampa.SettingsApi.addParam({
            component: NAME,
            param: {
                name: NAME + '_token',
                type: 'input',
                default: ''
            },
            field: {
                name: 'API-токен Real-Debrid',
                description: 'Вводи токен только в Lampa'
            },
            onChange: function (value) {
                set('token', value);
            }
        });

        Lampa.SettingsApi.addParam({
            component: NAME,
            param: {
                name: 'rd_check',
                type: 'button'
            },
            field: {
                name: 'Проверить подключение',
                description: 'Проверка API Real-Debrid через прокси'
            },
            onChange: checkConnection
        });

        window.LampaRD = {
            check: checkConnection,
            addMagnet: addMagnet
        };

        notify('Real-Debrid: плагин загружен');
    }

    if (window.Lampa && Lampa.SettingsApi) {
        boot();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') boot();
        });
    }
})();
