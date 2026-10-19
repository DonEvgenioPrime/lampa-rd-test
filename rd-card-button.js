(function () {
'use strict';

if (window.__rd_card_button_search) return;
window.__rd_card_button_search = true;

var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
var RD = 'https://api.real-debrid.com/rest/1.0/';
var STORE = 'rd_bridge_oauth_v2';
var PARSERS = ['https://jr.maxvol.pro'];

function token() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}').access_token || '';
  } catch (e) {
    return '';
  }
}

function note(s) {
  if (window.Lampa && Lampa.Noty && Lampa.Noty.show) {
    Lampa.Noty.show(s);
  }
}

function req(url, access, options) {
  options = options || {};

  var headers = Object.assign(
    { Accept: 'application/json' },
    options.headers || {}
  );

  if (access) headers.Authorization = 'Bearer ' + access;

  return fetch(
    PROXY + '?url=' + encodeURIComponent(url),
    {
      method: options.method || 'GET',
      headers: headers,
      body: options.body
    }
  ).then(function (r) {
    return r.text().then(function (t) {
      var data;

      try {
        data = t ? JSON.parse(t) : {};
      } catch (e) {
        data = { message: t };
      }

      if (!r.ok) {
        throw new Error(
          'HTTP ' + r.status + ': ' +
          (data.error_description ||
           data.error ||
           data.message ||
           r.statusText ||
           'Ошибка')
        );
      }

      return data;
    });
  });
}

function postForm(url, access, values) {
  var body = new URLSearchParams();

  Object.keys(values).forEach(function (key) {
    if (values[key] !== undefined && values[key] !== null) {
      body.set(key, String(values[key]));
    }
  });

  return req(url, access, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
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

function magnetOf(item) {
  var raw = item.raw || {};

  var candidates = [
    raw.MagnetUri,
    raw.magnetUri,
    raw.magnet,
    raw.Magnet,
    raw.link,
    raw.Link,
    raw.downloadUrl,
    raw.DownloadUrl
  ];

  for (var i = 0; i < candidates.length; i++) {
    var value = String(candidates[i] || '').trim();

    if (/^magnet:\?/i.test(value) && /urn:btih:/i.test(value)) {
      return value;
    }
  }

  if (!item.hash || !/^[a-f0-9]{40}$/i.test(item.hash)) {
    return '';
  }

  return 'magnet:?xt=urn:btih:' +
    item.hash +
    '&dn=' + encodeURIComponent(item.title || 'Torrent');
}

function search(host, q) {
  var url = host +
    '/api/v2.0/indexers/all/results?Query=' +
    encodeURIComponent(q) +
    '&Category=2000,5000';

  return req(url).then(function (data) {
    var list = Array.isArray(data)
      ? data
      : (data.Results || data.results || []);

    return list.map(function (x) {
      var item = {
        title: x.Title || x.title || x.Name || x.name || 'Без названия',
        hash: hashOf(x),
        size: x.Size || x.size || 0,
        seeders: x.Seeders || x.seeders || 0,
        tracker: x.Tracker || x.tracker || '',
        raw: x
      };

      item.magnet = magnetOf(item);

      return item;
    }).filter(function (item) {
      return !!item.hash;
    });
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

function statusText(status) {
  var labels = {
    magnet_conversion: 'RD обрабатывает магнит',
    waiting_files_selection: 'Ожидается выбор файлов',
    queued: 'Задача в очереди',
    downloading: 'RD загружает раздачу',
    downloaded: 'RD сообщает: загружено',
    error: 'RD сообщил об ошибке',
    virus: 'RD пометил раздачу как опасную',
    compressing: 'RD обрабатывает файлы',
    uploading: 'RD обрабатывает файлы',
    dead: 'Раздача недоступна'
  };

  return labels[status] || ('Статус RD: ' + (status || 'неизвестен'));
}

/*
 * Получает числовой ID аккаунта Real-Debrid через Worker.
 * OAuth-токен не отображается на экране.
 */
function getRDUserId(screen, button) {
  var access = token();

  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Получаем ID…';

  fetch(PROXY + '?action=rd-user-id', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + access
    }
  }).then(function (response) {
    return response.text().then(function (text) {
      var data;

      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = { message: text };
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
          data.message ||
          text ||
          ('HTTP ' + response.status)
        );
      }

      return data;
    });
  }).then(function (data) {
    if (
      !data ||
      data.id == null ||
      !/^\d+$/.test(String(data.id))
    ) {
      throw new Error('Worker не вернул числовой ID аккаунта.');
    }

    var id = String(data.id);
    var old = screen.querySelector('#rd-user-id-result');

    if (old) old.remove();

    var result = document.createElement('div');

    result.id = 'rd-user-id-result';
    result.style.cssText =
      'padding:12px;margin:12px 0;background:#173b2b;' +
      'border-radius:8px;overflow-wrap:anywhere;line-height:1.5';

    var label = document.createElement('div');
    label.textContent = 'Твой RD_USER_ID: ' + id;

    var copy = document.createElement('button');
    copy.textContent = 'Скопировать ID';
    copy.style.cssText =
      'margin-top:8px;padding:8px 12px;border:0;' +
      'border-radius:6px;cursor:pointer';

    copy.onclick = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(id).then(function () {
          note('RD_USER_ID скопирован.');
        }).catch(function () {
          note('ID: ' + id);
        });
      } else {
        note('RD_USER_ID: ' + id);
      }
    };

    result.appendChild(label);
    result.appendChild(copy);

    screen.querySelector('#rd-status').after(result);

    button.textContent = 'ID получен';
    button.disabled = false;
  }).catch(function (err) {
    button.disabled = false;
    button.textContent = 'Получить RD_USER_ID';

    note('Не удалось получить ID: ' + err.message);
  });
}

