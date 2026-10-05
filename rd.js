(function () {
    'use strict';

    function startPlugin() {
        Lampa.Noty.show('LAMPA RD TEST — работает');

        Lampa.Settings.add({
            title: 'Real-Debrid TEST',
            component: 'rd_test',
            icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
        });

        console.log('[RD TEST] loaded');
    }

    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                startPlugin();
            }
        });
    }
})();
