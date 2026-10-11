(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
    var OAUTH = 'https://api.real-debrid.com/oauth/v2/';
    var API = 'https://api.real-debrid.com/rest/1.0/';
    var PUBLIC_CLIENT_ID = 'X245A4XAIBGVM';
    var STORE = 'rd_bridge_oauth_v2';
    var active = false;
    var timer = null;

    function notify(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show(message);
        } else {
            window.alert(message);
        }
    }

    function urlThroughProxy(url) {
        return PROXY + '?url=' + encodeURIComponent(url);
    }

    function request(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers.Accept = 'application/json';

        return fetch(urlThroughProxy(url), options).then(function (response) {
            return response.text().then(function (body) {
                var data;
                try {
                    data = body ? JSON.parse(body) : {};
                } catch (e) {
                    data = { message: body };
                }

                if (!response.ok) {
                    var reason = data.error_description ||
                        data.error || data.message || body;
                    var error = new Error(
                        'HTTP ' + response.status +
                        (reason ? ': ' + String(reason).slice(0, 180) : '')
                    );
                    error.status = response.status;
                    throw error;
                }
                return data;
            });
        });
    }

    function postForm(url, data) {
        var body = Object.keys(data).map(function (key) {
            return encodeURIComponent(key) + '=' +
                encodeURIComponent(data[key]);
        }).join('&');

        return request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body
        });
    }

    function profile(token) {
        return request(API + 'user', {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + token
            }
        });
    }

    function storeTokens(tokens, credentials) {
        if (!tokens || !tokens.access_token) {
            throw new Error('RD не вернул access_token');
        }

        return profile(tokens.access_token).then(function (user) {
            var value = {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || '',
                expires_in: Number(tokens.expires_in) || 0,
                obtained_at: Date.now(),
                client_id: credentials.client_id,
                client_secret: credentials.client_secret,
                username: user.username || '',
                user_id: user.id || ''
            };

            localStorage.setItem(STORE, JSON.stringify(value));
            return value;
        });
    }

    function readTokens() {
        try {
            return JSON.parse(localStorage.getItem(STORE) || '{}');
        } catch (e) {
            return {};
        }
    }

    function stopPolling() {
        active = false;
        if (timer) clearTimeout(timer);
        timer = null;
    }

    function openDevicePage(url) {
        try {
            if (window.Lampa && Lampa.Platform && Lampa.Platform.open) {
                Lampa.Platform.open(url);
                return;
            }
        } catch (e) {}

        try {
            window.open(url, '_blank');
        } catch (e) {}
    }

    function showDeviceScreen(device, status) {
        var old = document.getElementById('rd-bridge-device-screen');
        if (old) old.remove();

        var screen = document.createElement('div');
        screen.id = 'rd-bridge-device-screen';
        screen.style.cssText =
            'position:fixed;z-index:999999;inset:0;' +
            'background:rgba(0,0,0,.94);color:#fff;display:flex;' +
            'align-items:center;justify-content:center;padding:24px;' +
            'box-sizing:border-box;font-family:Arial,sans-serif;';

        screen.innerHTML =
            '<div style="width:100%;max-width:520px;text-align:center;">' +
              '<div style="font-size:24px;font-weight:bold;margin-bottom:18px;">' +
                'Подключение Real-Debrid</div>' +
              '<div style="font-size:16px;opacity:.9;margin-bottom:10px;">' +
                '1. Открой официальный сайт и введи этот код</div>' +
              '<div id="rd-bridge-user-code" style="font-size:42px;' +
                'font-weight:bold;letter-spacing:5px;padding:18px 8px;' +
                'margin:10px 0;background:#252525;border-radius:10px;' +
                'user-select:text;">' + escapeHtml(device.user_code) + '</div>' +
              '<button id="rd-bridge-copy" style="font-size:17px;padding:12px 18px;' +
                'margin:5px;border:0;border-radius:8px;">Копировать код</button>' +
              '<button id="rd-bridge-open" style="font-size:17px;padding:12px 18px;' +
                'margin:5px;border:0;border-radius:8px;">Открыть Real-Debrid</button>' +
              '<div style="font-size:15px;opacity:.9;margin:18px 0 8px;">' +
                '2. Подтверди устройство на сайте</div>' +
              '<div id="rd-bridge-status" style="font-size:16px;padding:12px;">' +
                escapeHtml(status || 'Ожидаем подтверждения…') + '</div>' +
              '<button id="rd-bridge-close" style="font-size:16px;padding:10px 18px;' +
                'margin-top:12px;border:0;border-radius:8px;">Закрыть</button>' +
              '<div style="font-size:12px;opacity:.65;margin-top:14px;">' +
                'Вводи пароль только на официальном сайте Real-Debrid.</div>' +
            '</div>';

        document.body.appendChild(screen);

        document.getElementById('rd-bridge-copy').onclick = function () {
            var code = device.user_code;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code).then(function () {
                    setStatus('Код скопирован. Введи его на сайте Real-Debrid.');
                }).catch(function () {
                    fallbackCopy(code);
                });
            } else {
                fallbackCopy(code);
            }
        };

        document.getElementById('rd-bridge-open').onclick = function () {
            openDevicePage(
                device.verification_url || 'https://real-debrid.com/device'
            );
        };

        document.getElementById('rd-bridge-close').onclick = function () {
            stopPolling();
            screen.remove();
        };
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function (c) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[c];
        });
    }

    function setStatus(text) {
        var node = document.getElementById('rd-bridge-status');
        if (node) node.textContent = text;
    }

    function fallbackCopy(text) {
        var input = document.createElement('textarea');
        input.value = text;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();

        try {
            document.execCommand('copy');
            setStatus(
                'Попытка копирования выполнена. Если не скопировалось, выдели код вручную.'
            );
        } catch (e) {
            setStatus('Выдели и скопируй код вручную.');
        }

        input.remove();
    }

    function beginAuth() {
        if (active) {
            notify('Авторизация уже запущена.');
            return;
        }

        active = true;

        var deviceUrl = OAUTH + 'device/code?client_id=' +
            encodeURIComponent(PUBLIC_CLIENT_ID) + '&new_credentials=yes';

        request(deviceUrl).then(function (device) {
            if (!device.device_code || !device.user_code) {
                throw new Error(
                    'В ответе RD нет device_code/user_code: ' +
                    JSON.stringify(device).slice(0, 180)
                );
            }

            showDeviceScreen(device, 'Ожидаем подтверждения…');

            var interval = Math.max(5, Number(device.interval) || 5) * 1000;
            var expires = (Number(device.expires_in) || 1800) * 1000;
            var started = Date.now();

            function poll() {
                if (!active) return;

                if (Date.now() - started >= expires) {
                    stopPolling();
                    setStatus(
                        'Срок действия кода истёк. Закрой экран и запусти подключение заново.'
                    );
                    return;
                }

                var credentialsUrl = OAUTH + 'device/credentials?client_id=' +
                    encodeURIComponent(PUBLIC_CLIENT_ID) + '&code=' +
                    encodeURIComponent(device.device_code);

                request(credentialsUrl).then(function (credentials) {
                    if (!credentials.client_id || !credentials.client_secret) {
                        throw new Error('RD не вернул реквизиты приложения.');
                    }

                    setStatus('Устройство подтверждено. Получаем токен…');

                    return postForm(OAUTH + 'token', {
                        client_id: credentials.client_id,
                        client_secret: credentials.client_secret,
                        code: device.device_code,
                        grant_type: 'http://oauth.net/grant_type/device/1.0'
                    }).then(function (tokens) {
                        return storeTokens(tokens, credentials);
                    });
                }).then(function (saved) {
                    stopPolling();
                    setStatus(
                        'Подключено: ' +
                        (saved.username || 'профиль подтверждён')
                    );
                    notify(
                        'Real-Debrid подключён: ' +
                        (saved.username || 'профиль подтверждён')
                    );
                }).catch(function (err) {
                    if (
                        err.status === 400 ||
                        err.status === 403 ||
                        err.status === 404
                    ) {
                        setStatus(
                            'Ожидаем подтверждения на сайте Real-Debrid…'
                        );
                        timer = setTimeout(poll, interval);
                    } else {
                        stopPolling();
                        setStatus('Ошибка: ' + err.message);
                    }
                });
            }

            timer = setTimeout(poll, interval);
        }).catch(function (err) {
            stopPolling();
            notify('Не удалось получить код Real-Debrid: ' + err.message);
        });
    }

    function checkAuth() {
        var stored = readTokens();

        if (!stored.access_token) {
            notify('Real-Debrid ещё не подключён.');
            return;
        }

        profile(stored.access_token).then(function (user) {
            notify(
                'Подключено: ' +
                (user.username || 'профиль подтверждён')
            );
        }).catch(function (err) {
            notify('Проверка профиля не прошла: ' + err.message);
        });
    }

    function disconnect() {
        localStorage.removeItem(STORE);
        notify('Локально сохранённые данные Real-Debrid удалены.');
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi ||
            window.__rd_bridge_loaded) return;

        window.__rd_bridge_loaded = true;

        Lampa.SettingsApi.addComponent({
            component: COMPONENT,
            name: 'Real-Debrid',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24">' +
                '<circle cx="12" cy="12" r="9" fill="none" ' +
                'stroke="currentColor" stroke-width="2"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_oauth_start_v2',
                type: 'button',
                values: ''
            },
            field: {
                name: 'Подключить Real-Debrid',
                description: 'Показать код и дождаться подтверждения'
            },
            onChange: beginAuth
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_oauth_check_v2',
                type: 'button',
                values: ''
            },
            field: {
                name: 'Проверить подключение',
                description: 'Проверка доступа к профилю RD'
            },
            onChange: checkAuth
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_oauth_disconnect_v2',
                type: 'button',
                values: ''
            },
            field: {
                name: 'Удалить локальные данные',
                description: 'Удаляет сохранённые в этом браузере токены'
            },
            onChange: disconnect
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
