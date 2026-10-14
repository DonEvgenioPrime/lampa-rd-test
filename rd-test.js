(function () {
    'use strict';
    var PLUGIN_NAME = 'Real-Debrid Bridge';
    var PLUGIN_VERSION = '1.0.3';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
    var RD_API = 'https://api.real-debrid.com/rest/1.0/';
    var OAUTH = 'https://api.real-debrid.com/oauth/v2/';
    var PUBLIC_CLIENT_ID = 'X245A4XAIBGVM';
    var STORE = 'rd_bridge_oauth_v2';
    var PARSERS = [
        'https://jr.maxvol.pro',
        'https://jac.red'
    ];
    var MAX_HASH_CHECKS = 10;
    var HASH_CHECK_DELAY = 700;
    var stylesAdded = false;
    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[' + PLUGIN_NAME + ']');
        console.log.apply(console, args);
    }
    function notify(message) {
        if (typeof Lampa !== 'undefined' &&
            Lampa.Noty &&
            typeof Lampa.Noty.show === 'function') {
            Lampa.Noty.show(message);
        } else {
            alert(message);
        }
    }
    function request(url, options) {
        options = options || {};
        return fetch(url, options).then(function (response) {
            return response.text().then(function (text) {
                var data = {};
                try {
                    data = text ? JSON.parse(text) : {};
                } catch (e) {
                    data = { error: text || 'Empty response' };
                }
                if (!response.ok) {
                    var message =
                        data.error_description ||
                        data.error ||
                        data.message ||
                        text ||
                        response.statusText;
                    throw new Error(
                        'HTTP ' + response.status + ': ' + message
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
    function proxyUrl(url) {
        return PROXY + '?url=' + encodeURIComponent(url);
    }
    function getStoredAuth() {
        try {
            var raw = localStorage.getItem(STORE);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            log('Не удалось прочитать сохранённую авторизацию', e);
            return null;
        }
    }
    function saveAuth(auth) {
        localStorage.setItem(STORE, JSON.stringify(auth));
    }
    function clearAuth() {
        localStorage.removeItem(STORE);
    }
    function profile(accessToken) {
        return request(proxyUrl(RD_API + 'user'), {
            headers: {
                Authorization: 'Bearer ' + accessToken
            }
        });
    }
    /*
     * ВАЖНО:
     * Для OAuth Device Flow Real-Debrid ожидает:
     * code = сохранённый refresh_token
     * grant_type = http://oauth.net/grant_type/device/1.0
     */
    function refreshAccessToken(saved) {
        if (!saved ||
            !saved.refresh_token ||
            !saved.client_id ||
            !saved.client_secret) {
            return Promise.reject(
                new Error(
                    'Нет данных для обновления токена. ' +
                    'Отключи и заново подключи Real-Debrid.'
                )
            );
        }
        return postForm(OAUTH + 'token', {
            client_id: saved.client_id,
            client_secret: saved.client_secret,
            code: saved.refresh_token,
            grant_type: 'http://oauth.net/grant_type/device/1.0'
        }).then(function (tokens) {
            if (!tokens.access_token) {
                throw new Error(
                    'Real-Debrid не вернул новый access_token.'
                );
            }
            var updated = Object.assign({}, saved, {
                access_token: tokens.access_token,
                refresh_token:
                    tokens.refresh_token || saved.refresh_token,
                expires_in: Number(tokens.expires_in) || 0,
                obtained_at: Date.now()
            });
            saveAuth(updated);
            return updated;
        });
    }
    function getWorkingAuth() {
        var saved = getStoredAuth();
        if (!saved || !saved.access_token) {
            return Promise.reject(
                new Error('Real-Debrid не подключён.')
            );
        }
        return profile(saved.access_token).then(function (user) {
            return {
                auth: saved,
                user: user
            };
        }).catch(function (error) {
            if (!/HTTP 401|bad_token|unauthorized/i.test(error.message)) {
                throw error;
            }
            log('Access token недействителен, пробую обновить');
            return refreshAccessToken(saved).then(function (updated) {
                return profile(updated.access_token).then(function (user) {
                    return {
                        auth: updated,
                        user: user
                    };
                });
            });
        });
    }
    function beginDeviceAuth() {
        return postForm(OAUTH + 'device/code', {
            client_id: PUBLIC_CLIENT_ID,
            new_credentials: 'yes'
        }).then(function (device) {
            if (!device.device_code) {
                throw new Error(
                    'Real-Debrid не вернул device_code.'
                );
            }
            var verificationUrl =
                device.direct_verification_url ||
                device.verification_url ||
                'https://real-debrid.com/device';
            var userCode = device.user_code || '';
            var message =
                'Открой страницу авторизации Real-Debrid:\n\n' +
                verificationUrl +
                '\n\nКод: ' + userCode +
                '\n\nПосле подтверждения вернись в Lampa.';
            if (confirm(message)) {
                window.open(verificationUrl, '_blank');
            }
            notify(
                'Подтверди подключение Real-Debrid. ' +
                'Ожидаю авторизацию…'
            );
            return pollDeviceToken(device, verificationUrl);
        });
    }
    function pollDeviceToken(device, verificationUrl) {
        var interval = Number(device.interval) || 5;
        var expiresIn = Number(device.expires_in) || 600;
        var startedAt = Date.now();
        function poll() {
            if (Date.now() - startedAt > expiresIn * 1000) {
                throw new Error(
                    'Время авторизации истекло. Попробуй подключиться снова.'
                );
            }
            return postForm(OAUTH + 'device/credentials', {
                client_id: PUBLIC_CLIENT_ID,
                code: device.device_code
            }).then(function (credentials) {
                if (!credentials.client_id ||
                    !credentials.client_secret) {
                    throw new Error(
                        'Real-Debrid не вернул данные клиента.'
                    );
                }
                return postForm(OAUTH + 'token', {
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret,
                    code: device.device_code,
                    grant_type: 'http://oauth.net/grant_type/device/1.0'
                }).then(function (tokens) {
                    if (!tokens.access_token) {
                        throw new Error(
                            'Real-Debrid не вернул access_token.'
                        );
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
                            'Real-Debrid подключён: ' +
                            (user.username || user.email || 'OK')
                        );
                        return {
                            auth: auth,
                            user: user
                        };
                    });
                });
            }).catch(function (error) {
                var message = String(error.message || '');
                if (/authorization_pending|slow_down|HTTP 400/i.test(message)) {
                    return new Promise(function (resolve) {
                        setTimeout(resolve, interval * 1000);
                    }).then(poll);
                }
                throw error;
            });
        }
        return poll();
    }
    function checkAuth() {
        notify('Проверяю подключение Real-Debrid…');
        return getWorkingAuth().then(function (result) {
            var user = result.user || {};
            var username =
                user.username ||
                user.email ||
                user.id ||
                'подключение активно';
            notify('Real-Debrid OK: ' + username);
            return result;
        }).catch(function (error) {
            notify('Проверка RD не пройдена: ' + error.message);
            throw error;
        });
    }
    function connectAuth() {
        notify('Подключаю Real-Debrid…');
        return beginDeviceAuth().catch(function (error) {
            notify('Ошибка подключения RD: ' + error.message);
            throw error;
        });
    }
    function apiRequest(path, auth) {
        return request(proxyUrl(RD_API + path), {
            headers: {
                Authorization: 'Bearer ' + auth.access_token
            }
        });
    }
    function normalizeHash(hash) {
        return String(hash || '').trim().toLowerCase();
    }
    function getTorrentInfo(hash, auth) {
        hash = normalizeHash(hash);
        if (!hash) {
            return Promise.resolve({
                hash: hash,
                available: false,
                error: 'Пустой hash'
            });
        }
        return apiRequest(
            'torrents/instantAvailability/' + encodeURIComponent(hash),
            auth
        ).then(function (data) {
            var available = false;
            if (data && data[hash]) {
                var item = data[hash];
                available = !!(
                    item.rd &&
                    Object.keys(item.rd).length
                );
            }
            return {
                hash: hash,
                available: available,
                data: data
            };
        }).catch(function (error) {
            return {
                hash: hash,
                available: false,
                error: error.message
            };
        });
    }
    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }
    function checkHashesSequentially(hashes, auth) {
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
        function next(index) {
            if (index >= unique.length) {
                return Promise.resolve(results);
            }
            return getTorrentInfo(unique[index], auth).then(function (result) {
                results.push(result);
                if (index + 1 < unique.length) {
                    return delay(HASH_CHECK_DELAY).then(function () {
                        return next(index + 1);
                    });
                }
                return results;
            });
        }
        return next(0);
    }
    function extractHash(item) {
        if (!item) return '';
        var candidates = [
            item.hash,
            item.info_hash,
            item.infoHash,
            item.torrent_hash,
            item.magnet
        ];
        for (var i = 0; i < candidates.length; i++) {
            var value = String(candidates[i] || '');
            var magnetMatch = value.match(/btih:([a-f0-9]{40})/i);
            if (magnetMatch) return magnetMatch[1].toLowerCase();
            var hashMatch = value.match(/\b[a-f0-9]{40}\b/i);
            if (hashMatch) return hashMatch[0].toLowerCase();
        }
        return '';
    }
    function extractTitle(item) {
        if (!item) return 'Без названия';
        return item.title ||
            item.name ||
            item.release ||
            item.original_title ||
            'Без названия';
    }
    function parserSearch(parser, query) {
        var url = parser.replace(/\/$/, '') +
            '/api/v1/search?query=' +
            encodeURIComponent(query);
        return request(proxyUrl(url)).then(function (data) {
            if (Array.isArray(data)) return data;
            if (data && Array.isArray(data.results)) return data.results;
            if (data && Array.isArray(data.items)) return data.items;
            if (data && Array.isArray(data.data)) return data.data;
            return [];
        });
    }
    function searchParsers(query) {
        var all = [];
        var errors = [];
        return PARSERS.reduce(function (chain, parser) {
            return chain.then(function () {
                return parserSearch(parser, query).then(function (items) {
                    items.forEach(function (item) {
                        item._parser = parser;
                        all.push(item);
                    });
                }).catch(function (error) {
                    errors.push(parser + ': ' + error.message);
                    log('Ошибка парсера', parser, error.message);
                });
            });
        }, Promise.resolve()).then(function () {
            return {
                items: all,
                errors: errors
            };
        });
    }
    function addStyles() {
        if (stylesAdded) return;
        stylesAdded = true;
        var css = [
            '.rd-bridge-panel{padding:16px;color:inherit}',
            '.rd-bridge-row{padding:12px;margin:8px 0;border-radius:8px;background:rgba(127,127,127,.12)}',
            '.rd-bridge-title{font-weight:600;margin-bottom:6px}',
            '.rd-bridge-meta{font-size:12px;opacity:.75;overflow-wrap:anywhere}',
            '.rd-bridge-button{display:inline-block;padding:10px 14px;margin:4px;border-radius:6px;background:#7a5cff;color:#fff;cursor:pointer;border:0}',
            '.rd-bridge-button:disabled{opacity:.5}',
            '.rd-bridge-status{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}',
            '.rd-bridge-input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;color:inherit;background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.35);border-radius:6px}'
        ].join('');
        var style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }
    function createPanel() {
        addStyles();
        var panel = document.createElement('div');
        panel.className = 'rd-bridge-panel';
        panel.innerHTML =
            '<div class="rd-bridge-title">Real-Debrid Bridge</div>' +
            '<div class="rd-bridge-status" id="rd-bridge-status">' +
            'Готов к работе. Версия ' + PLUGIN_VERSION +
            '</div>' +
            '<button class="rd-bridge-button" id="rd-bridge-connect">' +
            'Подключить RD</button>' +
            '<button class="rd-bridge-button" id="rd-bridge-check">' +
            'Проверить подключение</button>' +
            '<button class="rd-bridge-button" id="rd-bridge-disconnect">' +
            'Отключить RD</button>' +
            '<hr>' +
            '<input class="rd-bridge-input" id="rd-bridge-query" ' +
            'placeholder="Название фильма или сериала">' +
            '<button class="rd-bridge-button" id="rd-bridge-search">' +
            'Найти раздачи</button>' +
            '<div id="rd-bridge-results"></div>';
        var status = panel.querySelector('#rd-bridge-status');
        var results = panel.querySelector('#rd-bridge-results');
        function setStatus(text) {
            status.textContent = text;
        }
        panel.querySelector('#rd-bridge-connect').onclick = function () {
            setStatus('Ожидаю авторизацию Real-Debrid…');
            connectAuth().then(function (result) {
                var user = result.user || {};
                setStatus(
                    'Подключено: ' +
                    (user.username || user.email || user.id || 'OK')
                );
            }).catch(function (error) {
                setStatus('Ошибка: ' + error.message);
            });
        };
        panel.querySelector('#rd-bridge-check').onclick = function () {
            setStatus('Проверяю подключение…');
            checkAuth().then(function (result) {
                var user = result.user || {};
                setStatus(
                    'Подключение работает: ' +
                    (user.username || user.email || user.id || 'OK')
                );
            }).catch(function (error) {
                setStatus('Ошибка: ' + error.message);
            });
        };
        panel.querySelector('#rd-bridge-disconnect').onclick = function () {
            clearAuth();
            setStatus('Локальные данные авторизации удалены.');
            notify('Real-Debrid отключён в плагине.');
        };
        panel.querySelector('#rd-bridge-search').onclick = function () {
            var query = panel.querySelector('#rd-bridge-query').value.trim();
            if (!query) {
                notify('Введи название фильма или сериала.');
                return;
            }
            results.innerHTML = '';
            setStatus('Ищу раздачи…');
            getWorkingAuth().then(function (result) {
                var auth = result.auth;
                return searchParsers(query).then(function (search) {
                    var items = search.items;
                    if (!items.length) {
                        setStatus(
                            'Ничего не найдено.\n' +
                            (search.errors.length
                                ? search.errors.join('\n')
                                : 'Парсеры не вернули результатов.')
                        );
                        return;
                    }
                    var hashes = [];
                    var hashByItem = [];
                    items.forEach(function (item) {
                        var hash = extractHash(item);
                        hashByItem.push(hash);
                        if (hash) hashes.push(hash);
                    });
                    setStatus(
                        'Найдено раздач: ' + items.length +
                        '. Проверяю до ' + MAX_HASH_CHECKS +
                        ' hash в Real-Debrid…'
                    );
                    return checkHashesSequentially(hashes, auth).then(
                        function (checked) {
                            var byHash = {};
                            checked.forEach(function (result) {
                                byHash[result.hash] = result;
                            });
                            items.forEach(function (item, index) {
                                var hash = hashByItem[index];
                                var check = hash ? byHash[hash] : null;
                                var row = document.createElement('div');
                                row.className = 'rd-bridge-row';
                                var title = document.createElement('div');
                                title.className = 'rd-bridge-title';
                                title.textContent = extractTitle(item);
                                var meta = document.createElement('div');
                                meta.className = 'rd-bridge-meta';
                                var parser = item._parser || 'Парсер';
                                var statusText = !hash
                                    ? 'Hash не найден'
                                    : !check
                                        ? 'Не проверено (лимит проверки)'
                                        : check.error
                                            ? 'Ошибка RD: ' + check.error
                                            : check.available
                                                ? 'Есть в кэше RD'
                                                : 'В кэше не найдено';
                                meta.textContent = parser + ' · ' + statusText;
                                row.appendChild(title);
                                row.appendChild(meta);
                                if (hash) {
                                    var hashLine = document.createElement('div');
                                    hashLine.className = 'rd-bridge-meta';
                                    hashLine.textContent = 'Hash: ' + hash;
                                    row.appendChild(hashLine);
                                }
                                results.appendChild(row);
                            });
                            setStatus(
                                'Поиск завершён. Результатов: ' + items.length +
                                '. Проверено hash: ' + checked.length + '.'
                            );
                            if (search.errors.length) {
                                setStatus(
                                    status.textContent + '\n' +
                                    'Ошибки парсеров:\n' +
                                    search.errors.join('\n')
                                );
                            }
                        }
                    );
                });
            }).catch(function (error) {
                setStatus('Ошибка поиска: ' + error.message);
            });
        };
        return panel;
    }
    function addLampaPlugin() {
        if (typeof Lampa === 'undefined') {
            log('Lampa ещё не загружена');
            return;
        }
        var panel = createPanel();
        /*
         * Панель можно открыть из консоли браузера через:
         * window.rdBridgeOpen()
         *
         * Интеграция в меню зависит от сборки Lampa.
         * Не добавляем неизвестные пункты API, чтобы не ломать запуск.
         */
        window.rdBridgeOpen = function () {
            var old = document.getElementById('rd-bridge-root');
            if (old) old.remove();
            var root = document.createElement('div');
            root.id = 'rd-bridge-root';
            root.style.position = 'fixed';
            root.style.zIndex = '99999';
            root.style.inset = '5% 5%';
            root.style.overflow = 'auto';
            root.style.background = '#171717';
            root.style.color = '#fff';
            root.style.borderRadius = '12px';
            root.style.boxShadow = '0 0 0 100vmax rgba(0,0,0,.65)';
            var close = document.createElement('button');
            close.className = 'rd-bridge-button';
            close.textContent = 'Закрыть';
            close.onclick = function () {
                root.remove();
            };
            root.appendChild(close);
            root.appendChild(panel.cloneNode(true));
            document.body.appendChild(root);
            /*
             * Назначаем обработчики заново для клонированной панели.
             */
            root.remove();
            var liveRoot = document.createElement('div');
            liveRoot.id = 'rd-bridge-root';
            liveRoot.style.cssText = root.style.cssText;
            var livePanel = createPanel();
            var liveClose = document.createElement('button');
            liveClose.className = 'rd-bridge-button';
            liveClose.textContent = 'Закрыть';
            liveClose.onclick = function () {
                liveRoot.remove();
            };
            liveRoot.appendChild(liveClose);
            liveRoot.appendChild(livePanel);
            document.body.appendChild(liveRoot);
        };
        log('Загружен', PLUGIN_VERSION);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addLampaPlugin);
    } else {
        addLampaPlugin();
    }
})();