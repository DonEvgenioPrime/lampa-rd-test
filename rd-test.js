function () {
    'use strict';

    var PLUGIN_NAME = 'Real-Debrid Bridge';
    var PLUGIN_VERSION = '1.3.0';
    var COMPONENT = 'rd_bridge';
    var PROXY_STORE = 'rd_bridge_worker_url_v1';
    var RD_API = 'https://api.real-debrid.com/rest/1.0/';
    var OAUTH = 'https://api.real-debrid.com/oauth/v2/';
    var PUBLIC_CLIENT_ID = 'X245A4XAIBGVM';
    var STORE = 'rd_bridge_oauth_v2';
    var PARSERS_STORE = 'rd_bridge_parsers_v1';

    var DEFAULT_PARSERS = [
        { name: 'MaxVol', url: 'jr.maxvol.pro', key: '', enabled: true },
        { name: 'JacRed', url: 'jac.red', key: '', enabled: true }
    ];

    var MAX_HASH_CHECKS = 10;
    var HASH_CHECK_DELAY = 1500;
    var SETTINGS_REGISTERED = false;
    var RD_INIT_TIMER = null;
    var RD_INIT_ATTEMPTS = 0;
    var RD_INIT_MAX_ATTEMPTS = 120;

    function notify(message) {
        if (window.Lampa && Lampa.Noty &&
            typeof Lampa.Noty.show === 'function') {
            Lampa.Noty.show(message);
        } else {
            window.alert(message);
        }
    }

    /* ---------------- PARSER MANAGER ---------------- */

    function getParsers() {
        try {
            var saved = localStorage.getItem(PARSERS_STORE);

            if (saved === null) {
                saveParsers(DEFAULT_PARSERS);
                return DEFAULT_PARSERS.slice();
            }

            var parsers = JSON.parse(saved);

            if (!Array.isArray(parsers)) return [];

            return parsers.filter(function (parser) {
                return parser && parser.name && parser.url;
            }).map(function (parser) {
                return {
                    name: String(parser.name).trim(),
                    url: String(parser.url).trim(),
                    key: String(parser.key || ''),
                    enabled: parser.enabled !== false
                };
            });
        } catch (e) {
            return [];
        }
    }

    function saveParsers(parsers) {
        localStorage.setItem(
            PARSERS_STORE,
            JSON.stringify(parsers)
        );
    }

    function normalizeParserUrl(value) {
        value = String(value || '').trim();

        if (!value) {
            throw new Error('Укажи адрес парсера.');
        }

        if (!/^https?:\/\//i.test(value)) {
            value = 'https://' + value;
        }

        var url;

        try {
            url = new URL(value);
        } catch (e) {
            throw new Error('Некорректный адрес парсера.');
        }

        if (
            (url.protocol !== 'https:' && url.protocol !== 'http:') ||
            !url.hostname ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            throw new Error('Укажи корректный базовый URL парсера.');
        }

        return url.href.replace(/\/+$/, '');
    }

    function parserEndpoint(parser, params) {
        var base = normalizeParserUrl(parser.url);
        var url = new URL(base);

        var path = url.pathname.replace(/\/+$/, '');

        if (!/\/api\/v2\.0\/indexers\/all\/results$/i.test(path)) {
            path += '/api/v2.0/indexers/all/results';
        }

        url.pathname = path;
        url.search = params.toString();

        return url.href;
    }

    function parserManager() {
        function menu() {
            var parsers = getParsers();

            var text = 'УПРАВЛЕНИЕ ПАРСЕРАМИ\n\n';

            if (!parsers.length) {
                text += 'Список пуст.\n\n';
            } else {
                parsers.forEach(function (parser, index) {
                    text += (index + 1) + '. ' + parser.name +
                        ' — ' + (parser.enabled ? 'ВКЛ' : 'ВЫКЛ') +
                        '\n' + parser.url + '\n\n';
                });
            }

            text +=
                'Введите номер парсера для редактирования.\n' +
                '0 — добавить парсер\n' +
                '-1 — выйти';

            var choice = window.prompt(text, '-1');

            if (choice === null || choice.trim() === '-1') return;

            if (choice.trim() === '0') {
                addParser();
                return;
            }

            var index = Number(choice) - 1;

            if (
                !isFinite(index) ||
                index < 0 ||
                index >= parsers.length
            ) {
                notify('Неверный номер.');
                return;
            }

            editParser(index);
        }

        function addParser() {
            var name = window.prompt('Название парсера:');

            if (name === null) return;

            name = name.trim();

            if (!name) {
                notify('Название не может быть пустым.');
                return;
            }

            var url = window.prompt('Адрес парсера:', 'https://');

            if (url === null) return;

            try {
                url = normalizeParserUrl(url);
            } catch (e) {
                notify(e.message);
                return;
            }

            var key = window.prompt(
                'API-ключ (если не требуется — оставь пустым):',
                ''
            );

            if (key === null) return;

            var parsers = getParsers();

            parsers.push({
                name: name,
                url: url,
                key: key.trim(),
                enabled: true
            });

            saveParsers(parsers);
            notify('Парсер «' + name + '» добавлен.');
        }

        function editParser(index) {
            var parsers = getParsers();
            var parser = parsers[index];

            if (!parser) return;

            var action = window.prompt(
                'Парсер: ' + parser.name + '\n\n' +
                '1 — изменить название\n' +
                '2 — изменить URL\n' +
                '3 — изменить API-ключ\n' +
                '4 — включить / отключить\n' +
                '5 — проверить подключение\n' +
                '6 — удалить\n' +
                '0 — назад',
                '0'
            );

            if (action === null || action === '0') return;

            if (action === '1') {
                var name = window.prompt(
                    'Новое название:',
                    parser.name
                );

                if (name === null) return;

                if (!name.trim()) {
                    notify('Название не может быть пустым.');
                    return;
                }

                parser.name = name.trim();
                saveParsers(parsers);
                notify('Название изменено.');
            } else if (action === '2') {
                var url = window.prompt(
                    'Новый URL:',
                    parser.url
                );

                if (url === null) return;

                try {
                    parser.url = normalizeParserUrl(url);
                    saveParsers(parsers);
                    notify('URL изменён.');
                } catch (e) {
                    notify(e.message);
                }
            } else if (action === '3') {
                var key = window.prompt(
                    'Новый API-ключ:',
                    parser.key
                );

                if (key === null) return;

                parser.key = key.trim();
                saveParsers(parsers);
                notify('API-ключ сохранён.');
            } else if (action === '4') {
                parser.enabled = !parser.enabled;
                saveParsers(parsers);

                notify(
                    parser.name + ': ' +
                    (parser.enabled ? 'включён' : 'отключён')
                );
            } else if (action === '5') {
                testParser(parser);
            } else if (action === '6') {
                if (window.confirm(
                    'Удалить парсер «' + parser.name + '»?'
                )) {
                    parsers.splice(index, 1);
                    saveParsers(parsers);
                    notify('Парсер удалён.');
                }
            }
        }

        function testParser(parser) {
            if (!checkProxyConfigured()) return;

            notify('Проверяю парсер «' + parser.name + '»…');

            var params = new URLSearchParams();
            params.set('Query', 'test');
            params.set('Category', '2000,5000');

            if (parser.key) {
                params.set('apikey', parser.key);
            }

            var url;

            try {
                url = parserEndpoint(parser, params);
            } catch (e) {
                notify(e.message);
                return;
            }

            request(proxyUrl(url)).then(function (data) {
                var list = Array.isArray(data)
                    ? data
                    : (data.Results || data.results);

                if (!Array.isArray(list)) {
                    throw new Error('Неожиданный формат ответа API.');
                }

                notify(
                    'Парсер «' + parser.name +
                    '» отвечает.\nРезультатов тестового запроса: ' +
                    list.length
                );
            }).catch(function (error) {
                notify(
                    'Ошибка парсера «' + parser.name + '»:\n' +
                    error.message
                );
            });
        }

        menu();
    }

    /* ---------------- WORKER ---------------- */

    function getProxyUrl() {
        try {
            var value = (localStorage.getItem(PROXY_STORE) || '').trim();
            if (!value) return '';

            var url = new URL(value);

            if (
                url.protocol !== 'https:' ||
                !url.hostname ||
                url.username ||
                url.password ||
                url.search ||
                url.hash
            ) {
                return '';
            }

            return url.href.replace(/\/+$/, '') + '/';
        } catch (e) {
            return '';
        }
    }

    function requireProxy() {
        var proxy = getProxyUrl();

        if (!proxy) {
            throw new Error(
                'URL Cloudflare Worker не настроен или некорректен. ' +
                'Открой настройки Lampa → Real-Debrid → ' +
                'Настроить Cloudflare Worker URL.'
            );
        }

        return proxy;
    }

    function proxyUrl(url) {
        return requireProxy() + '?url=' + encodeURIComponent(url);
    }

    function saveProxyUrl(value) {
        value = String(value || '').trim();

        if (!value) {
            throw new Error('URL Worker не может быть пустым.');
        }

        var url;

        try {
            url = new URL(value);
        } catch (e) {
            throw new Error('Некорректный URL Worker.');
        }

        if (
            url.protocol !== 'https:' ||
            !url.hostname ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            throw new Error(
                'Укажи базовый HTTPS URL Worker без логина, ' +
                'пароля, параметров запроса и фрагмента.'
            );
        }

        localStorage.setItem(
            PROXY_STORE,
            url.href.replace(/\/+$/, '') + '/'
        );
    }

    function checkProxyConfigured() {
        if (getProxyUrl()) return true;

        notify(
            'Сначала настрой URL Cloudflare Worker в разделе Real-Debrid.'
        );

        return false;
    }

    function askProxyUrl() {
        var current = getProxyUrl();

        var value = window.prompt(
            'URL Cloudflare Worker (HTTPS).\n' +
            'Для удаления адреса очисти поле и нажми ОК.',
            current
        );

        if (value === null) return;

        if (!value.trim()) {
            try {
                localStorage.removeItem(PROXY_STORE);
                notify(
                    'URL Worker удалён. Для дальнейшей работы ' +
                    'плагинов потребуется настроить его заново.'
                );
            } catch (e) {
                notify('Не удалось удалить URL Worker: ' + e.message);
            }

            return;
        }

        try {
            saveProxyUrl(value);
            notify('URL Cloudflare Worker сохранён для обоих плагинов.');
        } catch (e) {
            notify('Ошибка настройки Worker: ' + e.message);
        }
    }

    /* ---------------- HTTP ---------------- */

    function request(url, options) {
        return fetch(url, options || {}).then(function (response) {
            return response.text().then(function (text) {
                var data;

                try {
                    data = text ? JSON.parse(text) : {};
                } catch (e) {
                    data = { message: text };
                }

                if (!response.ok) {
                    throw new Error(
                        'HTTP ' + response.status + ': ' +
                        (
                            data.error_description ||
                            data.error ||
                            data.message ||
                            response.statusText ||
                            'Неизвестная ошибка'
                        )
                    );
                }

                return data;
            });
        });
    }

    function postForm(url, values) {
        var body = new URLSearchParams();

        Object.keys(values).forEach(function (key) {
            if (
                values[key] !== undefined &&
                values[key] !== null &&
                values[key] !== ''
            ) {
                body.set(key, String(values[key]));
            }
        });

        return request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        });
    }

    /* ---------------- AUTH ---------------- */

    function readAuth() {
        try {
            return JSON.parse(localStorage.getItem(STORE) || 'null');
        } catch (e) {
            return null;
        }
    }

    function saveAuth(auth) {
        localStorage.setItem(STORE, JSON.stringify(auth));
    }

    function clearAuth() {
        localStorage.removeItem(STORE);
    }

    function profile(token) {
        return request(proxyUrl(RD_API + 'user'), {
            headers: {
                Authorization: 'Bearer ' + token
            }
        });
    }

    function refreshAccessToken(auth) {
        if (
            !auth ||
            !auth.refresh_token ||
            !auth.client_id ||
            !auth.client_secret
        ) {
            return Promise.reject(new Error(
                'Нет данных для обновления токена. Подключи RD заново.'
            ));
        }

        return postForm(proxyUrl(OAUTH + 'token'), {
            client_id: auth.client_id,
            client_secret: auth.client_secret,
            code: auth.refresh_token,
            grant_type: 'http://oauth.net/grant_type/device/1.0'
        }).then(function (tokens) {
            if (!tokens.access_token) {
                throw new Error('RD не вернул новый access_token.');
            }

            var updated = Object.assign({}, auth, {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || auth.refresh_token,
                expires_in: Number(tokens.expires_in) || 0,
                obtained_at: Date.now()
            });

            saveAuth(updated);
            return updated;
        });
    }

    function getWorkingAuth() {
        var auth = readAuth();

        if (!auth || !auth.access_token) {
            return Promise.reject(new Error(
                'Real-Debrid не подключён. Используй «Подключить RD».'
            ));
        }

        return profile(auth.access_token).then(function (user) {
            return { auth: auth, user: user };
        }).catch(function (error) {
            if (!/HTTP 401|bad_token|unauthorized/i.test(error.message)) {
                throw error;
            }

            return refreshAccessToken(auth).then(function (updated) {
                return profile(updated.access_token).then(function (user) {
                    return { auth: updated, user: user };
                });
            });
        });
    }

    function showDeviceAuth(url, code) {
        var previous = document.getElementById('rd-device-auth');
        if (previous) previous.remove();

        var overlay = document.createElement('div');
        overlay.id = 'rd-device-auth';
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:100000;' +
            'display:flex;align-items:center;justify-content:center;' +
            'padding:24px;background:rgba(0,0,0,.88);color:#fff;' +
            'font-family:Arial,sans-serif;box-sizing:border-box;';

        var panel = document.createElement('div');
        panel.style.cssText =
            'width:100%;max-width:620px;text-align:center;';

        var title = document.createElement('div');
        title.textContent = 'Подключение Real-Debrid';
        title.style.cssText =
            'font-size:clamp(24px,5vw,38px);font-weight:bold;margin-bottom:28px;';

        var instruction = document.createElement('div');
        instruction.textContent =
            '1. Открой официальный сайт и введи этот код';
        instruction.style.cssText =
            'font-size:clamp(17px,3vw,25px);margin-bottom:16px;';

        var codeBox = document.createElement('div');
        codeBox.textContent = code || 'Код недоступен';
        codeBox.style.cssText =
            'padding:20px 12px;margin:0 0 22px;border-radius:16px;' +
            'background:#252525;color:#fff;font-size:clamp(30px,7vw,48px);' +
            'font-weight:bold;letter-spacing:3px;user-select:text;';

        var buttonStyle =
            'display:block;margin:12px auto;padding:16px 24px;' +
            'border:0;border-radius:14px;background:#eee;color:#0784ff;' +
            'font-size:clamp(18px,3.5vw,27px);cursor:pointer;';

        var status = document.createElement('div');
        status.textContent =
            'Ожидаем подтверждения на сайте Real-Debrid…';
        status.style.cssText =
            'font-size:clamp(17px,3vw,25px);margin:20px 0 40px;overflow-wrap:anywhere;';

        var copy = document.createElement('button');
        copy.textContent = 'Копировать код';
        copy.style.cssText = buttonStyle;

        function fallbackCopy(value) {
            var input = document.createElement('textarea');
            input.value = value;
            input.style.cssText = 'position:fixed;opacity:0;';
            document.body.appendChild(input);
            input.focus();
            input.select();
            input.setSelectionRange(0, input.value.length);

            try {
                status.textContent = document.execCommand('copy')
                    ? 'Попытка копирования выполнена. Если не скопировалось, выдели код вручную.'
                    : 'Выдели и скопируй код вручную.';
            } catch (e) {
                status.textContent = 'Выдели и скопируй код вручную.';
            }

            input.remove();
        }

        copy.onclick = function () {
            var value = String(code || '');

            if (!value) {
                status.textContent = 'Код не найден.';
                return;
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).then(function () {
                    status.textContent =
                        'Код скопирован. Введи его на сайте Real-Debrid.';
                }).catch(function () {
                    fallbackCopy(value);
                });
            } else {
                fallbackCopy(value);
            }
        };

        var open = document.createElement('button');
        open.textContent = 'Открыть Real-Debrid';
        open.style.cssText = buttonStyle;
        open.onclick = function () {
            var target = url || 'https://real-debrid.com/device';
            var win = window.open(target, '_blank');
            if (!win) window.location.href = target;
        };

        var instruction2 = document.createElement('div');
        instruction2.textContent =
            '2. Подтверди устройство на сайте';
        instruction2.style.cssText =
            'font-size:clamp(17px,3vw,25px);margin:36px 0 22px;';

        var close = document.createElement('button');
        close.textContent = 'Закрыть';
        close.style.cssText = buttonStyle;
        close.onclick = function () {
            overlay.remove();
        };

        var note = document.createElement('div');
        note.textContent =
            'Вводи пароль только на официальном сайте Real-Debrid.';
        note.style.cssText =
            'font-size:16px;color:#aaa;margin-top:26px;';

        [
            title, instruction, codeBox, copy, open,
            instruction2, status, close, note
        ].forEach(function (element) {
            panel.appendChild(element);
        });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        return {
            setStatus: function (message) {
                status.textContent = message;
            },
            close: function () {
                overlay.remove();
            }
        };
    }

    function connectAuth() {
        var deviceParams = new URLSearchParams();
        deviceParams.set('client_id', PUBLIC_CLIENT_ID);
        deviceParams.set('new_credentials', 'yes');

        return request(
            proxyUrl(OAUTH + 'device/code?' + deviceParams.toString()),
            { method: 'GET' }
        ).then(function (device) {
            if (!device.device_code) {
                throw new Error('RD не вернул device_code.');
            }

            var url = device.verification_url ||
                'https://real-debrid.com/device';

            var authWindow = showDeviceAuth(url, device.user_code || '');
            var interval = Math.max(5, Number(device.interval) || 5) * 1000;
            var timeout = (Number(device.expires_in) || 1800) * 1000;
            var started = Date.now();

            function pollCredentials() {
                if (Date.now() - started > timeout) {
                    return Promise.reject(new Error(
                        'Время авторизации истекло. Попробуй снова.'
                    ));
                }

                var params = new URLSearchParams();
                params.set('client_id', PUBLIC_CLIENT_ID);
                params.set('code', device.device_code);

                return request(
                    proxyUrl(OAUTH + 'device/credentials?' + params.toString()),
                    { method: 'GET' }
                ).catch(function (error) {
                    if (
                        /HTTP 400|authorization_pending|slow_down|HTTP 403|HTTP 404/i
                            .test(error.message)
                    ) {
                        return delay(interval).then(pollCredentials);
                    }

                    throw error;
                });
            }

            return pollCredentials().then(function (credentials) {
                if (!credentials.client_id || !credentials.client_secret) {
                    throw new Error('RD не вернул client_id/client_secret.');
                }

                return postForm(proxyUrl(OAUTH + 'token'), {
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret,
                    code: device.device_code,
                    grant_type: 'http://oauth.net/grant_type/device/1.0'
                }).then(function (tokens) {
                    if (!tokens.access_token) {
                        throw new Error('RD не вернул access_token.');
                    }

                    var auth = {
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token || '',
                        expires_in: Number(tokens.expires_in) || 0,
                        obtained_at: Date.now(),
                        client_id: credentials.client_id,
                        client_secret: credentials.client_secret
                    };

                    saveAuth(auth);
                    authWindow.setStatus(
                        'Устройство подтверждено! Real-Debrid подключён.'
                    );

                    return profile(auth.access_token).then(function (user) {
                        notify(
                            'RD подключён: ' +
                            (user.username || user.email || user.id || 'OK')
                        );

                        return { auth: auth, user: user };
                    });
                });
            });
        });
    }

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    /* ---------------- HASH / PARSERS SEARCH ---------------- */

    function normalizeHash(value) {
        return String(value || '').trim().toLowerCase();
    }

    function getField(item, names) {
        if (!item || typeof item !== 'object') return '';

        var keys = Object.keys(item);

        for (var i = 0; i < names.length; i++) {
            var wanted = names[i].toLowerCase();

            for (var j = 0; j < keys.length; j++) {
                if (keys[j].toLowerCase() === wanted) {
                    var value = item[keys[j]];

                    if (
                        value !== undefined &&
                        value !== null &&
                        typeof value !== 'object'
                    ) {
                        var text = String(value).trim();
                        if (text) return text;
                    }
                }
            }
        }

        return '';
    }

    function extractHash(item) {
        if (!item) return '';

        var hashFields = [
            'hash', 'info_hash', 'infoHash', 'InfoHash',
            'torrent_hash', 'torrentHash', 'btih', 'infohash'
        ];

        var direct = getField(item, hashFields);

        var values = [
            direct,
            getField(item, [
                'magnet', 'magnetUri', 'magnet_uri', 'MagnetUri',
                'link', 'Link', 'download', 'Download'
            ])
        ];

        for (var i = 0; i < values.length; i++) {
            var value = String(values[i] || '');

            var magnet = value.match(/btih:([a-f0-9]{40})/i);
            if (magnet) return magnet[1].toLowerCase();

            var hash = value.match(/\b[a-f0-9]{40}\b/i);
            if (hash) return hash[0].toLowerCase();

            var base32 = value.match(/btih:([a-z2-7]{32})/i);

            if (base32) {
                var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
                var bits = '';
                var encoded = base32[1].toUpperCase();

                for (var b = 0; b < encoded.length; b++) {
                    var digit = alphabet.indexOf(encoded.charAt(b));

                    if (digit < 0) {
                        bits = '';
                        break;
                    }

                    bits += digit.toString(2).padStart(5, '0');
                }

                if (bits.length >= 160) {
                    var hex = '';

                    for (var h = 0; h < 160; h += 4) {
                        hex += parseInt(bits.slice(h, h + 4), 2)
                            .toString(16);
                    }

                    if (/^[a-f0-9]{40}$/.test(hex)) {
                        return hex.toLowerCase();
                    }
                }
            }
        }

        return '';
    }

    function extractTitle(item) {
        return getField(item, [
            'title', 'name', 'release', 'original_title',
            'originalTitle', 'Title', 'Name'
        ]) || 'Без названия';
    }

    function parserSearch(parser, query, originalTitle, year) {
        var title = String(query || '').trim();
        var original = String(originalTitle || '').trim();
        var searchYear = String(year || '').trim().slice(0, 4);
        var isJacRed = /(^|\.)jac\.red$/i.test(parser.url);

        var params = new URLSearchParams();

        params.set('Query', (title + ' ' + searchYear).trim());
        params.set('title', title);
        params.set('title_original', original);

        if (isJacRed) {
            params.set('apikey', '');
        } else {
            params.set('Category', '2000,5000');

            if (parser.key) {
                params.set('apikey', parser.key);
            }
        }

        if (searchYear) {
            params.set('year', searchYear);
        }

        var url = parserEndpoint(parser, params);

        return request(proxyUrl(url)).then(function (data) {
            if (data && Array.isArray(data.Results)) return data.Results;
            if (data && Array.isArray(data.results)) return data.results;
            if (Array.isArray(data)) return data;

            throw new Error(
                'Неожиданный формат ответа API: ' +
                JSON.stringify(data).slice(0, 250)
            );
        });
    }

    function searchParsers(query, originalTitle, year) {
        var results = [];
        var stats = [];

        var parsers = getParsers().filter(function (parser) {
            return parser.enabled !== false;
        });

        if (!parsers.length) {
            return Promise.resolve({
                items: [],
                stats: [],
                errors: [
                    'Нет включённых парсеров. Открой «Настроить парсеры».'
                ]
            });
        }

        return Promise.all(parsers.map(function (parser) {
            return parserSearch(parser, query, originalTitle, year)
                .then(function (items) {
                    items.forEach(function (item) {
                        item._parser = parser.name;
                        results.push(item);
                    });

                    stats.push({
                        name: parser.name,
                        count: items.length,
                        error: ''
                    });
                })
                .catch(function (error) {
                    stats.push({
                        name: parser.name,
                        count: 0,
                        error: error && error.message
                            ? error.message
                            : String(error)
                    });
                });
        })).then(function () {
            stats.sort(function (a, b) {
                var ai = parsers.findIndex(function (p) {
                    return p.name === a.name;
                });

                var bi = parsers.findIndex(function (p) {
                    return p.name === b.name;
                });

                return ai - bi;
            });

            return {
                items: results,
                stats: stats,
                errors: stats.filter(function (s) {
                    return !!s.error;
                }).map(function (s) {
                    return s.name + ': ' + s.error;
                })
            };
        });
    }

    /* ---------------- REAL-DEBRID HASH CHECK ---------------- */

    function checkHash(hash, auth) {
        var url = RD_API + 'torrents/instantAvailability/' +
            encodeURIComponent(hash);

        return request(proxyUrl(url), {
            headers: {
                Authorization: 'Bearer ' + auth.access_token
            }
        }).then(function (data) {
            var item = data && (
                data[hash] ||
                data[String(hash).toLowerCase()] ||
                data[String(hash).toUpperCase()]
            );

            return {
                hash: hash,
                available: !!(
                    item && item.rd &&
                    Object.keys(item.rd).length
                )
            };
        }).catch(function (error) {
            return {
                hash: hash,
                available: false,
                error: error.message
            };
        });
    }

    function checkHashes(hashes, auth, onProgress) {
        var unique = [];
        var seen = {};

        hashes.forEach(function (hash) {
            hash = normalizeHash(hash);

            if (hash && !seen[hash]) {
                seen[hash] = true;
                unique.push(hash);
            }
        });

        unique = unique.slice(0, MAX_HASH_CHECKS);

        var results = [];
        var stopped = false;
        var stopReason = '';

        function next(index) {
            if (index >= unique.length || stopped) {
                return Promise.resolve({
                    results: results,
                    total: unique.length,
                    stopped: stopped,
                    stopReason: stopReason
                });
            }

            return checkHash(unique[index], auth).then(function (result) {
                results.push(result);

                if (onProgress) {
                    onProgress(index + 1, unique.length, result);
                }

                if (
                    result.error &&
                    /HTTP 401|bad_token|HTTP 403|disabled_endpoint|HTTP 429|too_many_requests/i
                        .test(result.error)
                ) {
                    stopped = true;
                    stopReason = result.error;
                }

                if (index + 1 < unique.length && !stopped) {
                    return delay(HASH_CHECK_DELAY).then(function () {
                        return next(index + 1);
                    });
                }

                return {
                    results: results,
                    total: unique.length,
                    stopped: stopped,
                    stopReason: stopReason
                };
            });
        }

        return next(0);
    }

    /* ---------------- PANEL ---------------- */

    function addStyles() {
        if (document.getElementById('rd-bridge-style')) return;

        var style = document.createElement('style');
        style.id = 'rd-bridge-style';

        style.textContent =
            '.rd-bridge-panel{padding:16px;color:inherit}' +
            '.rd-bridge-row{padding:12px;margin:8px 0;border-radius:8px;background:rgba(127,127,127,.12)}' +
            '.rd-bridge-title{font-weight:600;margin-bottom:6px}' +
            '.rd-bridge-meta{font-size:12px;opacity:.8;overflow-wrap:anywhere}' +
            '.rd-bridge-button{display:inline-block;padding:10px 14px;margin:4px;border-radius:6px;background:#7a5cff;color:#fff;cursor:pointer;border:0}' +
            '.rd-bridge-status{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}' +
            '.rd-bridge-input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;color:inherit;background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.35);border-radius:6px}';

        document.head.appendChild(style);
    }

    function createPanel() {
        addStyles();

        var panel = document.createElement('div');
        panel.className = 'rd-bridge-panel';

        panel.innerHTML =
            '<div class="rd-bridge-title">Real-Debrid — кэш</div>' +
            '<div class="rd-bridge-status" id="rd-status">Версия ' +
            PLUGIN_VERSION + '</div>' +
            '<button class="rd-bridge-button" id="rd-worker">Настроить Worker URL</button>' +
            '<button class="rd-bridge-button" id="rd-connect">Подключить RD</button>' +
            '<button class="rd-bridge-button" id="rd-check">Проверить подключение</button>' +
            '<button class="rd-bridge-button" id="rd-disconnect">Отключить RD</button>' +
            '<hr>' +
            '<input class="rd-bridge-input" id="rd-query" placeholder="Название фильма или сериала">' +
            '<button class="rd-bridge-button" id="rd-search">Найти раздачи</button>' +
            '<div id="rd-results"></div>';

        var status = panel.querySelector('#rd-status');
        var results = panel.querySelector('#rd-results');

        function setStatus(text) {
            status.textContent = text;
        }

        panel.querySelector('#rd-worker').onclick = function () {
            askProxyUrl();
            setStatus(getProxyUrl()
                ? 'Worker URL настроен.'
                : 'Worker URL не настроен.');
        };

        panel.querySelector('#rd-connect').onclick = function () {
            if (!checkProxyConfigured()) return;

            setStatus('Ожидаю авторизацию RD…');

            connectAuth().then(function (result) {
                setStatus(
                    'Подключено: ' +
                    (result.user.username || result.user.email || 'OK')
                );
            }).catch(function (error) {
                setStatus('Ошибка подключения: ' + error.message);
            });
        };

        panel.querySelector('#rd-check').onclick = function () {
            if (!checkProxyConfigured()) return;

            setStatus('Проверяю RD…');

            getWorkingAuth().then(function (result) {
                setStatus(
                    'RD работает: ' +
                    (result.user.username || result.user.email || 'OK')
                );
            }).catch(function (error) {
                setStatus('Проверка не пройдена: ' + error.message);
            });
        };

        panel.querySelector('#rd-disconnect').onclick = function () {
            clearAuth();
            setStatus('Локальная авторизация удалена. Подключи RD заново.');
        };

        panel.querySelector('#rd-search').onclick = function () {
            if (!checkProxyConfigured()) return;

            var query = panel.querySelector('#rd-query').value.trim();

            if (!query) {
                notify('Введи название фильма или сериала.');
                return;
            }

            results.innerHTML = '';
            setStatus('Проверяю авторизацию…');

            getWorkingAuth().then(function (authResult) {
                setStatus('Ищу релизы…');

                return searchParsers(query, query, '').then(function (search) {
                    var items = search.items;

                    var parserStatus = search.stats.map(function (stat) {
                        return stat.name + ': ' +
                            (stat.error
                                ? 'ОШИБКА — ' + stat.error
                                : stat.count + ' релизов');
                    }).join('\n');

                    if (!items.length) {
                        setStatus(
                            'Релизы не найдены.\n\n' +
                            'Диагностика парсеров:\n' + parserStatus +
                            (search.errors.length
                                ? '\n\n' + search.errors.join('\n')
                                : '')
                        );
                        return;
                    }

                    var hashes = [];
                    var itemHashes = [];

                    items.forEach(function (item) {
                        var hash = extractHash(item);
                        itemHashes.push(hash);
                        if (hash) hashes.push(hash);
                    });

                    setStatus(
                        'Найдено: ' + items.length +
                        '. Проверяю до ' + MAX_HASH_CHECKS +
                        ' уникальных hash в RD…\n\n' +
                        'Диагностика парсеров:\n' + parserStatus
                    );

                    return checkHashes(
                        hashes,
                        authResult.auth,
                        function (done, total) {
                            setStatus(
                                'Проверка RD: ' + done + ' из ' + total +
                                '\n\nДиагностика парсеров:\n' + parserStatus
                            );
                        }
                    ).then(function (checked) {
                        var byHash = {};

                        checked.results.forEach(function (item) {
                            byHash[item.hash] = item;
                        });

                        items.forEach(function (item, index) {
                            var hash = itemHashes[index];
                            var check = hash ? byHash[hash] : null;
                            var row = document.createElement('div');
                            row.className = 'rd-bridge-row';

                            var title = document.createElement('div');
                            title.className = 'rd-bridge-title';
                            title.textContent = extractTitle(item);
                            row.appendChild(title);

                            var meta = document.createElement('div');
                            meta.className = 'rd-bridge-meta';

                            var resultText;

                            if (!hash) {
                                resultText = 'Hash не найден';
                            } else if (!check) {
                                resultText = 'Не проверено';
                            } else if (check.error) {
                                resultText = 'Ошибка RD: ' + check.error;
                            } else {
                                resultText = check.available
                                    ? 'Есть в кэше RD'
                                    : 'В кэше не найдено';
                            }

                            meta.textContent =
                                (item._parser || 'Парсер') +
                                ' · ' + resultText;

                            row.appendChild(meta);

                            if (hash) {
                                var hashLine = document.createElement('div');
                                hashLine.className = 'rd-bridge-meta';
                                hashLine.textContent = 'Hash: ' + hash;
                                row.appendChild(hashLine);
                            }

                            results.appendChild(row);
                        });

                        var summary =
                            'Найдено: ' + items.length +
                            ' · Проверено RD: ' + checked.results.length +
                            ' · Кэш: ' +
                            checked.results.filter(function (r) {
                                return r.available;
                            }).length +
                            '\n\nДиагностика парсеров:\n' + parserStatus;

                        if (checked.stopReason) {
                            summary += '\nПроверка остановлена: ' +
                                checked.stopReason;
                        }

                        if (search.errors.length) {
                            summary += '\n\nОшибки парсеров:\n' +
                                search.errors.join('\n');
                        }

                        setStatus(summary);
                    });
                });
            }).catch(function (error) {
                setStatus('Ошибка поиска: ' + error.message);
            });
        };

        return panel;
    }

    function openPanel() {
        var old = document.getElementById('rd-bridge-root');
        if (old) old.remove();

        var root = document.createElement('div');
        root.id = 'rd-bridge-root';
        root.style.cssText =
            'position:fixed;z-index:99999;inset:5% 5%;overflow:auto;' +
            'background:#171717;color:#fff;border-radius:12px;' +
            'box-shadow:0 0 0 100vmax rgba(0,0,0,.65)';

        var close = document.createElement('button');
        close.className = 'rd-bridge-button';
        close.textContent = 'Закрыть';
        close.onclick = function () {
            root.remove();
        };

        root.appendChild(close);
        root.appendChild(createPanel());
        document.body.appendChild(root);
    }

    /* ---------------- SETTINGS ---------------- */

    function addSettings() {
        if (
            !window.Lampa ||
            !Lampa.SettingsApi ||
            typeof Lampa.SettingsApi.addComponent !== 'function' ||
            typeof Lampa.SettingsApi.addParam !== 'function' ||
            SETTINGS_REGISTERED
        ) {
            return;
        }

        try {
            Lampa.SettingsApi.addComponent({
                component: COMPONENT,
                name: 'Real-Debrid',
                icon: '<svg width="24" height="24" viewBox="0 0 24 24">' +
                    '<circle cx="12" cy="12" r="9" fill="none" ' +
                    'stroke="currentColor" stroke-width="2"/>' +
                    '</svg>'
            });

            function addButton(name, title, description, callback) {
                Lampa.SettingsApi.addParam({
                    component: COMPONENT,
                    param: {
                        name: name,
                        type: 'button',
                        values: ''
                    },
                    field: {
                        name: title,
                        description: description
                    },
                    onChange: callback
                });
            }

            addButton(
                'rd_worker_url_v1',
                'Настроить Cloudflare Worker URL',
                'Общий адрес Worker для rd-test.js и rd-card-button.js. ' +
                'Пустое поле удаляет адрес.',
                function () {
                    askProxyUrl();
                }
            );

            addButton(
                'rd_manage_parsers_v1',
                'Настроить парсеры',
                'Добавить, редактировать, включать, отключать, проверять и удалять парсеры.',
                function () {
                    parserManager();
                }
            );

            addButton(
                'rd_oauth_start_v2',
                'Подключить Real-Debrid',
                'Авторизация через официальный сайт Real-Debrid',
                function () {
                    if (!checkProxyConfigured()) return;

                    connectAuth().catch(function (error) {
                        notify('Ошибка подключения RD: ' + error.message);
                    });
                }
            );

            addButton(
                'rd_oauth_check_v2',
                'Проверить подключение',
                'Проверить профиль и обновить токен при необходимости',
                function () {
                    if (!checkProxyConfigured()) return;

                    getWorkingAuth().then(function (result) {
                        var user = result.user || {};

                        notify(
                            'RD работает: ' +
                            (user.username || user.email || user.id || 'OK')
                        );
                    }).catch(function (error) {
                        notify(
                            'Проверка RD не пройдена: ' + error.message
                        );
                    });
                }
            );

            addButton(
                'rd_oauth_disconnect_v2',
                'Удалить локальные данные',
                'Удалить сохранённую авторизацию RD в этом браузере',
                function () {
                    clearAuth();
                    notify('Локальные данные RD удалены.');
                }
            );

            addButton(
                'rd_search_cached_v1',
                'Поиск закэшированных раздач',
                'Поиск по включённым парсерам с проверкой кэша RD.',
                function () {
                    openPanel();
                }
            );

            SETTINGS_REGISTERED = true;

            console.log(
                '[' + PLUGIN_NAME + '] Настройки зарегистрированы',
                PLUGIN_VERSION
            );
        } catch (error) {
            SETTINGS_REGISTERED = false;

            console.error(
                '[' + PLUGIN_NAME + '] Ошибка регистрации настроек:',
                error
            );
        }
    }

    function stopInitRetry() {
        if (RD_INIT_TIMER) {
            clearTimeout(RD_INIT_TIMER);
            RD_INIT_TIMER = null;
        }
    }

    function scheduleInitRetry() {
        if (RD_INIT_TIMER) return;

        if (RD_INIT_ATTEMPTS >= RD_INIT_MAX_ATTEMPTS) {
            console.error(
                '[' + PLUGIN_NAME +
                '] Не удалось зарегистрировать настройки. ' +
                'Проверь доступность Lampa.SettingsApi.'
            );

            return;
        }

        RD_INIT_TIMER = setTimeout(function () {
            RD_INIT_TIMER = null;
            init();
        }, 500);
    }

    function init() {
        RD_INIT_ATTEMPTS++;

        if (!window.Lampa) {
            scheduleInitRetry();
            return;
        }

        window.rdBridgeOpen = openPanel;

        if (
            Lampa.SettingsApi &&
            typeof Lampa.SettingsApi.addComponent === 'function' &&
            typeof Lampa.SettingsApi.addParam === 'function'
        ) {
            addSettings();

            if (SETTINGS_REGISTERED) {
                stopInitRetry();

                console.log(
                    '[' + PLUGIN_NAME + '] Инициализация завершена',
                    PLUGIN_VERSION
                );

                return;
            }
        }

        scheduleInitRetry();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();