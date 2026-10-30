(function () {
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
            throw new Error('Ð£ÐºÐ°Ð¶Ð¸ Ð°Ð´ÑÐµÑ Ð¿Ð°ÑÑÐµÑÐ°.');
        }

        if (!/^https?:\/\//i.test(value)) {
            value = 'https://' + value;
        }

        var url;

        try {
            url = new URL(value);
        } catch (e) {
            throw new Error('ÐÐµÐºÐ¾ÑÑÐµÐºÑÐ½ÑÐ¹ Ð°Ð´ÑÐµÑ Ð¿Ð°ÑÑÐµÑÐ°.');
        }

        if (
            (url.protocol !== 'https:' && url.protocol !== 'http:') ||
            !url.hostname ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        ) {
            throw new Error('Ð£ÐºÐ°Ð¶Ð¸ ÐºÐ¾ÑÑÐµÐºÑÐ½ÑÐ¹ Ð±Ð°Ð·Ð¾Ð²ÑÐ¹ URL Ð¿Ð°ÑÑÐµÑÐ°.');
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

            var text = 'Ð£ÐÐ ÐÐÐÐÐÐÐ ÐÐÐ Ð¡ÐÐ ÐÐÐ\n\n';

            if (!parsers.length) {
                text += 'Ð¡Ð¿Ð¸ÑÐ¾Ðº Ð¿ÑÑÑ.\n\n';
            } else {
                parsers.forEach(function (parser, index) {
                    text += (index + 1) + '. ' + parser.name +
                        ' â ' + (parser.enabled ? 'ÐÐÐ' : 'ÐÐ«ÐÐ') +
                        '\n' + parser.url + '\n\n';
                });
            }

            text +=
                'ÐÐ²ÐµÐ´Ð¸ÑÐµ Ð½Ð¾Ð¼ÐµÑ Ð¿Ð°ÑÑÐµÑÐ° Ð´Ð»Ñ ÑÐµÐ´Ð°ÐºÑÐ¸ÑÐ¾Ð²Ð°Ð½Ð¸Ñ.\n' +
                '0 â Ð´Ð¾Ð±Ð°Ð²Ð¸ÑÑ Ð¿Ð°ÑÑÐµÑ\n' +
                '-1 â Ð²ÑÐ¹ÑÐ¸';

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
                notify('ÐÐµÐ²ÐµÑÐ½ÑÐ¹ Ð½Ð¾Ð¼ÐµÑ.');
                return;
            }

            editParser(index);
        }

        function addParser() {
            var name = window.prompt('ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ Ð¿Ð°ÑÑÐµÑÐ°:');

            if (name === null) return;

            name = name.trim();

            if (!name) {
                notify('ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ Ð½Ðµ Ð¼Ð¾Ð¶ÐµÑ Ð±ÑÑÑ Ð¿ÑÑÑÑÐ¼.');
                return;
            }

            var url = window.prompt('ÐÐ´ÑÐµÑ Ð¿Ð°ÑÑÐµÑÐ°:', 'https://');

            if (url === null) return;

            try {
                url = normalizeParserUrl(url);
            } catch (e) {
                notify(e.message);
                return;
            }

            var key = window.prompt(
                'API-ÐºÐ»ÑÑ (ÐµÑÐ»Ð¸ Ð½Ðµ ÑÑÐµÐ±ÑÐµÑÑÑ â Ð¾ÑÑÐ°Ð²Ñ Ð¿ÑÑÑÑÐ¼):',
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
            notify('ÐÐ°ÑÑÐµÑ Â«' + name + 'Â» Ð´Ð¾Ð±Ð°Ð²Ð»ÐµÐ½.');
        }

        function editParser(index) {
            var parsers = getParsers();
            var parser = parsers[index];

            if (!parser) return;

            var action = window.prompt(
                'ÐÐ°ÑÑÐµÑ: ' + parser.name + '\n\n' +
                '1 â Ð¸Ð·Ð¼ÐµÐ½Ð¸ÑÑ Ð½Ð°Ð·Ð²Ð°Ð½Ð¸Ðµ\n' +
                '2 â Ð¸Ð·Ð¼ÐµÐ½Ð¸ÑÑ URL\n' +
                '3 â Ð¸Ð·Ð¼ÐµÐ½Ð¸ÑÑ API-ÐºÐ»ÑÑ\n' +
                '4 â Ð²ÐºÐ»ÑÑÐ¸ÑÑ / Ð¾ÑÐºÐ»ÑÑÐ¸ÑÑ\n' +
                '5 â Ð¿ÑÐ¾Ð²ÐµÑÐ¸ÑÑ Ð¿Ð¾Ð´ÐºÐ»ÑÑÐµÐ½Ð¸Ðµ\n' +
                '6 â ÑÐ´Ð°Ð»Ð¸ÑÑ\n' +
                '0 â Ð½Ð°Ð·Ð°Ð´',
                '0'
            );

            if (action === null || action === '0') return;

            if (action === '1') {
                var name = window.prompt(
                    'ÐÐ¾Ð²Ð¾Ðµ Ð½Ð°Ð·Ð²Ð°Ð½Ð¸Ðµ:',
                    parser.name
                );

                if (name === null) return;

                if (!name.trim()) {
                    notify('ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ Ð½Ðµ Ð¼Ð¾Ð¶ÐµÑ Ð±ÑÑÑ Ð¿ÑÑÑÑÐ¼.');
                    return;
                }

                parser.name = name.trim();
                saveParsers(parsers);
                notify('ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ Ð¸Ð·Ð¼ÐµÐ½ÐµÐ½Ð¾.');
            } else if (action === '2') {
                var url = window.prompt(
                    'ÐÐ¾Ð²ÑÐ¹ URL:',
                    parser.url
                );

                if (url === null) return;

                try {
                    parser.url = normalizeParserUrl(url);
                    saveParsers(parsers);
                    notify('URL Ð¸Ð·Ð¼ÐµÐ½ÑÐ½.');
                } catch (e) {
                    notify(e.message);
                }
            } else if (action === '3') {
                var key = window.prompt(
                    'ÐÐ¾Ð²ÑÐ¹ API-ÐºÐ»ÑÑ:',
                    parser.key
                );

                if (key === null) return;

                parser.key = key.trim();
                saveParsers(parsers);
                notify('API-ÐºÐ»ÑÑ ÑÐ¾ÑÑÐ°Ð½ÑÐ½.');
            } else if (action === '4') {
                parser.enabled = !parser.enabled;
                saveParsers(parsers);

                notify(
                    parser.name + ': ' +
                    (parser.enabled ? 'Ð²ÐºÐ»ÑÑÑÐ½' : 'Ð¾ÑÐºÐ»ÑÑÑÐ½')
                );
            } else if (action === '5') {
                testParser(parser);
            } else if (action === '6') {
                if (window.confirm(
                    'Ð£Ð´Ð°Ð»Ð¸ÑÑ Ð¿Ð°ÑÑÐµÑ Â«' + parser.name + 'Â»?'
                )) {
                    parsers.splice(index, 1);
                    saveParsers(parsers);
                    notify('ÐÐ°ÑÑÐµÑ ÑÐ´Ð°Ð»ÑÐ½.');
                }
            }
        }

        function testParser(parser) {
            if (!checkProxyConfigured()) return;

            notify('ÐÑÐ¾Ð²ÐµÑÑÑ Ð¿Ð°ÑÑÐµÑ Â«' + parser.name + 'Â»â¦');

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
                    throw new Error('ÐÐµÐ¾Ð¶Ð¸Ð´Ð°Ð½Ð½ÑÐ¹ ÑÐ¾ÑÐ¼Ð°Ñ Ð¾ÑÐ²ÐµÑÐ° API.');
                }

                notify(
                    'ÐÐ°ÑÑÐµÑ Â«' + parser.name +
                    'Â» Ð¾ÑÐ²ÐµÑÐ°ÐµÑ.\nÐ ÐµÐ·ÑÐ»ÑÑÐ°ÑÐ¾Ð² ÑÐµÑÑÐ¾Ð²Ð¾Ð³Ð¾ Ð·Ð°Ð¿ÑÐ¾ÑÐ°: ' +
                    list.length
                );
            }).catch(function (error) {
                notify(
                    'ÐÑÐ¸Ð±ÐºÐ° Ð¿Ð°ÑÑÐµÑÐ° Â«' + parser.name + 'Â»:\n' +
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
                'URL Cloudflare Worker Ð½Ðµ Ð½Ð°ÑÑÑÐ¾ÐµÐ½ Ð¸Ð»Ð¸ Ð½ÐµÐºÐ¾ÑÑÐµÐºÑÐµÐ½. ' +
                'ÐÑÐºÑÐ¾Ð¹ Ð½Ð°ÑÑÑÐ¾Ð¹ÐºÐ¸ Lampa â Real-Debrid â ' +
                'ÐÐ°ÑÑÑÐ¾Ð¸ÑÑ Cloudflare Worker URL.'
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
            throw new Error('URL Worker Ð½Ðµ Ð¼Ð¾Ð¶ÐµÑ Ð±ÑÑÑ Ð¿ÑÑÑÑÐ¼.');
        }

        var url;

        try {
            url = new URL(value);
        } catch (e) {
            throw new Error('ÐÐµÐºÐ¾ÑÑÐµÐºÑÐ½ÑÐ¹ URL Worker.');
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
                'Ð£ÐºÐ°Ð¶Ð¸ Ð±Ð°Ð·Ð¾Ð²ÑÐ¹ HTTPS URL Worker Ð±ÐµÐ· Ð»Ð¾Ð³Ð¸Ð½Ð°, ' +
                'Ð¿Ð°ÑÐ¾Ð»Ñ, Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÐ¾Ð² Ð·Ð°Ð¿ÑÐ¾ÑÐ° Ð¸ ÑÑÐ°Ð³Ð¼ÐµÐ½ÑÐ°.'
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
            'Ð¡Ð½Ð°ÑÐ°Ð»Ð° Ð½Ð°ÑÑÑÐ¾Ð¹ URL Cloudflare Worker Ð² ÑÐ°Ð·Ð´ÐµÐ»Ðµ Real-Debrid.'
        );

        return false;
    }

    function askProxyUrl() {
        var current = getProxyUrl();

        var value = window.prompt(
            'URL Cloudflare Worker (HTTPS).\n' +
            'ÐÐ»Ñ ÑÐ´Ð°Ð»ÐµÐ½Ð¸Ñ Ð°Ð´ÑÐµÑÐ° Ð¾ÑÐ¸ÑÑÐ¸ Ð¿Ð¾Ð»Ðµ Ð¸ Ð½Ð°Ð¶Ð¼Ð¸ ÐÐ.',
            current
        );

        if (value === null) return;

        if (!value.trim()) {
            try {
                localStorage.removeItem(PROXY_STORE);
                notify(
                    'URL Worker ÑÐ´Ð°Ð»ÑÐ½. ÐÐ»Ñ Ð´Ð°Ð»ÑÐ½ÐµÐ¹ÑÐµÐ¹ ÑÐ°Ð±Ð¾ÑÑ ' +
                    'Ð¿Ð»Ð°Ð³Ð¸Ð½Ð¾Ð² Ð¿Ð¾ÑÑÐµÐ±ÑÐµÑÑÑ Ð½Ð°ÑÑÑÐ¾Ð¸ÑÑ ÐµÐ³Ð¾ Ð·Ð°Ð½Ð¾Ð²Ð¾.'
                );
            } catch (e) {
                notify('ÐÐµ ÑÐ´Ð°Ð»Ð¾ÑÑ ÑÐ´Ð°Ð»Ð¸ÑÑ URL Worker: ' + e.message);
            }

            return;
        }

        try {
            saveProxyUrl(value);
            notify('URL Cloudflare Worker ÑÐ¾ÑÑÐ°Ð½ÑÐ½ Ð´Ð»Ñ Ð¾Ð±Ð¾Ð¸Ñ Ð¿Ð»Ð°Ð³Ð¸Ð½Ð¾Ð².');
        } catch (e) {
            notify('ÐÑÐ¸Ð±ÐºÐ° Ð½Ð°ÑÑÑÐ¾Ð¹ÐºÐ¸ Worker: ' + e.message);
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
                            'ÐÐµÐ¸Ð·Ð²ÐµÑÑÐ½Ð°Ñ Ð¾ÑÐ¸Ð±ÐºÐ°'
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
                'ÐÐµÑ Ð´Ð°Ð½Ð½ÑÑ Ð´Ð»Ñ Ð¾Ð±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ñ ÑÐ¾ÐºÐµÐ½Ð°. ÐÐ¾Ð´ÐºÐ»ÑÑÐ¸ RD Ð·Ð°Ð½Ð¾Ð²Ð¾.'
            ));
        }

        return postForm(proxyUrl(OAUTH + 'token'), {
            client_id: auth.client_id,
            client_secret: auth.client_secret,
            code: auth.refresh_token,
            grant_type: 'http://oauth.net/grant_type/device/1.0'
        }).then(function (tokens) {
            if (!tokens.access_token) {
                throw new Error('RD Ð½Ðµ Ð²ÐµÑÐ½ÑÐ» Ð½Ð¾Ð²ÑÐ¹ access_token.');
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
                'Real-Debrid Ð½Ðµ Ð¿Ð¾Ð´ÐºÐ»ÑÑÑÐ½. ÐÑÐ¿Ð¾Ð»ÑÐ·ÑÐ¹ Â«ÐÐ¾Ð´ÐºÐ»ÑÑÐ¸ÑÑ RDÂ».'
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
        title.textContent = 'ÐÐ¾Ð´ÐºÐ»ÑÑÐµÐ½Ð¸Ðµ Real-Debrid';
        title.style.cssText =
            'font-size:clamp(24px,5vw,38px);font-weight:bold;margin-bottom:28px;';

        var instruction = document.createElement('div');
        instruction.textContent =
            '1. ÐÑÐºÑÐ¾Ð¹ Ð¾ÑÐ¸ÑÐ¸Ð°Ð»ÑÐ½ÑÐ¹ ÑÐ°Ð¹Ñ Ð¸ Ð²Ð²ÐµÐ´Ð¸ ÑÑÐ¾Ñ ÐºÐ¾Ð´';
        instruction.style.cssText =
            'font-size:clamp(17px,3vw,25px);margin-bottom:16px;';

        var codeBox = document.createElement('div');
        codeBox.textContent = code || 'ÐÐ¾Ð´ Ð½ÐµÐ´Ð¾ÑÑÑÐ¿ÐµÐ½';
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
            'ÐÐ¶Ð¸Ð´Ð°ÐµÐ¼ Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ¶Ð´ÐµÐ½Ð¸Ñ Ð½Ð° ÑÐ°Ð¹ÑÐµ Real-Debridâ¦';
        status.style.cssText =
            'font-size:clamp(17px,3vw,25px);margin:20px 0 40px;overflow-wrap:anywhere;';

        var copy = document.createElement('button');
        copy.textContent = 'ÐÐ¾Ð¿Ð¸ÑÐ¾Ð²Ð°ÑÑ ÐºÐ¾Ð´';
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
                    ? 'ÐÐ¾Ð¿ÑÑÐºÐ° ÐºÐ¾Ð¿Ð¸ÑÐ¾Ð²Ð°Ð½Ð¸Ñ Ð²ÑÐ¿Ð¾Ð»Ð½ÐµÐ½Ð°. ÐÑÐ»Ð¸ Ð½Ðµ ÑÐºÐ¾Ð¿Ð¸ÑÐ¾Ð²Ð°Ð»Ð¾ÑÑ, Ð²ÑÐ´ÐµÐ»Ð¸ ÐºÐ¾Ð´ Ð²ÑÑÑÐ½ÑÑ.'
                    : 'ÐÑÐ´ÐµÐ»Ð¸ Ð¸ ÑÐºÐ¾Ð¿Ð¸ÑÑÐ¹ ÐºÐ¾Ð´ Ð²ÑÑÑÐ½ÑÑ.';
            } catch (e) {
                status.textContent = 'ÐÑÐ´ÐµÐ»Ð¸ Ð¸ ÑÐºÐ¾Ð¿Ð¸ÑÑÐ¹ ÐºÐ¾Ð´ Ð²ÑÑÑÐ½ÑÑ.';
            }

            input.remove();
        }

        copy.onclick = function () {
            var value = String(code || '');

            if (!value) {
                status.textContent = 'ÐÐ¾Ð´ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½.';
                return;
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).then(function () {
                    status.textContent =
                        'ÐÐ¾Ð´ ÑÐºÐ¾Ð¿Ð¸ÑÐ¾Ð²Ð°Ð½. ÐÐ²ÐµÐ´Ð¸ ÐµÐ³Ð¾ Ð½Ð° ÑÐ°Ð¹ÑÐµ Real-Debrid.';
                }).catch(function () {
                    fallbackCopy(value);
                });
            } else {
                fallbackCopy(value);
            }
        };

        var open = document.createElement('button');
        open.textContent = 'ÐÑÐºÑÑÑÑ Real-Debrid';
        open.style.cssText = buttonStyle;
        open.onclick = function () {
            var target = url || 'https://real-debrid.com/device';
            var win = window.open(target, '_blank');
            if (!win) window.location.href = target;
        };

        var instruction2 = document.createElement('div');
        instruction2.textContent =
            '2. ÐÐ¾Ð´ÑÐ²ÐµÑÐ´Ð¸ ÑÑÑÑÐ¾Ð¹ÑÑÐ²Ð¾ Ð½Ð° ÑÐ°Ð¹ÑÐµ';
        instruction2.style.cssText =
            'font-size:clamp(17px,3vw,25px);margin:36px 0 22px;';

        var close = document.createElement('button');
        close.textContent = 'ÐÐ°ÐºÑÑÑÑ';
        close.style.cssText = buttonStyle;
        close.onclick = function () {
            overlay.remove();
        };

        var note = document.createElement('div');
        note.textContent =
            'ÐÐ²Ð¾Ð´Ð¸ Ð¿Ð°ÑÐ¾Ð»Ñ ÑÐ¾Ð»ÑÐºÐ¾ Ð½Ð° Ð¾ÑÐ¸ÑÐ¸Ð°Ð»ÑÐ½Ð¾Ð¼ ÑÐ°Ð¹ÑÐµ Real-Debrid.';
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
                throw new Error('RD Ð½Ðµ Ð²ÐµÑÐ½ÑÐ» device_code.');
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
                        'ÐÑÐµÐ¼Ñ Ð°Ð²ÑÐ¾ÑÐ¸Ð·Ð°ÑÐ¸Ð¸ Ð¸ÑÑÐµÐºÐ»Ð¾. ÐÐ¾Ð¿ÑÐ¾Ð±ÑÐ¹ ÑÐ½Ð¾Ð²Ð°.'
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
                    throw new Error('RD Ð½Ðµ Ð²ÐµÑÐ½ÑÐ» client_id/client_secret.');
                }

                return postForm(proxyUrl(OAUTH + 'token'), {
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret,
                    code: device.device_code,
                    grant_type: 'http://oauth.net/grant_type/device/1.0'
                }).then(function (tokens) {
                    if (!tokens.access_token) {
                        throw new Error('RD Ð½Ðµ Ð²ÐµÑÐ½ÑÐ» access_token.');
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
                        'Ð£ÑÑÑÐ¾Ð¹ÑÑÐ²Ð¾ Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ¶Ð´ÐµÐ½Ð¾! Real-Debrid Ð¿Ð¾Ð´ÐºÐ»ÑÑÑÐ½.'
                    );

                    return profile(auth.access_token).then(function (user) {
                        notify(
                            'RD Ð¿Ð¾Ð´ÐºÐ»ÑÑÑÐ½: ' +
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
        ]) || 'ÐÐµÐ· Ð½Ð°Ð·Ð²Ð°Ð½Ð¸Ñ';
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
                'ÐÐµÐ¾Ð¶Ð¸Ð´Ð°Ð½Ð½ÑÐ¹ ÑÐ¾ÑÐ¼Ð°Ñ Ð¾ÑÐ²ÐµÑÐ° API: ' +
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
                    'ÐÐµÑ Ð²ÐºÐ»ÑÑÑÐ½Ð½ÑÑ Ð¿Ð°ÑÑÐµÑÐ¾Ð². ÐÑÐºÑÐ¾Ð¹ Â«ÐÐ°ÑÑÑÐ¾Ð¸ÑÑ Ð¿Ð°ÑÑÐµÑÑÂ».'
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
            '<div class="rd-bridge-title">Real-Debrid â ÐºÑÑ</div>' +
            '<div class="rd-bridge-status" id="rd-status">ÐÐµÑÑÐ¸Ñ ' +
            PLUGIN_VERSION + '</div>' +
            '<button class="rd-bridge-button" id="rd-worker">ÐÐ°ÑÑÑÐ¾Ð¸ÑÑ Worker URL</button>' +
            '<button class="rd-bridge-button" id="rd-connect">ÐÐ¾Ð´ÐºÐ»ÑÑÐ¸ÑÑ RD</button>' +
            '<button class="rd-bridge-button" id="rd-check">ÐÑÐ¾Ð²ÐµÑÐ¸ÑÑ Ð¿Ð¾Ð´ÐºÐ»ÑÑÐµÐ½Ð¸Ðµ</button>' +
            '<button class="rd-bridge-button" id="rd-disconnect">ÐÑÐºÐ»ÑÑÐ¸ÑÑ RD</button>' +
            '<hr>' +
            '<input class="rd-bridge-input" id="rd-query" placeholder="ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ ÑÐ¸Ð»ÑÐ¼Ð° Ð¸Ð»Ð¸ ÑÐµÑÐ¸Ð°Ð»Ð°">' +
            '<button class="rd-bridge-button" id="rd-search">ÐÐ°Ð¹ÑÐ¸ ÑÐ°Ð·Ð´Ð°ÑÐ¸</button>' +
            '<div id="rd-results"></div>';

        var status = panel.querySelector('#rd-status');
        var results = panel.querySelector('#rd-results');

        function setStatus(text) {
            status.textContent = text;
        }

        panel.querySelector('#rd-worker').onclick = function () {
            askProxyUrl();
            setStatus(getProxyUrl()
                ? 'Worker URL Ð½Ð°ÑÑÑÐ¾ÐµÐ½.'
                : 'Worker URL Ð½Ðµ Ð½Ð°ÑÑÑÐ¾ÐµÐ½.');
        };

        panel.querySelector('#rd-connect').onclick = function () {
            if (!checkProxyConfigured()) return;

            setStatus('ÐÐ¶Ð¸Ð´Ð°Ñ Ð°Ð²ÑÐ¾ÑÐ¸Ð·Ð°ÑÐ¸Ñ RDâ¦');

            connectAuth().then(function (result) {
                setStatus(
                    'ÐÐ¾Ð´ÐºÐ»ÑÑÐµÐ½Ð¾: ' +
                    (result.user.username || result.user.email || 'OK')
                );
            }).catch(function (error) {
                setStatus('ÐÑÐ¸Ð±ÐºÐ° Ð¿Ð¾Ð´ÐºÐ»ÑÑÐµÐ½Ð¸Ñ: ' + error.message);
            });
        };

        panel.querySelector('#rd-check').onclick = function () {
            if (!checkProxyConfigured()) return;

            setStatus('ÐÑÐ¾Ð²ÐµÑÑÑ RDâ¦');

            getWorkingAuth().then(function (result) {
                setStatus(
                    'RD ÑÐ°Ð±Ð¾ÑÐ°ÐµÑ: ' +
                    (result.user.username || result.user.email || 'OK')
                );
            }).catch(function (error) {
                setStatus('ÐÑÐ¾Ð²ÐµÑÐºÐ° Ð½Ðµ Ð¿ÑÐ¾Ð¹Ð´ÐµÐ½Ð°: ' + error.message);
            });
        };

        panel.querySelector('#rd-disconnect').onclick = function () {
            clearAuth();
            setStatus('ÐÐ¾ÐºÐ°Ð»ÑÐ½Ð°Ñ Ð°Ð²ÑÐ¾ÑÐ¸Ð·Ð°ÑÐ¸Ñ ÑÐ´Ð°Ð»ÐµÐ½Ð°. ÐÐ¾Ð´ÐºÐ»ÑÑÐ¸ RD Ð·Ð°Ð½Ð¾Ð²Ð¾.');
        };

        panel.querySelector('#rd-search').onclick = function () {
            if (!checkProxyConfigured()) return;

            var query = panel.querySelector('#rd-query').value.trim();

            if (!query) {
                notify('ÐÐ²ÐµÐ´Ð¸ Ð½Ð°Ð·Ð²Ð°Ð½Ð¸Ðµ ÑÐ¸Ð»ÑÐ¼Ð° Ð¸Ð»Ð¸ ÑÐµÑÐ¸Ð°Ð»Ð°.');
                return;
            }

            results.innerHTML = '';
            setStatus('ÐÑÐ¾Ð²ÐµÑÑÑ Ð°Ð²ÑÐ¾ÑÐ¸Ð·Ð°ÑÐ¸Ñâ¦');

            getWorkingAuth().then(function (authResult) {
                setStatus('ÐÑÑ ÑÐµÐ»Ð¸Ð·Ñâ¦');

                return searchParsers(query, query, '').then(function (search) {
                    var items = search.items;

                    var parserStatus = search.stats.map(function (stat) {
                        return stat.name + ': ' +
                            (stat.error
                                ? 'ÐÐ¨ÐÐÐÐ â ' + stat.error
                                : stat.count + ' ÑÐµÐ»Ð¸Ð·Ð¾Ð²');
                    }).join('\n');

                    if (!items.length) {
                        setStatus(
                            'Ð ÐµÐ»Ð¸Ð·Ñ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ.\n\n' +
                            'ÐÐ¸Ð°Ð³Ð½Ð¾ÑÑÐ¸ÐºÐ° Ð¿Ð°ÑÑÐµÑÐ¾Ð²:\n' + parserStatus +
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
                        'ÐÐ°Ð¹Ð´ÐµÐ½Ð¾: ' + items.length +
                        '. ÐÑÐ¾Ð²ÐµÑÑÑ Ð´Ð¾ ' + MAX_HASH_CHECKS +
                        ' ÑÐ½Ð¸ÐºÐ°Ð»ÑÐ½ÑÑ hash Ð² RDâ¦\n\n' +
                        'ÐÐ¸Ð°Ð³Ð½Ð¾ÑÑÐ¸ÐºÐ° Ð¿Ð°ÑÑÐµÑÐ¾Ð²:\n' + parserStatus
                    );

                    return checkHashes(
                        hashes,
                        authResult.auth,
                        function (done, total) {
                            setStatus(
                                'ÐÑÐ¾Ð²ÐµÑÐºÐ° RD: ' + done + ' Ð¸Ð· ' + total +
                                '\n\nÐÐ¸Ð°Ð³Ð½Ð¾ÑÑÐ¸ÐºÐ° Ð¿Ð°ÑÑÐµÑÐ¾Ð²:\n' + parserStatus
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
                                resultText = 'Hash Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½';
                            } else if (!check) {
                                resultText = 'ÐÐµ Ð¿ÑÐ¾Ð²ÐµÑÐµÐ½Ð¾';
                            } else if (check.error) {
                                resultText = 'ÐÑÐ¸Ð±ÐºÐ° RD: ' + check.error;
                            } else {
                                resultText = check.available
                                    ? 'ÐÑÑÑ Ð² ÐºÑÑÐµ RD'
                                    : 'Ð ÐºÑÑÐµ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾';
                            }

                            meta.textContent =
                                (item._parser || 'ÐÐ°ÑÑÐµÑ') +
                                ' Â· ' + resultText;

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
                            'ÐÐ°Ð¹Ð´ÐµÐ½Ð¾: ' + items.length +
                            ' Â· ÐÑÐ¾Ð²ÐµÑÐµÐ½Ð¾ RD: ' + checked.results.length +
                            ' Â· ÐÑÑ: ' +
                            checked.results.filter(function (r) {
                                return r.available;
                            }).length +
                            '\n\nÐÐ¸Ð°Ð³Ð½Ð¾ÑÑÐ¸ÐºÐ° Ð¿Ð°ÑÑÐµÑÐ¾Ð²:\n' + parserStatus;

                        if (checked.stopReason) {
                            summary += '\nÐÑÐ¾Ð²ÐµÑÐºÐ° Ð¾ÑÑÐ°Ð½Ð¾Ð²Ð»ÐµÐ½Ð°: ' +
                                checked.stopReason;
                        }

                        if (search.errors.length) {
                            summary += '\n\nÐÑÐ¸Ð±ÐºÐ¸ Ð¿Ð°ÑÑÐµÑÐ¾Ð²:\n' +
                                search.errors.join('\n');
                        }

                        setStatus(summary);
                    });
                });
            }).catch(function (error) {
                setStatus('ÐÑÐ¸Ð±ÐºÐ° Ð¿Ð¾Ð¸ÑÐºÐ°: ' + error.message);
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
        close.textContent = 'ÐÐ°ÐºÑÑÑÑ';
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
                'ÐÐ°ÑÑÑÐ¾Ð¸ÑÑ Cloudflare Worker URL',
                'ÐÐ±ÑÐ¸Ð¹ Ð°Ð´ÑÐµÑ Worker Ð´Ð»Ñ rd-test.js Ð¸ rd-card-button.js. ' +
                'ÐÑÑÑÐ¾Ðµ Ð¿Ð¾Ð»Ðµ ÑÐ´Ð°Ð»ÑÐµÑ Ð°Ð´ÑÐµÑ.',
                function () {
                    askProxyUrl();
                }
            );

            addButton(
                'rd_manage_parsers_v1',
                'ÐÐ°ÑÑÑÐ¾Ð¸ÑÑ Ð¿Ð°ÑÑÐµÑÑ',
                'ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ, ÑÐµÐ´Ð°ÐºÑÐ¸ÑÐ¾Ð²Ð°ÑÑ, Ð²ÐºÐ»ÑÑÐ°ÑÑ, Ð¾ÑÐºÐ»ÑÑÐ°ÑÑ, Ð¿ÑÐ¾Ð²ÐµÑÑÑÑ Ð¸ ÑÐ´Ð°Ð»ÑÑÑ Ð¿Ð°ÑÑÐµÑÑ.',
                function () {
                    parserManager();
                }
            );

            addButton(
                'rd_oauth_start_v2',
                'ÐÐ¾Ð´ÐºÐ»ÑÑÐ¸ÑÑ Real-Debrid',
                'ÐÐ²ÑÐ¾ÑÐ¸Ð·Ð°ÑÐ¸Ñ ÑÐµÑÐµÐ· Ð¾ÑÐ¸ÑÐ¸Ð°Ð»ÑÐ½ÑÐ¹ ÑÐ°Ð¹Ñ Real-Debrid',
                function () {
                    if (!checkProxyConfigured()) return;

                    connectAuth().catch(function (error) {
                        notify('ÐÑÐ¸Ð±ÐºÐ° Ð¿Ð¾Ð´ÐºÐ»ÑÑÐµÐ½Ð¸Ñ RD: ' + error.message);
                    });
                }
            );

            addButton(
                'rd_oauth_check_v2',
                'ÐÑÐ¾Ð²ÐµÑÐ¸ÑÑ Ð¿Ð¾Ð´ÐºÐ»ÑÑÐµÐ½Ð¸Ðµ',
                'ÐÑÐ¾Ð²ÐµÑÐ¸ÑÑ Ð¿ÑÐ¾ÑÐ¸Ð»Ñ Ð¸ Ð¾Ð±Ð½Ð¾Ð²Ð¸ÑÑ ÑÐ¾ÐºÐµÐ½ Ð¿ÑÐ¸ Ð½ÐµÐ¾Ð±ÑÐ¾Ð´Ð¸Ð¼Ð¾ÑÑÐ¸',
                function () {
                    if (!checkProxyConfigured()) return;

                    getWorkingAuth().then(function (result) {
                        var user = result.user || {};

                        notify(
                            'RD ÑÐ°Ð±Ð¾ÑÐ°ÐµÑ: ' +
                            (user.username || user.email || user.id || 'OK')
                        );
                    }).catch(function (error) {
                        notify(
                            'ÐÑÐ¾Ð²ÐµÑÐºÐ° RD Ð½Ðµ Ð¿ÑÐ¾Ð¹Ð´ÐµÐ½Ð°: ' + error.message
                        );
                    });
                }
            );

            addButton(
                'rd_oauth_disconnect_v2',
                'Ð£Ð´Ð°Ð»Ð¸ÑÑ Ð»Ð¾ÐºÐ°Ð»ÑÐ½ÑÐµ Ð´Ð°Ð½Ð½ÑÐµ',
                'Ð£Ð´Ð°Ð»Ð¸ÑÑ ÑÐ¾ÑÑÐ°Ð½ÑÐ½Ð½ÑÑ Ð°Ð²ÑÐ¾ÑÐ¸Ð·Ð°ÑÐ¸Ñ RD Ð² ÑÑÐ¾Ð¼ Ð±ÑÐ°ÑÐ·ÐµÑÐµ',
                function () {
                    clearAuth();
                    notify('ÐÐ¾ÐºÐ°Ð»ÑÐ½ÑÐµ Ð´Ð°Ð½Ð½ÑÐµ RD ÑÐ´Ð°Ð»ÐµÐ½Ñ.');
                }
            );

            addButton(
                'rd_search_cached_v1',
                'ÐÐ¾Ð¸ÑÐº Ð·Ð°ÐºÑÑÐ¸ÑÐ¾Ð²Ð°Ð½Ð½ÑÑ ÑÐ°Ð·Ð´Ð°Ñ',
                'ÐÐ¾Ð¸ÑÐº Ð¿Ð¾ Ð²ÐºÐ»ÑÑÑÐ½Ð½ÑÐ¼ Ð¿Ð°ÑÑÐµÑÐ°Ð¼ Ñ Ð¿ÑÐ¾Ð²ÐµÑÐºÐ¾Ð¹ ÐºÑÑÐ° RD.',
                function () {
                    openPanel();
                }
            );

            SETTINGS_REGISTERED = true;

            console.log(
                '[' + PLUGIN_NAME + '] ÐÐ°ÑÑÑÐ¾Ð¹ÐºÐ¸ Ð·Ð°ÑÐµÐ³Ð¸ÑÑÑÐ¸ÑÐ¾Ð²Ð°Ð½Ñ',
                PLUGIN_VERSION
            );
        } catch (error) {
            SETTINGS_REGISTERED = false;

            console.error(
                '[' + PLUGIN_NAME + '] ÐÑÐ¸Ð±ÐºÐ° ÑÐµÐ³Ð¸ÑÑÑÐ°ÑÐ¸Ð¸ Ð½Ð°ÑÑÑÐ¾ÐµÐº:',
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
                '] ÐÐµ ÑÐ´Ð°Ð»Ð¾ÑÑ Ð·Ð°ÑÐµÐ³Ð¸ÑÑÑÐ¸ÑÐ¾Ð²Ð°ÑÑ Ð½Ð°ÑÑÑÐ¾Ð¹ÐºÐ¸. ' +
                'ÐÑÐ¾Ð²ÐµÑÑ Ð´Ð¾ÑÑÑÐ¿Ð½Ð¾ÑÑÑ Lampa.SettingsApi.'
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
                    '[' + PLUGIN_NAME + '] ÐÐ½Ð¸ÑÐ¸Ð°Ð»Ð¸Ð·Ð°ÑÐ¸Ñ Ð·Ð°Ð²ÐµÑÑÐµÐ½Ð°',
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
    }
})();