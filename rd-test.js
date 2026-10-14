(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
    var OAUTH = 'https://api.real-debrid.com/oauth/v2/';
    var API = 'https://api.real-debrid.com/rest/1.0/';
    var PUBLIC_CLIENT_ID = 'X245A4XAIBGVM';
    var STORE = 'rd_bridge_oauth_v2';
    var PARSERS = [
        'https://jr.maxvol.pro',
        'https://jac.red'
    ];

    var polling = false;
    var timer = null;
    var searchId = 0;

    function notify(text) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show(text);
        } else {
            window.alert(text);
        }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return {
                '&': '&amp;', '<': '&lt;', '>': '&gt;',
                '"': '&quot;', "'": '&#39;'
            }[c];
        });
    }

    function proxyUrl(url) {
        return PROXY + '?url=' + encodeURIComponent(url);
    }

    function request(url, options) {
        options = options || {};
        var headers = {};
        Object.keys(options.headers || {}).forEach(function (key) {
            headers[key] = options.headers[key];
        });
        headers.Accept = 'application/json';

        return fetch(proxyUrl(url), {
            method: options.method || 'GET',
            headers: headers,
            body: options.body
        }).then(function (response) {
            return response.text().then(function (text) {
                var data = {};
                try {
                    data = text ? JSON.parse(text) : {};
                } catch (e) {
                    data = { message: text };
                }

                if (!response.ok) {
                    var error = new Error(
                        'HTTP ' + response.status + ': ' +
                        String(data.error_description ||
                            data.error || data.message || text || 'ошибка')
                            .slice(0, 180)
                    );
                    error.status = response.status;
                    throw error;
                }
                return data;
            });
        });
    }

    function postForm(url, values) {
        var body = Object.keys(values).map(function (key) {
            return encodeURIComponent(key) + '=' +
                encodeURIComponent(values[key]);
        }).join('&');

        return request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body
        });
    }

    function readTokens() {
        try {
            return JSON.parse(localStorage.getItem(STORE) || '{}');
        } catch (e) {
            return {};
        }
    }

    function profile(token) {
        return request(API + 'user', {
            headers: { Authorization: 'Bearer ' + token }
        });
    }

    function stopPolling() {
        polling = false;
        if (timer) clearTimeout(timer);
        timer = null;
    }

    function setAuthStatus(text) {
        var el = document.getElementById('rd-bridge-status');
        if (el) el.textContent = text;
    }

    function openDevicePage(url) {
        try {
            if (window.Lampa && Lampa.Platform && Lampa.Platform.open) {
                Lampa.Platform.open(url);
                return;
            }
        } catch (e) {}
        window.open(url, '_blank');
    }

    function beginAuth() {
        if (polling) {
            notify('Авторизация уже запущена.');
            return;
        }

        polling = true;

        request(OAUTH + 'device/code?client_id=' +
            encodeURIComponent(PUBLIC_CLIENT_ID) + '&new_credentials=yes')
            .then(function (device) {
                if (!device.device_code || !device.user_code) {
                    throw new Error('Real-Debrid не вернул код устройства.');
                }

                var old = document.getElementById('rd-bridge-device-screen');
                if (old) old.remove();

                var screen = document.createElement('div');
                screen.id = 'rd-bridge-device-screen';
                screen.style.cssText =
                    'position:fixed;z-index:999999;inset:0;background:#111;' +
                    'color:white;display:flex;align-items:center;' +
                    'justify-content:center;padding:24px;box-sizing:border-box;' +
                    'font:16px Arial,sans-serif;';

                screen.innerHTML =
                    '<div style="max-width:520px;width:100%;text-align:center">' +
                    '<h2>Подключение Real-Debrid</h2>' +
                    '<p>Открой официальный сайт и введи код:</p>' +
                    '<div style="font-size:40px;font-weight:bold;' +
                    'letter-spacing:5px;padding:20px;background:#292929">' +
                    escapeHtml(device.user_code) + '</div>' +
                    '<p><button id="rd-copy">Копировать код</button> ' +
                    '<button id="rd-open">Открыть сайт</button></p>' +
                    '<p id="rd-bridge-status">Ожидаем подтверждения…</p>' +
                    '<button id="rd-close">Закрыть</button>' +
                    '<p style="font-size:12px;opacity:.7">' +
                    'Пароль вводи только на официальном сайте Real-Debrid.</p>' +
                    '</div>';

                document.body.appendChild(screen);

                document.getElementById('rd-copy').onclick = function () {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(device.user_code)
                            .then(function () {
                                setAuthStatus('Код скопирован.');
                            }).catch(function () {
                                setAuthStatus('Скопируй код вручную.');
                            });
                    } else {
                        setAuthStatus('Скопируй код вручную.');
                    }
                };

                document.getElementById('rd-open').onclick = function () {
                    openDevicePage(
                        device.verification_url ||
                        'https://real-debrid.com/device'
                    );
                };

                document.getElementById('rd-close').onclick = function () {
                    stopPolling();
                    screen.remove();
                };

                var interval = Math.max(5, Number(device.interval) || 5) * 1000;
                var expires = (Number(device.expires_in) || 1800) * 1000;
                var started = Date.now();

                function poll() {
                    if (!polling) return;

                    if (Date.now() - started > expires) {
                        stopPolling();
                        setAuthStatus('Код истёк. Запусти подключение заново.');
                        return;
                    }

                    var url = OAUTH + 'device/credentials?client_id=' +
                        encodeURIComponent(PUBLIC_CLIENT_ID) + '&code=' +
                        encodeURIComponent(device.device_code);

                    request(url).then(function (credentials) {
                        if (!credentials.client_id || !credentials.client_secret) {
                            throw new Error('Не получены реквизиты приложения.');
                        }

                        setAuthStatus('Подтверждено. Получаем токен…');

                        return postForm(OAUTH + 'token', {
                            client_id: credentials.client_id,
                            client_secret: credentials.client_secret,
                            code: device.device_code,
                            grant_type: 'http://oauth.net/grant_type/device/1.0'
                        }).then(function (tokens) {
                            if (!tokens.access_token) {
                                throw new Error('Токен не получен.');
                            }

                            return profile(tokens.access_token).then(function (user) {
                                var saved = {
                                    access_token: tokens.access_token,
                                    refresh_token: tokens.refresh_token || '',
                                    expires_in: Number(tokens.expires_in) || 0,
                                    obtained_at: Date.now(),
                                    client_id: credentials.client_id,
                                    client_secret: credentials.client_secret,
                                    username: user.username || '',
                                    user_id: user.id || ''
                                };

                                localStorage.setItem(STORE, JSON.stringify(saved));
                                return saved;
                            });
                        });
                    }).then(function (saved) {
                        stopPolling();
                        setAuthStatus('Подключено: ' + (saved.username || 'OK'));
                        notify('Real-Debrid подключён.');
                    }).catch(function (err) {
                        if (err.status === 400 || err.status === 403 ||
                            err.status === 404) {
                            setAuthStatus('Ожидаем подтверждения на сайте…');
                            timer = setTimeout(poll, interval);
                        } else {
                            stopPolling();
                            setAuthStatus('Ошибка: ' + err.message);
                        }
                    });
                }

                timer = setTimeout(poll, interval);
            }).catch(function (err) {
                stopPolling();
                notify('Ошибка авторизации RD: ' + err.message);
            });
    }

    function checkAuth() {
        var saved = readTokens();
        if (!saved.access_token) {
            notify('Real-Debrid не подключён.');
            return;
        }

        profile(saved.access_token).then(function (user) {
            notify('Подключено: ' + (user.username || 'профиль доступен'));
        }).catch(function (err) {
            notify('Проверка не пройдена: ' + err.message);
        });
    }

    function disconnect() {
        localStorage.removeItem(STORE);
        notify('Локальные данные Real-Debrid удалены.');
    }

    function extractHash(item) {
        var fields = [
            item.hash, item.info_hash, item.infoHash,
            item.magnet, item.MagnetUri, item.magnetUri,
            item.link, item.Link
        ];

        for (var i = 0; i < fields.length; i++) {
            var value = String(fields[i] || '');
            var magnet = value.match(/urn:btih:([a-f0-9]{40})/i);
            if (magnet) return magnet[1].toLowerCase();

            var direct = value.match(/^\s*([a-f0-9]{40})\s*$/i);
            if (direct) return direct[1].toLowerCase();
        }

        return '';
    }

    function parseResults(json) {
        if (Array.isArray(json)) return json;
        if (json && Array.isArray(json.Results)) return json.Results;
        if (json && Array.isArray(json.results)) return json.results;
        return [];
    }

    function searchParser(host, query) {
        var url = host +
            '/api/v2.0/indexers/all/results?Query=' +
            encodeURIComponent(query) +
            '&Category=2000,5000';

        return request(url).then(function (json) {
            return parseResults(json).map(function (raw) {
                var info = raw.info || {};
                var title = raw.title || raw.name ||
                    raw.Title || raw.Name || raw.release || 'Без названия';

                var voices = info.voices || raw.voices || raw.voice || '';
                if (Array.isArray(voices)) voices = voices.join(', ');

                return {
                    title: String(title),
                    hash: extractHash(raw),
                    magnet: raw.magnet || raw.MagnetUri ||
                        raw.magnetUri || raw.link || raw.Link || '',
                    quality: info.quality || raw.quality || '',
                    voices: String(voices || ''),
                    size: raw.size || raw.Size || '',
                    seeders: raw.Seeders || raw.seeders || '',
                    source: host
                };
            }).filter(function (item) {
                return !!item.hash;
            });
        });
    }

    function hasCachedFiles(data, hash) {
        if (!data || typeof data !== 'object') return false;

        var entry = data[hash] || data[hash.toUpperCase()] ||
            data[hash.toLowerCase()];

        if (!entry || !entry.rd) return false;

        var variants = Array.isArray(entry.rd) ? entry.rd : [entry.rd];

        return variants.some(function (variant) {
            if (!variant || typeof variant !== 'object') return false;

            // RD отдаёт варианты файлов внутри объекта; пустые варианты
            // не считаем подтверждением кэша.
            return Object.keys(variant).some(function (key) {
                var fileSet = variant[key];
                if (!fileSet || typeof fileSet !== 'object') return false;

                if (Array.isArray(fileSet)) return fileSet.length > 0;
                if (Array.isArray(fileSet.files)) return fileSet.files.length > 0;

                return Object.keys(fileSet).length > 0;
            });
        });
    }

    function checkCached(item, token) {
        return request(API + 'torrents/instantAvailability/' +
            encodeURIComponent(item.hash), {
                headers: { Authorization: 'Bearer ' + token }
            }).then(function (data) {
                return hasCachedFiles(data, item.hash) ? item : null;
            }).catch(function () {
                return null;
            });
    }

    function setSearchStatus(screen, text) {
        var el = screen.querySelector('#rd-search-status');
        if (el) el.textContent = text;
    }

    function showSearchResults(screen, items) {
        var box = screen.querySelector('#rd-search-results');
        if (!box) return;
        box.innerHTML = '';

        items.forEach(function (item) {
            var card = document.createElement('div');
            card.style.cssText =
                'padding:14px;margin:10px 0;background:#222;border-radius:8px;' +
                'overflow-wrap:anywhere;';

            var title = document.createElement('div');
            title.style.cssText = 'font-size:17px;font-weight:bold;';
            title.textContent = item.title;
            card.appendChild(title);

            var meta = [];
            if (item.quality) meta.push(String(item.quality));
            if (item.voices) meta.push(item.voices);
            if (item.size) meta.push('Размер: ' + item.size);
            if (item.seeders) meta.push('Сиды: ' + item.seeders);

            if (meta.length) {
                var details = document.createElement('div');
                details.style.cssText = 'margin-top:7px;opacity:.8;font-size:14px;';
                details.textContent = meta.join(' · ');
                card.appendChild(details);
            }

            var badge = document.createElement('div');
            badge.style.cssText = 'margin-top:8px;color:#8fda9b;font-size:13px;';
            badge.textContent = 'Кэш RD подтверждён';
            card.appendChild(badge);

            box.appendChild(card);
        });
    }

    function runSearch(query, screen, id) {
        var saved = readTokens();

        if (!saved.access_token) {
            setSearchStatus(screen, 'Сначала подключи Real-Debrid в настройках.');
            return;
        }

        setSearchStatus(screen, 'Поиск на JacRed и MaxVol…');

        Promise.all(PARSERS.map(function (host) {
            return searchParser(host, query).catch(function () {
                return [];
            });
        })).then(function (groups) {
            if (id !== searchId || !document.body.contains(screen)) return null;

            var seen = {};
            var items = [];

            groups.forEach(function (group) {
                group.forEach(function (item) {
                    if (!seen[item.hash]) {
                        seen[item.hash] = true;
                        items.push(item);
                    }
                });
            });

            if (!items.length) {
                setSearchStatus(screen,
                    'Раздачи не найдены. Проверь доступность индексаторов и название.');
                return null;
            }

            setSearchStatus(screen,
                'Найдено: ' + items.length + '. Проверяем кэш RD…');

            // Ограничение защищает от большого числа запросов к API.
            return Promise.all(items.slice(0, 30).map(function (item) {
                return checkCached(item, saved.access_token);
            })).then(function (results) {
                return results.filter(Boolean);
            });
        }).then(function (cached) {
            if (!cached || id !== searchId ||
                !document.body.contains(screen)) return;

            if (!cached.length) {
                setSearchStatus(screen,
                    'Закэшированных раздач не найдено.');
                return;
            }

            setSearchStatus(screen,
                'Подтверждено в кэше: ' + cached.length);
            showSearchResults(screen, cached);
        }).catch(function (err) {
            if (id === searchId) {
                setSearchStatus(screen, 'Ошибка поиска: ' + err.message);
            }
        });
    }

    function startSearch() {
        var query = window.prompt('Название фильма или сериала:');
        if (!query || !query.trim()) return;

        var old = document.getElementById('rd-bridge-search-screen');
        if (old) old.remove();

        var screen = document.createElement('div');
        screen.id = 'rd-bridge-search-screen';
        screen.style.cssText =
            'position:fixed;z-index:999998;inset:0;overflow:auto;' +
            'background:rgba(0,0,0,.96);color:white;padding:22px;' +
            'box-sizing:border-box;font:16px Arial,sans-serif;';

        screen.innerHTML =
            '<div style="max-width:900px;margin:auto">' +
            '<div style="display:flex;justify-content:space-between;' +
            'align-items:center;gap:10px"><h2>Real-Debrid — поиск кэша</h2>' +
            '<button id="rd-search-close">Закрыть</button></div>' +
            '<div id="rd-search-status" style="padding:14px 0">' +
            'Запуск поиска…</div><div id="rd-search-results"></div></div>';

        document.body.appendChild(screen);

        document.getElementById('rd-search-close').onclick = function () {
            searchId++;
            screen.remove();
        };

        var id = ++searchId;
        runSearch(query.trim(), screen, id);
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

        function addButton(name, title, description, callback) {
            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: { name: name, type: 'button', values: '' },
                field: { name: title, description: description },
                onChange: callback
            });
        }

        addButton(
            'rd_oauth_start_v2',
            'Подключить Real-Debrid',
            'Показать код авторизации',
            beginAuth
        );

        addButton(
            'rd_oauth_check_v2',
            'Проверить подключение',
            'Проверить доступ к профилю RD',
            checkAuth
        );

        addButton(
            'rd_oauth_disconnect_v2',
            'Удалить локальные данные',
            'Удалить сохранённые токены из этого браузера',
            disconnect
        );

        addButton(
            'rd_search_cached_v1',
            'Поиск закэшированных раздач',
            'Поиск JacRed/MaxVol с проверкой кэша Real-Debrid',
            startSearch
        );
    }

    if (window.Lampa && Lampa.SettingsApi) {
        addSettings();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') addSettings();
        });
    }
})();
