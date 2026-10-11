(function () {
    'use strict';

    var COMPONENT = 'rd_bridge';
    var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';

    function boot() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: COMPONENT,
            name: 'Real-Debrid',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_bridge_status',
                type: 'static',
                default: ''
            },
            field: {
                name: 'Проверка прокси',
                description: 'Нажми кнопку ниже для проверки'
            }
        });

        Lampa.SettingsApi.addParam({
            component: COMPONENT,
            param: {
                name: 'rd_bridge_test_button',
                type: 'button',
                values: ''
            },
            field: {
                name: 'Проверить прокси',
                description: 'Без использования токена Real-Debrid'
            },
            onChange: function () {
                var target = 'https://api.real-debrid.com/rest/1.0/user';
                var url = PROXY + '?url=' + encodeURIComponent(target);

                fetch(url, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                }).then(function (response) {
                    if (response.status === 401) {
                        Lampa.Noty.show(
                            'Прокси отвечает: RD требует авторизацию. Это ожидаемо.'
                        );
                    } else if (response.status === 200) {
                        Lampa.Noty.show('Прокси отвечает успешно.');
                    } else {
                        Lampa.Noty.show(
                            'Ответ прокси: HTTP ' + response.status
                        );
                    }
                }).catch(function (error) {
                    Lampa.Noty.show(
                        'Ошибка запроса: ' + (error.message || error)
                    );
                });
            }
        });
    }

    if (window.Lampa && Lampa.SettingsApi) {
        boot();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') boot();
        });
    }
})();
