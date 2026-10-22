(function () {
    'use strict';

    var PLUGIN_NAME = 'Real-Debrid Bridge';
    var PLUGIN_VERSION = '1.2.1';
    var COMPONENT = 'rd_bridge';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
    var RD_API = 'https://api.real-debrid.com/rest/1.0/';
    var OAUTH = 'https://api.real-debrid.com/oauth/v2/';
    var PUBLIC_CLIENT_ID = 'X245A4XAIBGVM';
    var STORE = 'rd_bridge_oauth_v2';
    var PARSERS = [
        { name: 'MaxVol', url: 'https://jr.maxvol.pro' },
        { name: 'JacRed', url: 'https://jacred.xyz' }
    ];
    var MAX_HASH_CHECKS = 10;
    var HASH_CHECK_DELAY = 5000;
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
                    var reason = data.error_description || data.error ||
                        data.message || response.statusText ||
                        'Неизвестная ошибка';

                    var error = new Error(
                        'HTTP ' + response.status + ': ' +
                        String(reason).slice(0, 220)
                    );

                    error.status = response.status;
                    error.apiError = data.error || '';
                    error.errorCode = data.error_code;
                    throw error;
                }

                return data;
            });
        });
    }

    function postForm(url, values) {
        var body = new URLSearchParams();

        Object.keys(values).forEach(function (key) {
            if (values[key] !== undefined &&
                values[key] !== null &&
                values[key] !== '') {
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

    // GET с параметрами в URL.
    function getWithParams(url, values) {
        var params = new URLSearchParams();

        Object.keys(values).forEach(function (key) {
            if (values[key] !== undefined &&
                values[key] !== null &&
                values[key] !== '') {
                params.set(key, String(values[key]));
            }
        });

        var separator = url.indexOf('?') === -1 ? '?' : '&';

        return request(url + separator + params.toString(), {
            method: 'GET'
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
                'Нет данных для обновления токена. ' +
                'Если профиль перестал работать, подключи RD заново.'
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
            return {
                auth: auth,
                user: user
            };
        }).catch(function (error) {
            if (!/HTTP 401|bad_token|unauthorized/i.test(error.message)) {
                throw error;
            }

            return refreshAccessToken(auth).then(function (updated) {
                return profile(updated.access_token).then(function (user) {
                    return {
                        auth: updated,
                        user: user
                    };
                });
            });
        });
    }

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    /*
     * OAuth:
     * device/code         — GET
     * device/credentials  — GET
     * token               — POST
     */
    function connectAuth() {
        var deviceUrl = proxyUrl(OAUTH + 'device/code');

        return getWithParams(deviceUrl, {
            client_id: PUBLIC_CLIENT_ID,
            new_credentials: 'yes'
        }).then(function (device) {
            if (!device.device_code) {
                throw new Error('RD не вернул device_code.');
            }

            notify(
                'Открой страницу авторизации RD:\n' +
                (device.verification_url ||
                    'https://real-debrid.com/device') +
                '\n\nКод: ' + (device.user_code || '') +
                '\n\nПодтверди устройство, затем вернись в Lampa.'
            );

            var interval = Math.max(
                5,
                Number(device.interval) || 5
            ) * 1000;

            var timeout = (
                Number(device.expires_in) || 1800
            ) * 1000;

            var started = Date.now();

            function pollCredentials() {
                if (Date.now() - started > timeout) {
                    return Promise.reject(new Error(
                        'Время авторизации истекло. Попробуй снова.'
                    ));
                }

                return getWithParams(
                    proxyUrl(OAUTH + 'device/credentials'),
                    {
                        client_id: PUBLIC_CLIENT_ID,
                        code: device.device_code
                    }
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
                if (!credentials.client_id ||
                    !credentials.client_secret) {
                    throw new Error(
                        'RD не вернул client_id/client_secret.'
                    );
                }

                // Обмен кода на токен остаётся POST.
                return postForm(proxyUrl(OAUTH + 'token'), {
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret,
                    code: device.device_code,
                    grant_type:
                        'http://oauth.net/grant_type/device/1.0'
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

                        return {
                            auth: auth,
                            user: user
                        };
                    });
                });
            });
        });
    }

    function normalizeHash(value) {
        return String(value || '').trim().toLowerCase();
    }

    function extractHash(item) {
        if (!item) return '';

        var values = [
            item.InfoHash, item.infohash, item.info_hash, item.infoHash,
            item.hash, item.torrent_hash, item.magnet, item.MagnetUri,
            item.magnetUri, item.Magnet, item.link, item.Link
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
        return item.Title || item.title || item.name ||
            item.release || item.original_title ||
            item.title_original || 'Без названия';
    }

    function normalizeParserResults(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.Results)) return data.Results;
        if (data && Array.isArray(data.results)) return data.results;
        if (data && Array.isArray(data.items)) return data.items;
        if (data && Array.isArray(data.data)) return data.data;
        return [];
    }

    function parserSearch(parser, query) {
        var params = new URLSearchParams();

        params.set('Query', query);
        params.set('title', query);
        params.set('title_original', query);
        params.set('Category', '2000,5000');

        var url = parser.url.replace(/\/+$/, '') +
            '/api/v2.0/indexers/all/results?' + params.toString();

        return request(proxyUrl(url), {
            method: 'GET'
        }).then(function (data) {
            return normalizeParserResults(data).map(function (item) {
                item._parser = parser.name;
                return item;
            });
        });
    }

    function searchParsers(query) {
        var results = [];
        var errors = [];

        return PARSERS.reduce(function (chain, parser) {
            return chain.then(function () {
                return parserSearch(parser, query).then(function (items) {
                    results = results.concat(items);
                }).catch(function (error) {
                    errors.push(
                        parser.name + ' (' + parser.url + '): ' +
                        error.message
                    );
                });
            });
        }, Promise.resolve()).then(function () {
            return {
                items: results,
                errors: errors
            };
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
            var item = data && (data[hash] || data[hash.toUpperCase()]);

            return {
                hash: hash,
                available: !!(
                    item && item.rd && Object.keys(item.rd).length
                ),
                error: ''
            };
        }).catch(function (error) {
            return {
                hash: hash,
                available: false,
                error: error.message,
                status: error.status,
                apiError: error.apiError
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
        var endpointDisabled = false;

        function next(index) {
            if (index >= unique.length || stopped) {
                return Promise.resolve({
                    results: results,
                    total: unique.length,
                    stopped: stopped,
                    stopReason: stopReason,
                    endpointDisabled: endpointDisabled
                });
            }

            return checkHash(unique[index], auth).then(function (result) {
                results.push(result);

                if (onProgress) {
                    onProgress(index + 1, unique.length, result);
                }

                if (result.error && /disabled_endpoint/i.test(result.error)) {
                    stopped = true;
                    endpointDisabled = true;
                    stopReason =
                        'Real-Debrid отклонил instantAvailability: disabled_endpoint.';
                } else if (
                    result.error &&
                    /HTTP 429|too_many_requests/i.test(result.error)
                ) {
                    stopped = true;
                    stopReason =
                        'Real-Debrid ограничил частоту запросов (429). Проверка остановлена.';
                } else if (
                    result.error &&
                    /HTTP 401|bad_token/i.test(result.error)
                ) {
                    stopped = true;
                    stopReason =
                        'Real-Debrid отклонил токен (401). Проверь авторизацию.';
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
                    stopReason: stopReason,
                    endpointDisabled: endpointDisabled
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
            '<div class="rd-bridge-title">Real-Debrid — поиск и кэш</div>' +
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
                setStatus(
                    'Подключено: ' +
                    (result.user.username || result.user.email || 'OK')
                );
            }).catch(function (error) {
                setStatus('Ошибка подключения: ' + error.message);
            });
        };

        panel.querySelector('#rd-check').onclick = function () {
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
            var query = panel.querySelector('#rd-query').value.trim();

            if (!query) {
                notify('Введи название фильма или сериала.');
                return;
            }

            results.innerHTML = '';
            setStatus('Проверяю авторизацию…');

            getWorkingAuth().then(function (authResult) {
                setStatus('Ищу релизы на MaxVol и JacRed…');

                return searchParsers(query).then(function (search) {
                    var items = search.items;

                    if (!items.length) {
                        setStatus(
                            'Релизы не найдены.\n' +
                            (search.errors.join('\n') ||
                                'Парсеры вернули пустой ответ.') +
                            '\n\nПроверь доступность парсеров через Worker.'
                        );
                        return;
                    }

                    var itemHashes = [];
                    var hashes = [];

                    items.forEach(function (item) {
                        var hash = extractHash(item);
                        itemHashes.push(hash);
                        if (hash) hashes.push(hash);
                    });

                    setStatus(
                        'Найдено: ' + items.length +
                        '. Проверяю до ' + MAX_HASH_CHECKS +
                        ' уникальных хэшей RD (пауза ' +
                        (HASH_CHECK_DELAY / 1000) + ' с)…'
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
                                resultText = 'Hash не найден в ответе парсера';
                            } else if (!check) {
                                resultText = 'Не проверено';
                            } else if (check.error) {
                                resultText = 'Ошибка RD: ' + check.error;
                            } else {
                                resultText = check.available
                                    ? 'Есть в кэше RD'
                                    : 'Кэш не подтверждён';
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

                        var successes = checked.results.filter(function (r) {
                            return !r.error;
                        }).length;

                        var cached = checked.results.filter(function (r) {
                            return !r.error && r.available;
                        }).length;

                        var summary =
                            'Найдено: ' + items.length +
                            ' · Проверено RD: ' + checked.results.length +
                            ' · Успешных ответов RD: ' + successes +
                            ' · Кэш подтверждён: ' + cached;

                        if (checked.endpointDisabled) {
                            summary +=
                                '\n\nВАЖНО: endpoint instantAvailability недоступен (disabled_endpoint). ' +
                                'Нулевой кэш не означает, что раздачи отсутствуют в кэше. ' +
                                'Проверка остановлена, чтобы не отправлять заведомо бесполезные запросы.';
                        } else if (checked.stopReason) {
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
        root.style.cssText