/*
 * Добавляет магнит в RD и выбирает все файлы.
 * Повторно addMagnet после создания задачи не вызывается.
 */
function testOne(item, button, resultNode) {
  var access = token();

  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }

  var magnet = item.magnet || magnetOf(item);

  if (!magnet) {
    resultNode.textContent =
      'Не удалось получить magnet-ссылку или hash.';
    return;
  }

  var confirmed = window.confirm(
    'Добавить раздачу в Real-Debrid?\n\n' +
    item.title + '\n\n' +
    'Плагин отправит магнит в твой аккаунт RD, ' +
    'а затем попробует автоматически выбрать все файлы.\n\n' +
    'Продолжить?'
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Отправляем в RD…';
  resultNode.textContent = 'Создаём задачу…';

  postForm(RD + 'torrents/addMagnet', access, {
    magnet: magnet
  }).then(function (response) {
    if (!response || !response.id) {
      throw new Error(
        'RD не вернул ID задачи. Ответ: ' + JSON.stringify(response)
      );
    }

    var id = response.id;

    resultNode.textContent =
      'Задача создана: ' + id +
      '\nАвтоматически выбираем все файлы…';

    return postForm(
      RD + 'torrents/selectFiles/' + encodeURIComponent(id),
      access,
      { files: 'all' }
    ).then(function () {
      resultNode.textContent =
        'Все файлы переданы на выбор.\nПроверяем статус RD…';

      return req(
        RD + 'torrents/info/' + encodeURIComponent(id),
        access
      );
    }).then(function (info) {
      resultNode.textContent =
        statusText(info.status) +
        '\nID задачи RD: ' + id +
        (info.status === 'waiting_files_selection'
          ? '\nRD всё ещё ожидает выбора файлов. Возможно, Worker не передал запрос выбора.'
          : '') +
        (info.status === 'downloaded'
          ? '\nRD сообщает, что задача загружена.'
          : '') +
        '\n\nПроверка кэша RD отдельно не выполнялась.';

      button.textContent = 'Задача создана';
      button.disabled = true;
    }).catch(function (err) {
      resultNode.textContent =
        'Задача RD создана: ' + id +
        '\nОшибка автоматического выбора или проверки: ' + err.message +
        '\n\nПроверь эту задачу в Real-Debrid вручную. ' +
        'Не нажимай добавление повторно, чтобы не создать дубликат.';

      button.textContent = 'Задача создана';
      button.disabled = true;
    });
  }).catch(function (err) {
    resultNode.textContent =
      'Ошибка добавления: ' + err.message +
      '\nЕсли задача появилась в RD, не отправляй магнит повторно, ' +
      'пока не проверишь список задач.';

    button.textContent = 'Ошибка добавления';
    button.disabled = true;
  });
}

function openSearch(query) {
  if (!token()) {
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
      'align-items:center;gap:12px;flex-wrap:wrap">' +
        '<h2>Real-Debrid — поиск раздач</h2>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button id="rd-get-id">Получить RD_USER_ID</button>' +
          '<button id="rd-close">Закрыть</button>' +
        '</div>' +
      '</div>' +
      '<p id="rd-status">Ищем: ' + esc(query) + '</p>' +
      '<div style="padding:12px;background:#333;border-radius:8px;' +
      'line-height:1.5;margin-bottom:14px">' +
        'Кэш RD автоматически не проверяется. ' +
        'Метки кэша появятся после подключения DMM.' +
      '</div>' +
      '<div id="rd-results"></div>' +
    '</div>';

  document.body.appendChild(screen);

  screen.querySelector('#rd-close').onclick = function () {
    screen.remove();
  };

  screen.querySelector('#rd-get-id').onclick = function () {
    getRDUserId(screen, this);
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
        return p + ': ' + (parserCounts[p] || 0) + ' релизов';
      }).join('\n') +
      '\n\nПроверка кэша RD: не выполнялась.' +
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

    data.items.forEach(function (item) {
      var card = document.createElement('div');

      card.style.cssText =
        'padding:14px;margin:10px 0;background:#303030;' +
        'border-radius:8px;line-height:1.5;overflow-wrap:anywhere';

      var title = document.createElement('div');

      title.style.cssText =
        'font-weight:600;margin-bottom:6px';

      title.textContent = item.title;
      card.appendChild(title);

      var meta = document.createElement('div');

      meta.style.cssText =
        'opacity:.75;font-size:.9em';

      var bits = [];

      if (item.size) bits.push(formatSize(item.size));
      if (item.seeders) bits.push('Сиды: ' + item.seeders);
      if (item.tracker) bits.push(item.tracker);

      meta.textContent = bits.join(' · ');
      card.appendChild(meta);

      var cacheLabel = document.createElement('div');

      cacheLabel.style.cssText =
        'margin-top:6px;color:#ffc766;font-size:.9em';

      cacheLabel.textContent = 'Кэш RD: не проверен';
      card.appendChild(cacheLabel);

      var button = document.createElement('button');

      button.textContent = 'Добавить и выбрать файлы';
      button.style.cssText =
        'margin-top:10px;padding:10px 14px;border:0;' +
        'border-radius:6px;background:#7a5cff;color:#fff;cursor:pointer';

      var result = document.createElement('div');

      result.style.cssText =
        'margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;' +
        'font-size:.9em';

      button.onclick = function () {
        testOne(item, button, result);
      };

      card.appendChild(button);
      card.appendChild(result);
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

  var root = e.object && e.object.activity &&
    e.object.activity.render
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
