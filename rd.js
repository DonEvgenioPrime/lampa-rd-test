(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';

    function notify(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show(message);
        } else {
            window.alert(message);
        }
    }

    function proxied(target) {
        return PROXY + '?url=' + encodeURIComponent(target);
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi || window.__rd_bridge_loaded) {
            return;
        }

        window.__rd_bridge_loaded = true;

        Lampa.SettingsApi.addComponent({
            component: COMPONENT,
            name: 'Real-Debrid (тест)',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="2"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_bridge_info',
                type: 'static',
                default: ''
            },
            field: {
                name: 'Статус',
                description: 'Тестовая версия: авторизация и поиск ещё не реализованы.'
            }
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_bridge_proxy_test',
                type: 'button',
                values: ''
            },
            field: {
                name: 'Проверить связь с Real-Debrid',
                description: 'Запрос без токена; ожидается HTTP 401 от RD.'
            },
            onChange: function () {
                fetch(
                    proxied('https://api.real-debrid.com/rest/1.0/user'),
                    {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json'
                        }
                    }
                ).then(function (response) {
                    if (response.status === 401) {
                        notify(
                            'Связь работает: Real-Debrid ожидает авторизацию (HTTP 401).'
                        );
                    } else if (response.ok) {
                        notify(
                            'API ответил успешно, но это не подтверждает вход в аккаунт.'
                        );
                    } else {
                        response.text().then(function (body) {
                            notify(
                                'Ответ прокси: HTTP ' +
                                response.status +
                                (body ? ' — ' + body.slice(0, 120) : '')
                            );
                        });
                    }
                }).catch(function (err) {
                    notify(
                        'Проверка не пройдена: ' +
                        (err.message || err)
                    );
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_bridge_auth_notice',
                type: 'static',
                default: ''
            },
            field: {
                name: 'Авторизация',
                description: 'OAuth-кнопка будет добавлена после проверки официальных параметров приложения. Не вставляйте API-токен в настройки.'
            }
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_bridge_about',
                type: 'button',
                values: ''
            },
            field: {
                name: 'О текущей версии',
                description: 'Показать реализованные функции'
            },
            onChange: function () {
                notify(
                    'Сейчас доступна только проверка связи с RD API через Worker. OAuth, поиск JacRed/MaxVol и фильтр кеша ещё не реализованы.'
                );
            }
        });
    }

    if (window.Lampa && Lampa.SettingsApi) {
        addSettings();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') {
                addSettings();
            }
        });
    } else {
        var tries = 0;

        var timer = setInterval(function () {
            tries++;

            if (window.Lampa && Lampa.SettingsApi) {
                clearInterval(timer);
                addSettings();
            } else if (tries > 40) {
                clearInterval(timer);
            }
        }, 250);
    }
})();
