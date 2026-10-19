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

function parseResponse(response) {
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
        (data.error_description ||
         data.error ||
         data.message ||
         text ||
         response.statusText)
      );
    }

    return data;
  });
}

function req(url, access, options) {
  options = options || {};

  var headers = Object.assign(
    { Accept: 'application/json' },
    options.headers || {}
  );

  if (access) headers.Authorization = 'Bearer ' + access;

  return fetch(PROXY + '?url=' + encodeURIComponent(url), {
    method: options.method || 'GET',
    headers: headers,
    body: options.body
  }).then(parseResponse);
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

function normalizeImdb(value) {
  var match = String(value || '').match(/tt\d+/i);
  return match ? match[0].toLowerCase() : '';
}

function getImdbId(movie) {
  movie = movie || {};

  var ids = movie.ids || {};
  var external = movie.external_ids || {};
  var candidates = [
    movie.imdb_id,
    movie.imdbId,
    movie.imdb,
    movie.imdbid,
    ids.imdb,
    ids.imdb_id,
    external.imdb_id,
    movie.source && movie.source.imdb_id
  ];

  for (var i = 0; i < candidates.length; i++) {
    var id = normalizeImdb(candidates[i]);
    if (id) return id;
  }

  return '';
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

function checkDMM(imdbId, hashes, access) {
  if (!imdbId) {
    return Promise.reject(
      new Error('Не удалось определить IMDb ID фильма')
    );
  }

  if (!hashes || !hashes.length) {
    return Promise.reject(
      new Error('Нет хэшей для проверки')
    );
  }

  return fetch(PROXY + '?action=dmm-availability', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + access,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      imdbId: imdbId,
      hashes: hashes.slice(0, 100)
    })
  }).then(parseResponse);
}

/*
 * Ищет результат для конкретного hash в ответе DMM.
 * Если структура ответа неизвестна, не делает ложных выводов.
 */
function findHashResult(data, hash) {
  var wanted = String(hash || '').toLowerCase();
  var found = null;
  var seen = [];

  function walk(value) {
    if (!value || typeof value !== 'object' || found) return;
    if (seen.indexOf(value) !== -1) return;
    seen.push(value);

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    var currentHash = value.hash || value.infoHash ||
      value.info_hash || value.torrentHash || value.torrent_hash;

    if (currentHash && String(currentHash).toLowerCase() === wanted) {
      found = value;
      return;
    }

    if (Object.prototype.hasOwnProperty.call(value, wanted)) {
      found = value[wanted];
      return;
    }

    Object.keys(value).forEach(function (key) {
      if (key.toLowerCase() === wanted) {
        found = value[key];
      }
    });

    if (found) return;

    Object.keys(value).forEach(function (key) {
      walk(value[key]);
    });
  }

  walk(data);
  return found;
}

