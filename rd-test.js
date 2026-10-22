(function () {
    'use strict';

    var PLUGIN_NAME = 'Real-Debrid Bridge';
    var PLUGIN_VERSION = '1.1.4-test';
    var COMPONENT = 'rd_bridge';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
    var RD_API = 'https://api.real-debrid.com/rest/1.0/';
    var OAUTH = 'https://api.real-debrid.com/oauth/v2/';
    var PUBLIC_CLIENT_ID = 'X245A4XAIBGVM';
    var STORE = 'rd_bridge_oauth_v2';
    var PARSERS = [
        { name: 'MaxVol', url: 'jr.maxvol.pro', key: '' },
        { name: 'Jacred', url: 'jacred.xyz', key: '' }
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
                        (data.error_description || data.error ||
                            data.message || response.statusText ||
                            'Неизвестная ошибка')
                    );
                }
                return data;
            });
        });
    }

    function postForm(url, values) {
        var body = new URLSearchParams();
        Object.keys(values).forEach(function (key) {
            if (values[key] !== undefined &&
                values[key] !== null && values[key] !== '') {
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

    function proxyUrl(url) {
        return PROXY + '?url=' + encodeURIComponent(url);
    }

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
        if (!auth || !auth.refresh_token ||
            !auth.client_id || !auth.client_secret) {
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

    /*
     * Авторизация по коду устройства.
     * device/code и device/credentials вызываются через GET с query-параметрами;
     * обмен кода на токен и обновление токена остаются POST.
     */
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

            notify(
                'Открой страницу авторизации RD:\n' + url +
                '\n\nКод: ' + (device.user_code || '') +
                '\n\nПосле подтверждения вернись в Lampa.'
            );

            var interval = Math.max(
                5, Number(device.interval) || 5
            ) * 1000;
            var timeout = (Number(device.expires_in) || 1800) * 1000;
            var started = Date.now();

            function pollCredentials() {
                if (Date.now() - started > timeout) {
                    return Promise.reject(new Error(
                        'Время авторизации истекло. Попробуй снова.'
                    ));
                }

                var credentialsParams = new URLSearchParams();
                credentialsParams.set('client_id', PUBLIC_CLIENT_ID);
                credentialsParams.set('code', device.device_code);

                return request(
                    proxyUrl(OAUTH + 'device/credentials?' +
                        credentialsParams.toString()),
                    { method: 'GET' }
                ).catch(function (error) {
                    if (/HTTP 400|authorization_pending|slow_down|HTTP 403|HTTP 404/i.test(
                        error.message
                    )) {
                        return delay(interval).then(pollCredentials);
                    }
                    throw error;
                });
            }

            return pollCredentials().then(function (credentials) {
                if (!credentials.client_id ||
                    !credentials.client_secret) {
                    throw new Error(
                        'RD не вернул client_id/client_secret.'
                    );
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

    function normalizeHash(value) {
        return String(value || '').trim().toLowerCase();
    }

    function extractHash(item) {
        if (!item) return '';

        var values = [
            item.hash,
            item.info_hash,
            item.infoHash,
            item.torrent_hash,
            item.magnet
        ];

        for (var i = 0; i < values.length; i++) {
            var value = String(values[i] || '');
            var magnet = value.match(/btih:([a-f0-9]{40})/i);
            if (magnet) return magnet[1].toLowerCase();

            var hash = value.match(/\b[a-f0-9]{40}\b/i);
            if (hash) return hash[0].toLowerCase();
        }
        return '';
    }

    function extractTitle(item) {
        return item.title || item.name || item.release ||
            item.original_title || 'Без названия';
    }

    /*
     * Поиск через API Jackett-совместимых публичных индексаторов,
     * по логике запроса из плагина TorBox.
     */
    function parserSearch(parser, query, originalTitle, year) {
        var title = String(query || '').trim();
        var original = String(originalTitle || '').trim();
        var searchYear = String(year || '').trim().slice(0, 4);
        var queryBase = (title + ' ' + searchYear).trim();

        var params = new URLSearchParams({
            Query: queryBase,
            title: title,
            title_original: original,
            Category: '2000,5000'
        });

        if (parser.key) params.set('apikey', parser.key);
        if (searchYear) params.set('year', searchYear);

        var url = 'https://' + parser.url +
            '/api/v2.0/indexers/all/results?' + params.toString();

        return request(proxyUrl(url)).then(function (data) {
            if (data && Array.isArray(data.Results)) return data.Results;
            if (Array.isArray(data)) return data;
            if (data && Array.isArray(data.results)) return data.results;
            if (data && Array.isArray(data.items)) return data.items;
            if (data && Array.isArray(data.data)) return data.data;
            return [];
        });
    }

    function searchParsers(query, originalTitle, year) {
        var results = [];
        var errors = [];

        return PARSERS.reduce(function (chain, parser) {
            return chain.then(function () {
                return parserSearch(
                    parser, query, originalTitle, year
                ).then(function (items) {
                    items.forEach(function (item) {
                        item._parser = parser.name;
                        results.push(item);
                    });
                }).catch(function (error) {
                    errors.push(parser.name + ': ' + error.message);
                });
            });
        }, Promise.resolve()).then(function () {
            return { items: results, errors: errors };
        });
    }

    function checkHash(hash, auth) {
        var url = RD_API + 'torrents/instantAvailability/' +
            encodeURIComponent(hash);

        return request(proxyUrl(url), {
            headers: {
                Authorization: 'Bearer ' + auth.access_token
            }
        }).then(function (data) {
            var item = data && data[hash];

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

                if (result.error &&
                    /HTTP 401|bad_token|HTTP 403|disabled_endpoint|HTTP 429|too_many_requests/i.test(
                        result.error
                    )) {
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

        panel.querySelector('#rd-connect').onclick = function () {
            setStatus('Ожидаю авторизацию RD…');

            connectAuth().then(function (result) {
                setStatus('Подключено: ' +
                    (result.user.username || result.user.email || 'OK'));
            }).catch(function (error) {
                setStatus('Ошибка подключения: ' + error.message);
            });
        };

        panel.querySelector('#rd-check').onclick = function () {
            setStatus('Проверяю RD…');

            getWorkingAuth().then(function (result) {
                setStatus('RD работает: ' +
                    (result.user.username || result.user.email || 'OK'));
            }).catch(function (error) {
                setStatus('Проверка не пройдена: ' + error.message);
            });
        };

        panel.querySelector('#rd-disconnect').onclick = function () {
            clearAuth();
            setStatus('Локальная авторизация удалена. Подключи RD заново.');
        };

        panel.querySelector('#rd-search').onclick = function () {
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

                    if (!items.length) {
                        setStatus(
                            'Релизы не найдены.\n' +
                            (search.errors.join('\n') || 'Нет результатов.')
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
                        ' уникальных hash в RD…'
                    );

                    return checkHashes(
                        hashes,
                        authResult.auth,
                        function (done, total) {
                            setStatus('Проверка RD: ' + done + ' из ' + total);
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
                                (item._parser || 'Парсер') + ' · ' + resultText;
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
                            }).length;

                        if (checked.stopReason) {
                            summary += '\nПроверка остановлена: ' +
                                checked.stopReason;
                        }

                        if (search.errors.length) {
                            summary += '\nОшибки парсеров:\n' +
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

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi ||
            typeof Lampa.SettingsApi.addComponent !== 'function' ||
            typeof Lampa.SettingsApi.addParam !== 'function' ||
            SETTINGS_REGISTERED) {
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
                'rd_oauth_start_v2',
                'Подключить Real-Debrid',
                'Авторизация через официальный сайт Real-Debrid',
                function () {
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
                    getWorkingAuth().then(function (result) {
                        var user = result.user || {};
                        notify(
                            'RD работает: ' +
                            (user.username || user.email || user.id || 'OK')
                        );
                    }).catch(function (error) {
                        notify('Проверка RD не пройдена: ' + error.message);
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
                'Поиск на MaxVol и JacRed с проверкой кэша RD',
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

        if (Lampa.SettingsApi &&
            typeof Lampa.SettingsApi.addComponent === 'function' &&
            typeof Lampa.SettingsApi.addParam === 'function') {
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
    }
})();
