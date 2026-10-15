(function () {
'use strict';
if (window.__rd_card_button_search) return;
window.__rd_card_button_search = true;
var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
var STORE = 'rd_bridge_oauth_v2';
// Оставляем только проверенный источник.
// jacred.xyz сейчас возвращает ошибку и не используется.
var PARSERS = ['https://jr.maxvol.pro'];
function token() {
  try {
    return JSON.parse(
      localStorage.getItem(STORE) || '{}'
    ).access_token || '';
  } catch (e) {
    return '';
  }
}
function note(s) {
  if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
    Lampa.Noty.show(s);
  }
}
function req(url, access) {
  var h = { Accept: 'application/json' };
  if (access) h.Authorization = 'Bearer ' + access;
  return fetch(
    PROXY + '?url=' + encodeURIComponent(url),
    { headers: h }
  ).then(function (r) {
    return r.text().then(function (t) {
      var d;
      try {
        d = t ? JSON.parse(t) : {};
      } catch (e) {
        d = { message: t };
      }
      if (!r.ok) {
        var err = new Error(
          d.error || d.message || ('HTTP ' + r.status)
        );
        err.status = r.status;
        throw err;
      }
      return d;
    });
  });
}
function hashOf(x) {
  var h = x.InfoHash || x.infoHash ||
    x.info_hash || x.Hash || x.hash || '';
  if (/^[a-f0-9]{40}$/i.test(String(h))) {
    return String(h).toLowerCase();
  }
  var m = String(
    x.MagnetUri || x.magnetUri ||
    x.magnet || x.link || x.Link || ''
  ).match(/urn:btih:([a-f0-9]{40})/i);
  return m ? m[1].toLowerCase() : '';
}
function search(host, q) {
  var url = host +
    '/api/v2.0/indexers/all/results?Query=' +
    encodeURIComponent(q) +
    '&Category=2000,5000';
  return req(url).then(function (d) {
    var a = Array.isArray(d)
      ? d
      : (d.Results || d.results || []);
    return a.map(function (x) {
      return {
        title: x.Title || x.title ||
          x.Name || x.name || 'Без названия',
        hash: hashOf(x),
        size: x.Size || x.size || 0,
        seeders: x.Seeders || x.seeders || 0,
        tracker: x.Tracker || x.tracker || '',
        raw: x
      };
    }).filter(function (x) {
      return x.hash;
    });
  });
}
// ВАЖНО:
// torrents/instantAvailability отключён со стороны RD.
// Не делаем запросы к этому endpoint и не выдаём
// ошибку API за отсутствие кэша.
function cached() {
  return Promise.resolve({
    available: null,
    unsupported: true,
    reason: 'Автоматическая проверка кэша RD через instantAvailability недоступна'
  });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>\"]/g, function (c) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[c];
  });
}
function formatSize(n) {
  n = Number(n);
  if (!n) return '';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}