function classifyCache(result) {
  if (result === true) return 'cached';
  if (result === false || result == null) return 'unknown';

  if (typeof result === 'string') {
    var s = result.toLowerCase();

    if (['cached', 'available', 'instant', 'ready', 'true'].indexOf(s) !== -1) {
      return 'cached';
    }

    if (['not_cached', 'uncached', 'unavailable', 'false'].indexOf(s) !== -1) {
      return 'not-cached';
    }

    return 'unknown';
  }

  if (typeof result !== 'object') return 'unknown';

  var positiveKeys = [
    'cached', 'available', 'instantAvailability',
    'instant_availability', 'isCached', 'is_cached'
  ];

  for (var i = 0; i < positiveKeys.length; i++) {
    var key = positiveKeys[i];

    if (typeof result[key] === 'boolean') {
      return result[key] ? 'cached' : 'not-cached';
    }
  }

  var status = String(
    result.status || result.state || result.availability || ''
  ).toLowerCase();

  if (['cached', 'available', 'instant', 'ready'].indexOf(status) !== -1) {
    return 'cached';
  }

  if (['not_cached', 'uncached', 'unavailable'].indexOf(status) !== -1) {
    return 'not-cached';
  }

  return 'unknown';
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
  }).then(parseResponse).then(function (data) {
    if (!data || data.id == null || !/^\d+$/.test(String(data.id))) {
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
    result.appendChild(label);

    var copy = document.createElement('button');
    copy.textContent = 'Скопировать ID';
    copy.style.cssText =
      'margin-top:8px;padding:8px 12px;border:0;border-radius:6px';

    copy.onclick = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(id).then(function () {
          note('RD_USER_ID скопирован.');
        }).catch(function () {
          note('RD_USER_ID: ' + id);
        });
      } else {
        note('RD_USER_ID: ' + id);
      }
    };

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
 * Проверяет хэши через DMM.
 * Проверка кэша не добавляет торрент в аккаунт Real-Debrid.
 */
function runCacheCheck(items, imdbId, access, screen) {
  var status = screen.querySelector('#rd-status');
  var labels = screen.querySelectorAll('[data-cache-hash]');

  if (!imdbId) {
    status.textContent =
      'Кэш не проверен: у фильма не найден IMDb ID.';
    return;
  }

  if (!items.length) {
    status.textContent = 'Нет раздач для проверки.';
    return;
  }

  status.textContent =
    'Проверяем кэш DMM · IMDb: ' + imdbId + '…';

  var hashes = items.map(function (item) {
    return item.hash;
  }).slice(0, 100);

  checkDMM(imdbId, hashes, access).then(function (data) {
    if (!screen.isConnected) return;

    var cachedCount = 0;
    var notCachedCount = 0;
    var unknownCount = 0;

    items.forEach(function (item) {
      var node = screen.querySelector(
        '[data-cache-hash="' + item.hash + '"]'
      );
      if (!node) return;

      var result = findHashResult(data, item.hash);
      var state = classifyCache(result);

      if (state === 'cached') {
        node.textContent = '⚡ Есть в базе доступности DMM';
        node.style.color = '#72e6a2';
        cachedCount++;
      } else if (state === 'not-cached') {
        node.textContent = 'Нет подтверждения кэша в DMM';
        node.style.color = '#ffca76';
        notCachedCount++;
      } else {
        node.textContent = 'Ответ DMM получен, статус не распознан';
        node.style.color = '#ffc766';
        unknownCount++;
      }
    });

    status.textContent =
      'DMM ответил · IMDb: ' + imdbId +
      ' · подтверждено: ' + cachedCount +
      ' · без подтверждения: ' + notCachedCount +
      ' · неизвестно: ' + unknownCount;

    var diag = screen.querySelector('#rd-dmm-diagnostic');
    if (diag) {
      diag.textContent = JSON.stringify(data, null, 2);
    }
  }).catch(function (err) {
    if (!screen.isConnected) return;

    status.textContent = 'Ошибка проверки DMM: ' + err.message;

    screen.querySelectorAll('[data-cache-hash]').forEach(function (node) {
      node.textContent = 'Ошибка проверки DMM';
      node.style.color = '#ff8585';
    });

    var diag = screen.querySelector('#rd-dmm-diagnostic');
    if (diag) diag.textContent = err.message;
  });
}

/*
 * Добавляет магнит в RD и выбирает все файлы.
 */
function testOne(item, button, resultNode) {
  var access = token();

  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }

  var magnet = item.magnet || magnetOf(item);

  if (!magnet) {
    resultNode.textContent = 'Не удалось получить magnet-ссылку или hash.';
    return;
  }

  if (!window.confirm(
    'Добавить раздачу в Real-Debrid?\n\n' +
    item.title + '\n\n' +
    'Магнит будет отправлен в твой аккаунт RD. Продолжить?'
  )) return;

  button.disabled = true;
  button.textContent = 'Отправляем в RD…';
  resultNode.textContent = 'Создаём задачу…';

  postForm(RD + 'torrents/addMagnet', access, {
    magnet: magnet
  }).then(function (response) {
    if (!response || !response.id) {
      throw new Error('RD не вернул ID задачи: ' + JSON.stringify(response));
    }

    var id = response.id;

    resultNode.textContent =
      'Задача создана: ' + id + '\nВыбираем все файлы…';

    return postForm(
      RD + 'torrents/selectFiles/' + encodeURIComponent(id),
      access,
      { files: 'all' }
    ).then(function () {
      return req(
        RD + 'torrents/info/' + encodeURIComponent(id),
        access
      );
    }).then(function (info) {
      resultNode.textContent =
        statusText(info.status) + '\nID задачи RD: ' + id;

      button.textContent = 'Задача создана';
      button.disabled = true;
    }).catch(function (err) {
      resultNode.textContent =
        'Задача RD создана: ' + id +
        '\nОшибка выбора файлов или проверки: ' + err.message +
        '\nПроверь задачу в Real-Debrid вручную, прежде чем повторять добавление.';

      button.textContent = 'Задача создана';
      button.disabled = true;
    });
  }).catch(function (err) {
    resultNode.textContent =
      'Ошибка добавления: ' + err.message +
      '\nЕсли задача появилась в RD, не отправляй магнит повторно, пока не проверишь её список задач.';

    button.textContent = 'Ошибка добавления';
    button.disabled = true;
  });
}

