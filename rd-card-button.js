(function () {
'use strict';
if (window.__rd_card_button_search) return;
window.__rd_card_button_search = true;
var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
var RD = 'https://api.real-debrid.com/rest/1.0/';
var STORE = 'rd_bridge_oauth_v2';
var PARSERS = ['https://jr.maxvol.pro', 'https://jac.red'];
function token() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}').access_token || '';
  } catch (e) {
    return '';
  }
}
function note(s) {
  if (window.Lampa && Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(s);
}
function req(url, access) {
  var h = { Accept: 'application/json' };
  if (access) h.Authorization = 'Bearer ' + access;
  return fetch(PROXY + '?url=' + encodeURIComponent(url), { headers: h })
    .then(function (r) {
      return r.text().then(function (t) {
        var d;
        try {
          d = t ? JSON.parse(t) : {};
        } catch (e) {
          d = { message: t };
        }
        if (!r.ok) {
          var err = new Error(d.error || d.message || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return d;
      });
    });
}
function hashOf(x) {
  var h = x.InfoHash || x.infoHash || x.info_hash || x.Hash || x.hash || '';
  if (/^[a-f0-9]{40}$/i.test(String(h))) return String(h).toLowerCase();
  var m = String(
    x.MagnetUri || x.magnetUri || x.magnet || x.link || x.Link || ''
  ).match(/urn:btih:([a-f0-9]{40})/i);
  return m ? m[1].toLowerCase() : '';
}
function search(host, q) {
  var url = host +
    '/api/v2.0/indexers/all/results?Query=' +
    encodeURIComponent(q) + '&Category=2000,5000';
  return req(url).then(function (d) {
    var a = Array.isArray(d) ? d : (d.Results || d.results || []);
    return a.map(function (x) {
      return {
        title: x.Title || x.title || x.Name || x.name || 'Без названия',
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
function cached(hash, access) {
  return req(RD + 'torrents/instantAvailability/' + hash, access)
    .then(function (d) {
      var e = d[hash] || d[hash.toUpperCase()] || d[hash.toLowerCase()];
      if (!e) {
        return {
          ok: false,
          reason: 'В ответе RD нет ключа с hash',
          responseKeys: Object.keys(d || {}).slice(0, 10).join(', ')
        };
      }
      if (!e.rd) {
        return {
          ok: false,
          reason: 'В ответе RD нет поля rd',
          responseKeys: Object.keys(e).join(', ')
        };
      }
      var slots = Array.isArray(e.rd) ? e.rd : [e.rd];
      // Сохраняем структуру ответа для диагностики.
      var rdKeys = [];
      var yes = slots.some(function (slot) {
        if (!slot || typeof slot !== 'object') return false;
        rdKeys = rdKeys.concat(Object.keys(slot));
        return Object.keys(slot).some(function (k) {
          var v = slot[k];
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === 'number') return v > 0;
          return !!v && typeof v === 'object' &&
            Object.keys(v).length > 0;
        });
      });
      return {
        ok: yes,
        reason: yes ? '' : 'Поле rd есть, но файлы не распознаны',
        entryKeys: Object.keys(e).join(', '),
        rdKeys: rdKeys.slice(0, 20).join(', ')
      };
    })
    .catch(function (err) {
      return {
        ok: false,
        error: true,
        reason: (err.status ? 'HTTP ' + err.status + ': ' : '') +
          (err.message || String(err))
      };
    });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
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
        '<h2>Real-Debrid — кэш</h2>' +
        '<button id="rd-close">Закрыть</button>' +
      '</div>' +
      '<p id="rd-status">Ищем: ' + esc(query) + '</p>' +
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
    screen.querySelector('#rd-status').textContent =
      'Найдено релизов: ' + all.length +
      '. Проверяем первые 60 через RD…';
    return Promise.all(all.slice(0, 60).map(function (item) {
      return cached(item.hash, access).then(function (result) {
        return { item: item, result: result };
      });
    })).then(function (checks) {
      return { total: all.length, checks: checks };
    });
  }).then(function (data) {
    if (!screen.isConnected || !data) return;
    var checks = data.checks;
    var results = checks.filter(function (x) {
      return x.result.ok;
    }).map(function (x) {
      return x.item;
    });
    var errors = checks.filter(function (x) {
      return x.result.error;
    });
    var noHash = checks.filter(function (x) {
      return !x.result.ok &&
        !x.result.error &&
        x.result.reason === 'В ответе RD нет ключа с hash';
    }).length;
    var noFiles = checks.filter(function (x) {
      return !x.result.ok &&
        !x.result.error &&
        x.result.reason !== 'В ответе RD нет ключа с hash';
    }).length;
    var status = screen.querySelector('#rd-status');
    var box = screen.querySelector('#rd-results');
    status.textContent =
      'Найдено: ' + data.total +
      ' · Проверено RD: ' + checks.length +
      ' · Кэш: ' + results.length +
      ' · Ошибки API: ' + errors.length;
    var details = document.createElement('details');
    details.style.cssText =
      'margin:14px 0;padding:12px;background:#292929;' +
      'border-radius:8px;line-height:1.5';
    var summary = document.createElement('summary');
    summary.textContent = 'Диагностика — нажми, чтобы раскрыть';
    details.appendChild(summary);
    var pre = document.createElement('pre');
    pre.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;' +
      'font:13px monospace;margin-top:10px';
    pre.textContent =
      'Результаты парсеров:\n' +
      PARSERS.map(function (p) {
        return p + ': ' + (parserCounts[p] || 0) + ' релизов';
      }).join('\n') +
      '\n\nПроверка Real-Debrid:\n' +
      'Всего найдено: ' + data.total + '\n' +
      'Проверено (максимум 60): ' + checks.length + '\n' +
      'Кэш распознан: ' + results.length + '\n' +
      'Ответ без ключа hash: ' + noHash + '\n' +
      'Ответ без распознанных файлов: ' + noFiles + '\n' +
      'Ошибки запросов RD: ' + errors.length +
      (errors.length
        ? '\nПримеры ошибок:\n' +
          errors.slice(0, 5).map(function (x) {
            return x.result.reason;
          }).join('\n')
        : '') +
      (noFiles
        ? '\n\nПримеры структуры ответа RD:\n' +
          checks.filter(function (x) {
            return !x.result.ok && !x.result.error;
          }).slice(0, 3).map(function (x) {
            return x.result.reason +
              (x.result.entryKeys ? '; ключи: ' + x.result.entryKeys : '') +
              (x.result.rdKeys ? '; ключи rd: ' + x.result.rdKeys : '');
          }).join('\n')
        : '') +
      (parserErrors.length
        ? '\n\nОшибки парсеров:\n' + parserErrors.join('\n')
        : '');
    details.appendChild(pre);
    box.appendChild(details);
    if (!results.length) {
      var empty = document.createElement('p');
      empty.textContent =
        'Кэш не подтверждён. Раскрой блок «Диагностика» выше — там причина.';
      box.appendChild(empty);
      return;
    }
    results.forEach(function (x) {
      var card = document.createElement('div');
      card.style.cssText =
        'padding:14px;margin:10px 0;background:#303030;' +
        'border-radius:8px;line-height:1.5';
      var meta = [];
      if (x.size) meta.push(formatSize(x.size));
      if (x.seeders) meta.push('Сиды: ' + x.seeders);
      if (x.tracker) meta.push(x.tracker);
      card.innerHTML =
        '<div style="font-weight:600">⚡ ' + esc(x.title) + '</div>' +
        (meta.length
          ? '<div style="opacity:.75;font-size:.9em">' +
            meta.map(esc).join(' · ') + '</div>'
          : '');
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
  if (!e || e.type !== 'complite' || !e.data || !e.data.movie) return;
  var root = e.object && e.object.activity && e.object.activity.render
    ? e.object.activity.render()
    : null;
  if (!root || !root.length || !window.jQuery ||
      root.find('.view--realdebrid').length) return;
  var movie = e.data.movie;
  var title = movie.title || movie.name || movie.original_title || '';
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
  if (!window.Lampa || !Lampa.Listener || window.__rd_card_listener) return;
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