function openSearch(query) {
  var access = token();
  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }
  var old = document.getElementById('rd-card-search');
  if (old) old.remove();
  var screen = document.createElement('div');
  screen.id = 'rd-card-search';
  screen.style.cssText =
    'position:fixed;z-index:999999;inset:0;overflow:auto;' +
    'background:#171717;color:#fff;padding:20px;box-sizing:border-box;' +
    'font:16px Arial,sans-serif';
  screen.innerHTML =
    '<div style="max-width:950px;margin:auto">' +
      '<div style="display:flex;justify-content:space-between;' +
      'align-items:center;gap:12px">' +
        '<h2>Real-Debrid — поиск раздач</h2>' +
        '<button id="rd-close">Закрыть</button>' +
      '</div>' +
      '<p id="rd-status">Ищем: ' + esc(query) + '</p>' +
      '<div style="padding:12px;background:#333;border-radius:8px;' +
      'line-height:1.5">' +
        'Проверка кэша RD временно недоступна: ' +
        'старый API endpoint отключён. Результаты поиска ' +
        'не означают, что раздача есть или отсутствует в кэше.' +
      '</div>' +
      '<div id="rd-results"></div>' +
    '</div>';
  document.body.appendChild(screen);
  screen.querySelector('#rd-close').onclick = function () {
    screen.remove();
  };
  var parserCounts = {};
  var parserErrors = [];
  Promise.all(PARSERS.map(function (host) {
    return search(host, query).then(function (rows) {
      parserCounts[host] = rows.length;
      return rows;
    }).catch(function (err) {
      parserCounts[host] = 0;
      parserErrors.push(host + ': ' + err.message);
      return [];
    });
  })).then(function (groups) {
    if (!screen.isConnected) return null;
    var seen = {};
    var all = [];
    groups.forEach(function (group) {
      group.forEach(function (item) {
        if (!seen[item.hash]) {
          seen[item.hash] = true;
          all.push(item);
        }
      });
    });
    return {
      total: all.length,
      items: all
    };
  }).then(function (data) {
    if (!screen.isConnected || !data) return;
    var status = screen.querySelector('#rd-status');
    var box = screen.querySelector('#rd-results');
    status.textContent =
      'Найдено релизов: ' + data.total +
      ' · Кэш RD: не проверен';
    var details = document.createElement('details');
    details.style.cssText =
      'margin:14px 0;padding:12px;background:#292929;' +
      'border-radius:8px;line-height:1.5';
    var summary = document.createElement('summary');
    summary.textContent = 'Диагностика';
    details.appendChild(summary);
    var pre = document.createElement('pre');
    pre.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;' +
      'font:13px monospace;margin-top:10px';
    pre.textContent =
      'Результаты парсеров:\n' +
      PARSERS.map(function (p) {
        return p + ': ' + (parserCounts[p] || 0) +
          ' релизов';
      }).join('\n') +
      '\n\nПроверка Real-Debrid:\n' +
      'Статус: не проверено.\n' +
      'Причина: endpoint instantAvailability отключён.\n' +
      'Запросы проверки кэша не выполнялись.' +
      (parserErrors.length
        ? '\n\nОшибки парсеров:\n' + parserErrors.join('\n')
        : '');
    details.appendChild(pre);
    box.appendChild(details);
    if (!data.items.length) {
      var empty = document.createElement('p');
      empty.textContent =
        'Раздачи не найдены. Проверь название или доступность парсера.';
      box.appendChild(empty);
      return;
    }
    data.items.forEach(function (x) {
      var card = document.createElement('div');
      card.style.cssText =
        'padding:14px;margin:10px 0;background:#303030;' +
        'border-radius:8px;line-height:1.5';
      var meta = [];
      if (x.size) meta.push(formatSize(x.size));
      if (x.seeders) meta.push('Сиды: ' + x.seeders);
      if (x.tracker) meta.push(x.tracker);
      card.innerHTML =
        '<div style="font-weight:600">⚡ ' +
        esc(x.title) + '</div>' +
        (meta.length
          ? '<div style="opacity:.75;font-size:.9em">' +
            meta.map(esc).join(' · ') + '</div>'
          : '') +
        '<div style="margin-top:6px;color:#ffc766;font-size:.9em">' +
        'Кэш RD: не проверен</div>';
      box.appendChild(card);
    });
  }).catch(function (err) {
    if (screen.isConnected) {
      screen.querySelector('#rd-status').textContent =
        'Ошибка поиска: ' + err.message;
    }
  });
}
function addButton(e) {
  if (!e || e.type !== 'complite' ||
      !e.data || !e.data.movie) return;
  var root = e.object && e.object.activity &&
    e.object.activity.render
      ? e.object.activity.render()
      : null;
  if (!root || !root.length || !window.jQuery ||
      root.find('.view--realdebrid').length) return;
  var movie = e.data.movie;
  var title = movie.title || movie.name ||
    movie.original_title || '';
  if (!title) return;
  var button = window.jQuery(
    '<div class="full-start__button selector view--realdebrid">' +
    '<span>Real-Debrid</span></div>'
  );
  button.on('hover:enter', function () {
    openSearch(title);
  });
  button.on('click', function () {
    openSearch(title);
  });
  var torrent = root.find('.view--torrent');
  if (torrent.length) {
    torrent.after(button);
  } else {
    var play = root.find('.full-start__play');
    if (play.length) play.after(button);
    else root.find('.full-start__buttons').append(button);
  }
}
function boot() {
  if (!window.Lampa || !Lampa.Listener ||
      window.__rd_card_listener) return;
  window.__rd_card_listener = true;
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