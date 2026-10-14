(function () {
    'use strict';
    if (window.__rd_card_button_only) return;
    window.__rd_card_button_only = true;
    function notify(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show(message);
        }
    }
    function addButton(e) {
        if (!e || e.type !== 'complite' || !e.data || !e.data.movie) {
            return;
        }
        var root = e.object &&
            e.object.activity &&
            e.object.activity.render
            ? e.object.activity.render()
            : null;
        if (!root || !root.length || !window.jQuery) return;
        if (root.find('.view--realdebrid').length) return;
        var movie = e.data.movie;
        var title = movie.title ||
            movie.name ||
            movie.original_title ||
            '';
        if (!title) return;
        var button = window.jQuery(
            '<div class="full-start__button selector view--realdebrid">' +
            '<span>Real-Debrid</span></div>'
        );
        button.on('hover:enter', function () {
            var saved = false;
            try {
                var data = JSON.parse(
                    localStorage.getItem('rd_bridge_oauth_v2') || '{}'
                );
                saved = !!data.access_token;
            } catch (err) {}
            if (!saved) {
                notify('Сначала подключи Real-Debrid в настройках.');
                return;
            }
            notify(
                'Real-Debrid: ' + title +
                '. Кнопка работает; поиск и воспроизведение подключим следующим этапом.'
            );
        });
        var torrentButton = root.find('.view--torrent');
        if (torrentButton.length) {
            torrentButton.after(button);
        } else {
            var playButton = root.find('.full-start__play');
            if (playButton.length) {
                playButton.after(button);
            } else {
                root.find('.full-start__buttons').append(button);
            }
        }
    }
    function boot() {
        if (!window.Lampa || !Lampa.Listener) return;
        if (window.__rd_card_button_listener) return;
        window.__rd_card_button_listener = true;
        Lampa.Listener.follow('full', addButton);
    }
    if (window.Lampa && Lampa.Activity) {
        boot();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') boot();
        });
    }
})();