function openSearch(query, movie) {
  var access = token();

  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }

  var imdbId = getImdbId(movie);
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
        'DMM проверяет только те хэши, которые переданы в запросе. ' +
        'Отсутствие результата не доказывает, что раздача недоступна в RD.' +
      '</div>' +
      '<div id="rd-results"></div>' +
      '<details style="margin-top:16px;padding:12px;background:#292929;border-radius:8px">' +
        '<summary>Ответ DMM / диагностика</summary>' +
        '<pre id="rd-dmm-diagnostic" style="white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace"></pre>' +
      '</details>' +
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
    if (!screen.isConnected) return;

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

    var box = screen.querySelector('#rd-results');
    var details = document.createElement('details');
    details.style.cssText =
      'margin:14px 0;padding:12px;background:#292929;border-radius:8px';

    var summary = document.createElement('summary');
    summary.textContent = 'Диагностика поиска';
    details.appendChild(summary);

    var pre = document.createElement('pre');
    pre.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;font:13px monospace';

    pre.textContent =
      'IMDb ID: ' + (imdbId || 'не найден в объекте фильма') +
      '\nРезультаты парсеров:\n' +
      PARSERS.map(function (p) {
        return p + ': ' + (parserCounts[p] || 0) + ' релизов';
      }).join('\n') +
      (parserErrors.length ? '\nОшибки:\n' + parserErrors.join('\n') : '');

    details.appendChild(pre);
    box.appendChild(details);

    if (!all.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Раздачи не найдены. Проверь название или доступность парсера.';
      box.appendChild(empty);
      screen.querySelector('#rd-status').textContent = 'Раздачи не найдены.';
      return;
    }

    all.forEach(function (item) {
      var card = document.createElement('div');
      card.style.cssText =
        'padding:14px;margin:10px 0;background:#303030;' +
        'border-radius:8px;line-height:1.5;overflow-wrap:anywhere';

      var title = document.createElement('div');
      title.style.cssText = 'font-weight:600;margin-bottom:6px';
      title.textContent = item.title;
      card.appendChild(title);

      var meta = document.createElement('div');
      meta.style.cssText = 'opacity:.75;font-size:.9em';

      var bits = [];
      if (item.size) bits.push(formatSize(item.size));
      if (item.seeders) bits.push('Сиды: ' + item.seeders);
      if (item.tracker) bits.push(item.tracker);
      meta.textContent = bits.join(' · ');
      card.appendChild(meta);

      var cacheLabel = document.createElement('div');
      cacheLabel.setAttribute('data-cache-hash', item.hash);
      cacheLabel.style.cssText =
        'margin-top:6px;color:#ffc766;font-size:.9em';
      cacheLabel.textContent = 'Ожидаем проверку DMM…';
      card.appendChild(cacheLabel);

      var button = document.createElement('button');
      button.textContent = 'Добавить и выбрать файлы';
      button.style.cssText =
        'margin-top:10px;padding:10px 14px;border:0;' +
        'border-radius:6px;background:#7a5cff;color:#fff;cursor:pointer';

      var result = document.createElement('div');
      result.style.cssText =
        'margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.9em';

      button.onclick = function () {
        testOne(item, button, result);
      };

      card.appendChild(button);
      card.appendChild(result);
      box.appendChild(card);
    });

    runCacheCheck(all, imdbId, access, screen);
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
    openSearch(title, movie);
  });

  button.on('click', function () {
    openSearch(title, movie);
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
