(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
    var OAUTH = 'https://api.real-debrid.com/oauth/v2/';
    var API = 'https://api.real-debrid.com/rest/1.0/';
    var PUBLIC_CLIENT_ID = 'X245A4XAIBGVM';
    var STORE = 'rd_bridge_oauth_v1';
    var busy = false;

    function notify(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show(message);
        } else {
            window.alert(message);
        }
    }

    function proxyUrl(url) {
        return PROXY + '?url=' + encodeURIComponent(url);
    }

    function readStore() {
        try {
            return JSON.parse(localStorage.getItem(STORE) || '{}');
        } catch (e) {
            return {};
        }
    }

    function saveStore(data) {
        localStorage.setItem(STORE, JSON.stringify(data));
    }

    function apiRequest(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers.Accept = 'application/json';

        return fetch(proxyUrl(url), options).then(function (response) {
            return response.text().then(function (text) {
                var data;
                try {
                    data = text ? JSON.parse(text) : {};
                } catch (e) {
                    data = { message: text };
                }

                if (!response.ok) {
                    var message = data.error_description ||
                        data.error || data.message || ('HTTP ' + response.status);
                    var err = new Error(message);
                    err.status = response.status;
                    err.data = data;
                    throw err;
                }

                return data;
            });
        });
    }

    function formBody(data) {
        return Object.keys(data).map(function (key) {
            return encodeURIComponent(key) + '=' +
                encodeURIComponent(data[key]);
        }).join('&');
    }

    function postForm(url, data) {
        return apiRequest(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formBody(data)
        });
    }

    function getProfile(token) {
        return apiRequest(API + 'user', {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + token }
        });
    }

    function verifyAndSave(tokens, credentials) {
        if (!tokens.access_token) {
            throw new Error('Real-Debrid не вернул access_token');
        }

        var stored = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || '',
            expires_in: tokens.expires_in || 0,
            obtained_at: Date.now(),
            client_id: credentials.client_id,
            client_secret: credentials.client_secret
        };

        return getProfile(stored.access_token).then(function (profile) {
            stored.username = profile.username || '';
            stored.user_id = profile.id || '';
            saveStore(stored);
            notify('Real-Debrid подключён: ' +
                (profile.username || 'профиль подтверждён'));
        }).catch(function (err) {
            throw new Error('Токен получен, но профиль не проверен: ' + err.message);
        });
    }

    function startOAuth() {
        if (busy) return;
        busy = true;

        var deviceUrl = OAUTH + 'device/code?client_id=' +
            encodeURIComponent(PUBLIC_CLIENT_ID) + '&new_credentials=yes';

        apiRequest(deviceUrl).then(function (device) {
            if (!device.device_code || !device.user_code) {
                throw new Error('RD не вернул код устройства');
            }

            var verificationUrl = device.verification_url ||
                'https://real-debrid.com/device';

            notify('Открой ' + verificationUrl +
                ' и введи код: ' + device.user_code);

            // Открываем официальный сайт, если браузер разрешает это.
            try {
                window.open(verificationUrl, '_blank');
            } catch (e) {}

            var started = Date.now();
            var interval = Math.max(5, Number(device.interval) || 5) * 1000;
            var expires = (Number(device.expires_in) || 1800) * 1000;

            function pollCredentials() {
                if (Date.now() - started >= expires) {
                    busy = false;
                    notify('Код авторизации истёк. Запусти подключение заново.');
                    return;
                }

                var url = OAUTH + 'device/credentials?client_id=' +
                    encodeURIComponent(PUBLIC_CLIENT_ID) +
                    '&code=' + encodeURIComponent(device.device_code);

                apiRequest(url).then(function (credentials) {
                    if (!credentials.client_id || !credentials.client_secret) {
                        throw new Error('RD не вернул реквизиты приложения');
                    }

                    var body = {
                        client_id: credentials.client_id,
                        client_secret: credentials.client_secret,
                        code: device.device_code,
                        grant_type: 'http://oauth.net/grant_type/device/1.0'
                    };

                    return postForm(OAUTH + 'token', body).then(function (tokens) {
                        return verifyAndSave(tokens, credentials);
                    });
                }).then(function () {
                    busy = false;
                }).catch(function (err) {
                    // Пока пользователь не подтвердил код, RD отвечает ошибкой.
                    if (err.status === 400 || err.status === 403) {
                        setTimeout(pollCredentials, interval);
                    } else {
                        busy = false;
                        notify('Ошибка OAuth: ' + err.message);
                    }
                });
            }

            setTimeout(pollCredentials, interval);
        }).catch(function (err) {
            busy = false;
            notify('Не удалось начать авторизацию: ' + err.message);
        });
    }

    function checkConnection() {
        var stored = readStore();

        if (!stored.access_token) {
            notify('Сначала подключи Real-Debrid.');
            return;
        }

        getProfile(stored.access_token).then(function (profile) {
            notify('Подключено: ' + (profile.username || 'Real-Debrid'));
        }).catch(function (err) {
            notify('Проверка профиля не прошла: ' + err.message);
        });
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi ||
            window.__rd_bridge_loaded) return;

        window.__rd_bridge_loaded = true;

        Lampa.SettingsApi.addComponent({
            component: COMPONENT,
            name: 'Real-Debrid',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: { name: 'rd_oauth_start', type: 'button', values: '' },
            field: {
                name: 'Подключить Real-Debrid',
                description: 'Авторизация на официальном сайте RD'
            },
            onChange: startOAuth
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: { name: 'rd_oauth_check', type: 'button', values: '' },
            field: {
                name: 'Проверить подключение',
                description: 'Проверяет доступ к профилю RD'
            },
            onChange: checkConnection
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: { name: 'rd_oauth_info', type: 'static', default: '' },
            field: {
                name: 'Важно',
                description: 'Токены сохраняются в локальном хранилище браузера. Не используйте этот вариант на недоверенной публичной странице.'
            }
        });
    }

    if (window.Lampa && Lampa.SettingsApi) {
        addSettings();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') addSettings();
        });
    }
})();
