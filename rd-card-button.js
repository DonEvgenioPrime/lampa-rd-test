(function () {
'use strict';

if (window.__rd_card_button_search) return;
window.__rd_card_button_search = true;

var PROXY_STORE = 'rd_bridge_worker_url_v1';
var RD = 'https://api.real-debrid.com/rest/1.0/';
var STORE = 'rd_bridge_oauth_v2';
var SORT_STORE = 'rd_card_button_sort_v1';

var SORT_OPTIONS = [
  { value: 'seeders', label: 'По сидам (убыв.)' },
  { value: 'size_desc', label: 'По размеру (убыв.)' },
  { value: 'size_asc', label: 'По размеру (возр.)' },
  { value: 'date', label: 'По дате добавления' }
];

/* ---------- Worker и Real-Debrid ---------- */

function getProxyUrl() {
  try {
    var value = (localStorage.getItem(PROXY_STORE) || '').trim();
    if (!value) return '';

    var url = new URL(value);
    if (url.protocol !== 'https:') return '';

    return url.href.replace(/\/+$/, '') + '/';
  } catch (e) {
    return '';
  }
}

function requireProxy() {
  var proxy = getProxyUrl();

  if (!proxy) {
    throw new Error(
      'Сначала укажи URL своего Cloudflare Worker в настройках Real-Debrid.'
    );
  }

  return proxy;
}

function token() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}').access_token || '';
  } catch (e) {
    return '';
  }
}

function getSortMode() {
  try {
    var value = localStorage.getItem(SORT_STORE) || 'size_asc';

    return SORT_OPTIONS.some(function (o) {
      return o.value === value;
    }) ? value : 'size_asc';
  } catch (e) {
    return 'size_asc';
  }
}

function setSortMode(value) {
  try {
    localStorage.setItem(SORT_STORE, value);
  } catch (e) {}
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
        (data.error_description || data.error || data.message ||
         text || response.statusText)
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

  var proxy;

  try {
    proxy = requireProxy();
  } catch (e) {
    return Promise.reject(e);
  }

  return fetch(proxy + '?url=' + encodeURIComponent(url), {
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

/* ---------- Настройки парсера из Lampa ---------- */

function lampaSetting(key, fallback) {
  try {
    if (
      window.Lampa &&
      Lampa.Storage &&
      typeof Lampa.Storage.get === 'function'
    ) {
      var value = Lampa.Storage.get(key, fallback);

      return value === undefined || value === null ? fallback : value;
    }
  } catch (e) {}

  return fallback;
}

function settingEnabled(value) {
  return value === true ||
    value === 'true' ||
    value === 1 ||
    value === '1';
}

/*
 * ИСПРАВЛЕНО:
 * URL без протокола всегда получает HTTPS.
 * Это необходимо, потому что Worker требует HTTPS.
 */
function normalizeParserUrl(value) {
  var url = String(value || '').trim();
  if (!url) return '';

  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    var parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      return '';
    }

    // Сохраняем путь установки Jackett, если он есть.
    return parsed.href.replace(/\/+$/, '');
  } catch (e) {
    return '';
  }
}

/*
 * Нормализация вариантов значения parser_use_link.
 * Адреса парсеров в плагине не прописываются.
 */
function normalizeLinkSelection(value) {
  value = String(value == null ? 'one' : value)
    .trim()
    .toLowerCase();

  if (['two', '2', 'secondary', 'second'].indexOf(value) !== -1) {
    return 'two';
  }

  if (
    ['both', 'all', '1,2', 'one_two'].indexOf(value) !== -1
  ) {
    return 'both';
  }

  return 'one';
}

function getParserSettingsDiagnostic() {
  return {
    parser_use: lampaSetting('parser_use', null),
    parser_torrent_type: lampaSetting('parser_torrent_type', null),
    parser_use_link: lampaSetting('parser_use_link', null),
    jackett_url: lampaSetting('jackett_url', ''),
    jackett_url_two: lampaSetting('jackett_url_two', ''),
    primaryKeyConfigured: !!lampaSetting('jackett_key', ''),
    secondaryKeyConfigured: !!lampaSetting('jackett_key_two', '')
  };
}

function getParserConfig() {
  var settings = getParserSettingsDiagnostic();

  var enabled = settingEnabled(settings.parser_use);
  var type = String(
    settings.parser_torrent_type || 'jackett'
  ).trim().toLowerCase();

  var primaryUrl = normalizeParserUrl(settings.jackett_url);
  var primaryKey = String(
    lampaSetting('jackett_key', '') || ''
  ).trim();

  var secondaryUrl = normalizeParserUrl(settings.jackett_url_two);
  var secondaryKey = String(
    lampaSetting('jackett_key_two', '') || ''
  ).trim();

  /*
   * ИСПРАВЛЕНО:
   * Если Lampa вернула пустой parser_use_link,
   * используем основную ссылку.
   */
  var selected = normalizeLinkSelection(
    settings.parser_use_link || 'one'
  );

  if (!enabled) {
    throw new Error(
      'Парсер отключён в Lampa. Включи «Использовать парсер» в настройках.'
    );
  }

  if (type !== 'jackett') {
    throw new Error(
      'Выбран тип парсера «' + type +
      '». Эта версия плагина использует API Jackett. ' +
      'Выбери Jackett в настройках Lampa.'
    );
  }

  var primary = primaryUrl ? {
    name: 'Основной',
    url: primaryUrl,
    key: primaryKey
  } : null;

  var secondary = secondaryUrl ? {
    name: 'Дополнительный',
    url: secondaryUrl,
    key: secondaryKey
  } : null;

  var parsers = [];

  if (selected === 'two') {
    if (secondary) {
      parsers.push(secondary);
    } else {
      throw new Error(
        'Выбрана дополнительная ссылка, но она не задана в настройках Lampa.'
      );
    }
  } else if (selected === 'both') {
    if (primary) parsers.push(primary);
    if (secondary) parsers.push(secondary);
  } else {
    if (primary) parsers.push(primary);
  }

  if (!parsers.length) {
    throw new Error(
      'Не найден адрес выбранного Jackett. Проверь ссылку в настройках Lampa.'
    );
  }

  var unique = [];
  var seen = {};

  parsers.forEach(function (parser) {
    var id = parser.url + '|' + parser.key;

    if (!seen[id]) {
      seen[id] = true;
      unique.push(parser);
    }
  });

  return {
    type: type,
    selected: selected,
    parsers: unique,
    settings: settings
  };
}

function buildJackettUrl(parser, query) {
  var url = parser.url.replace(/\/+$/, '') +
    '/api/v2.0/indexers/all/results';

  var params = new URLSearchParams();
  params.set('apikey', parser.key);
  params.set('Query', query);
  params.set('Category', '2000,5000');

  return url + '?' + params.toString();
}

/* ---------- Информация о фильме и magnet ---------- */

function normalizeImdb(value) {
  var match = String(value || '').match(/tt\d+/i);
  return match ? match[0].toLowerCase() : '';
}

function getImdbId(movie) {
  movie = movie || {};

  var ids = movie.ids || {};
  var external = movie.external_ids || {};

  var candidates = [
    movie.imdb_id, movie.imdbId, movie.imdb, movie.imdbid,
    ids.imdb, ids.imdb_id, external.imdb_id,
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
    x.MagnetUri || x.magnetUri || x.magnet || x.link || x.Link || ''
  ).match(/urn:btih:([a-f0-9]{40})/i);

  return m ? m[1].toLowerCase() : '';
}

function magnetOf(item) {
  var raw = item.raw || {};

  var candidates = [
    raw.MagnetUri, raw.magnetUri, raw.magnet, raw.Magnet,
    raw.link, raw.Link, raw.downloadUrl, raw.DownloadUrl
  ];

  for (var i = 0; i < candidates.length; i++) {
    var value = String(candidates[i] || '').trim();

    if (/^magnet:\?/i.test(value) && /urn:btih:/i.test(value)) {
      return value;
    }
  }

  if (!item.hash || !/^[a-f0-9]{40}$/i.test(item.hash)) return '';

  return 'magnet:?xt=urn:btih:' + item.hash +
    '&dn=' + encodeURIComponent(item.title || 'Torrent');
}

function magnetDiagnostic(item) {
  var magnet = item.magnet || magnetOf(item);
  var match = String(magnet || '').match(/[?&]dn=([^&]*)/i);
  var dn = '';

  if (match) {
    try {
      dn = decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch (e) {
      dn = match[1];
    }
  }

  return {
    title: item.title || '',
    dn: dn || '(параметр dn отсутствует)',
    hash: item.hash || '',
    magnetFound: !!magnet
  };
}

function firstValue(obj, names) {
  for (var i = 0; i < names.length; i++) {
    var value = obj && obj[names[i]];

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

function parseDateValue(value) {
  if (value === undefined || value === null || value === '') return 0;

  if (typeof value === 'number' && isFinite(value)) {
    return value < 100000000000 ? value * 1000 : value;
  }

  var text = String(value).trim();

  if (/^\d{10}$/.test(text)) return Number(text) * 1000;
  if (/^\d{13}$/.test(text)) return Number(text);

  var parsed = Date.parse(text);
  return isNaN(parsed) ? 0 : parsed;
}

/* ---------- Поиск через выбранный Jackett ---------- */

function search(parser, query, access) {
  var url = buildJackettUrl(parser, query);

  return req(url, access).then(function (data) {
    var list = Array.isArray(data)
      ? data
      : (data.Results || data.results || []);

    if (!Array.isArray(list)) {
      throw new Error('Ответ парсера не содержит массива Results');
    }

    var mapped = list.map(function (x) {
      var rawSize = firstValue(x, ['Size', 'size', 'length']);

      var rawSeeders = firstValue(
        x, ['Seeders', 'seeders', 'Seeds', 'seeds']
      );

      var rawLeechers = firstValue(
        x, ['Peers', 'peers', 'Leechers', 'leechers']
      );

      var rawDate = firstValue(x, [
        'PublishDate', 'publishDate', 'publish_date',
        'Date', 'date', 'Added', 'added',
        'Created', 'created', 'CreationDate', 'creationDate'
      ]);

      var item = {
        title: x.Title || x.title || x.Name || x.name || 'Без названия',
        hash: hashOf(x),
        size: Number(rawSize) || 0,
        seeders: Number(rawSeeders) || 0,
        leechers: Number(rawLeechers) || 0,
        tracker: x.Tracker || x.tracker || '',
        dateAdded: parseDateValue(rawDate),
        source: parser.name,
        sources: [parser.name],
        raw: x
      };

      item.magnet = magnetOf(item);
      return item;
    });

    var valid = mapped.filter(function (item) {
      return !!item.hash;
    });

    valid.rawCount = list.length;
    valid.validHashCount = valid.length;

    return valid;
  });
}

/* ---------- Сортировка ---------- */

function sortItems(items, mode) {
  var rows = items.slice();

  rows.sort(function (a, b) {
    if (mode === 'seeders') {
      return (b.seeders - a.seeders) ||
        (b.size - a.size) ||
        a.title.localeCompare(b.title);
    }

    if (mode === 'size_desc') {
      return (b.size - a.size) ||
        (b.seeders - a.seeders) ||
        a.title.localeCompare(b.title);
    }

    if (mode === 'size_asc') {
      return (a.size - b.size) ||
        (b.seeders - a.seeders) ||
        a.title.localeCompare(b.title);
    }

    if (mode === 'date') {
      if (a.dateAdded && b.dateAdded) return b.dateAdded - a.dateAdded;
      if (a.dateAdded) return -1;
      if (b.dateAdded) return 1;

      return (b.seeders - a.seeders) || a.title.localeCompare(b.title);
    }

    return 0;
  });

  return rows;
}

/* ---------- Проверка DMM ---------- */

function checkDMM(imdbId, hashes, access) {
  if (!imdbId) {
    return Promise.reject(
      new Error('IMDb ID фильма не найден в данных Lampa')
    );
  }

  if (!hashes || !hashes.length) {
    return Promise.reject(new Error('Нет хэшей для проверки'));
  }

  var proxy;

  try {
    proxy = requireProxy();
  } catch (e) {
    return Promise.reject(e);
  }

  return fetch(proxy + '?action=dmm-availability', {
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

function findHashResult(data, hash) {
  var wanted = String(hash || '').toLowerCase();

  if (!data || !Array.isArray(data.available)) return null;

  for (var i = 0; i < data.available.length; i++) {
    var item = data.available[i];

    if (item && String(item.hash || '').toLowerCase() === wanted) {
      return item;
    }
  }

  return null;
}

function classifyCache(result) {
  if (!result || typeof result !== 'object') return 'unknown';
  if (Array.isArray(result.files) && result.files.length > 0) return 'cached';

  return 'unknown';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
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

/* ---------- Получение RD_USER_ID ---------- */

function getRDUserId(screen, button) {
  var access = token();

  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }

  var proxy;

  try {
    proxy = requireProxy();
  } catch (e) {
    note(e.message);
    return;
  }

  button.disabled = true;
  button.textContent = 'Получаем ID…';

  fetch(proxy + '?action=rd-user-id', {
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
    copy.type = 'button';
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

    var status = screen.querySelector('#rd-status');
    if (status) status.after(result);

    button.textContent = 'ID получен';
    button.disabled = false;
  }).catch(function (err) {
    button.disabled = false;
    button.textContent = 'Получить RD_USER_ID';
    note('Не удалось получить ID: ' + err.message);
  });
}

/* ---------- Метки состояния DMM ---------- */

function updateCacheLabel(screen, item) {
  var nodes = screen.querySelectorAll('[data-cache-hash]');
  var node = null;

  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute('data-cache-hash') === item.hash) {
      node = nodes[i];
      break;
    }
  }

  if (!node) return;

  if (item.cacheState === 'cached') {
    node.textContent = 'Проверка кеша: DMM · подтверждён (' +
      (Number(item.cacheFiles) || 0) + ' файлов)';
    node.style.color = '#72e6a2';
  } else if (item.cacheState === 'error') {
    node.textContent =
      'Проверка кеша: DMM · ошибка проверки (кеш не подтверждён)';
    node.style.color = '#ff8585';
  } else if (item.cacheState === 'checking') {
    node.textContent = 'Проверка кеша: DMM · проверяем…';
    node.style.color = '#ffc766';
  } else {
    node.textContent = 'Проверка кеша: DMM · нет подтверждения';
    node.style.color = '#ffc766';
  }
}

function runCacheCheck(items, imdbId, access, screen) {
  var status = screen.querySelector('#rd-status');

  if (!imdbId) {
    status.textContent =
      'Кеш не проверен: IMDb ID не найден в данных фильма.';

    items.forEach(function (item) {
      item.cacheState = 'unknown';
      item.cacheFiles = 0;
      updateCacheLabel(screen, item);
    });

    renderCards(screen);
    return;
  }

  if (!items.length) {
    status.textContent = 'Нет раздач для проверки.';
    return;
  }

  var batches = [];

  for (var i = 0; i < items.length; i += 100) {
    batches.push(items.slice(i, i + 100));
  }

  status.textContent =
    'Проверяем DMM · IMDb: ' + imdbId + ' · раздач: ' + items.length;

  var cachedCount = 0;
  var unknownCount = 0;
  var errors = [];

  batches.reduce(function (chain, batch) {
    return chain.then(function () {
      return checkDMM(
        imdbId,
        batch.map(function (item) { return item.hash; }),
        access
      ).then(function (data) {
        if (!screen.isConnected) return;

        if (!data || !Array.isArray(data.available)) {
          throw new Error('Ответ DMM не содержит массива available');
        }

        batch.forEach(function (item) {
          var result = findHashResult(data, item.hash);
          var state = classifyCache(result);

          item.cacheState = state;
          item.cacheFiles = state === 'cached' ? result.files.length : 0;

          if (state === 'cached') cachedCount++;
          else unknownCount++;

          updateCacheLabel(screen, item);
        });
      });
    }).catch(function (err) {
      errors.push(err.message);

      batch.forEach(function (item) {
        item.cacheState = 'error';
        item.cacheFiles = 0;
        updateCacheLabel(screen, item);
      });
    });
  }, Promise.resolve()).then(function () {
    if (!screen.isConnected) return;

    status.textContent =
      'DMM · подтверждено: ' + cachedCount +
      ' · без подтверждения: ' + unknownCount +
      (errors.length ? ' · ошибок: ' + errors.length : '');

    var diag = screen.querySelector('#rd-dmm-diagnostic');

    if (diag) {
      diag.textContent =
        'IMDb ID: ' + imdbId +
        '\nПроверено раздач: ' + items.length +
        '\nПодтверждено: ' + cachedCount +
        '\nБез подтверждения: ' + unknownCount +
        (errors.length ? '\nОшибки:\n' + errors.join('\n') : '');
    }

    renderCards(screen);
  });
}

/* ---------- Добавление magnet в RD ---------- */

function testOne(item, button, resultNode) {
  var access = token();

  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }

  if (button.dataset.rdBusy === '1') return;

  if (button.dataset.rdTaskCreated) {
    resultNode.textContent =
      'Задача уже была создана: ' + button.dataset.rdTaskCreated +
      '\nПроверь её состояние в Real-Debrid.';
    return;
  }

  var magnet = item.magnet || magnetOf(item);

  if (!magnet) {
    resultNode.textContent =
      'Не удалось получить magnet-ссылку или hash.';
    return;
  }

  if (!window.confirm(
    'Добавить раздачу в Real-Debrid?\n\n' +
    item.title + '\n\nМагнит будет отправлен в твой аккаунт RD. Продолжить?'
  )) return;

  button.dataset.rdBusy = '1';
  button.disabled = true;
  button.textContent = 'Отправляем в RD…';
  resultNode.textContent = 'Создаём задачу…';

  postForm(RD + 'torrents/addMagnet', access, {
    magnet: magnet
  }).then(function (response) {
    if (!response || !response.id) {
      throw new Error('RD не вернул ID задачи: ' + JSON.stringify(response));
    }

    var id = String(response.id);

    button.dataset.rdTaskCreated = id;
    button.textContent = 'Задача создана';
    resultNode.textContent =
      'Задача создана: ' + id + '\nВыбираем все файлы…';

    return postForm(
      RD + 'torrents/selectFiles/' + encodeURIComponent(id),
      access,
      { files: 'all' }
    ).then(function () {
      return req(RD + 'torrents/info/' + encodeURIComponent(id), access);
    }).then(function (info) {
      resultNode.textContent =
        statusText(info.status) + '\nID задачи RD: ' + id;

      button.textContent = 'Задача создана';
      button.disabled = true;
    }).catch(function (err) {
      resultNode.textContent =
        'Задача RD создана: ' + id +
        '\nОшибка выбора файлов или проверки: ' + err.message +
        '\nПроверь задачу RD вручную, прежде чем повторять добавление.';

      button.textContent = 'Задача создана';
      button.disabled = true;
    });
  }).catch(function (err) {
    button.dataset.rdBusy = '0';
    button.disabled = true;
    button.textContent = 'Проверь задачу RD';

    resultNode.textContent =
      'Не удалось подтвердить результат добавления: ' + err.message +
      '\nВозможно, RD успел создать задачу.' +
      '\nПроверь список задач Real-Debrid перед повторной отправкой.';
  });
}

/* ---------- Меню сортировки ---------- */

function openSortMenu(screen) {
  var old = screen.querySelector('#rd-sort-menu');

  if (old) {
    old.remove();
    return;
  }

  var menu = document.createElement('div');
  menu.id = 'rd-sort-menu';
  menu.style.cssText =
    'position:fixed;z-index:1000002;inset:0;background:rgba(0,0,0,.7);' +
    'display:flex;align-items:flex-end;justify-content:center;padding:12px;box-sizing:border-box';

  var panel = document.createElement('div');
  panel.style.cssText =
    'width:100%;max-width:600px;background:#252525;color:#fff;' +
    'border-radius:18px;padding:18px 18px 24px;box-sizing:border-box';

  var heading = document.createElement('div');
  heading.textContent = 'Сортировать';
  heading.style.cssText = 'font-size:26px;margin:4px 4px 18px';
  panel.appendChild(heading);

  var current = getSortMode();

  SORT_OPTIONS.forEach(function (option) {
    var row = document.createElement('button');
    row.type = 'button';
    row.style.cssText =
      'display:flex;width:100%;align-items:center;justify-content:space-between;' +
      'gap:12px;padding:17px 6px;border:0;background:transparent;color:#fff;' +
      'font-size:17px;text-align:left;cursor:pointer;touch-action:manipulation';

    var label = document.createElement('span');
    label.textContent = option.label;
    row.appendChild(label);

    var check = document.createElement('span');
    check.textContent = option.value === current ? '✓' : '';
    check.style.cssText = 'font-size:24px;min-width:24px;text-align:center';
    row.appendChild(check);

    row.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      setSortMode(option.value);
      menu.remove();
      renderCards(screen);
    };

    panel.appendChild(row);
  });

  menu.appendChild(panel);

  menu.addEventListener('click', function (event) {
    if (event.target === menu) menu.remove();
  });

  screen.appendChild(menu);
}

/* ---------- Карточки результатов ---------- */

function renderCards(screen) {
  var all = screen.__rdItems || [];
  var box = screen.querySelector('#rd-results');

  if (!box) return;

  var mode = getSortMode();
  var sorted = sortItems(all, mode);

  var selected = SORT_OPTIONS.filter(function (o) {
    return o.value === mode;
  })[0];

  var sortInfo = screen.querySelector('#rd-sort-current');

  if (sortInfo && selected) {
    sortInfo.textContent = selected.label;
  }

  sorted.forEach(function (item) {
    var card = item._rdCard;

    if (!card) {
      card = document.createElement('div');
      item._rdCard = card;

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
      bits.push('Сиды: ' + item.seeders);
      if (item.tracker) bits.push(item.tracker);

      if (item.dateAdded) {
        bits.push('Дата: ' + new Date(item.dateAdded).toLocaleDateString());
      }

      meta.textContent = bits.join(' · ');
      card.appendChild(meta);

      var sourceLabel = document.createElement('div');
      sourceLabel.setAttribute('data-source-label', '1');
      sourceLabel.style.cssText = 'opacity:.9;font-size:.9em;margin-top:4px';
      card.appendChild(sourceLabel);

      var diagDetails = document.createElement('details');
      diagDetails.style.cssText =
        'margin-top:10px;padding:10px;background:#242424;' +
        'border-radius:6px;font-size:13px';

      var diagSummary = document.createElement('summary');
      diagSummary.textContent = 'Проверка magnet / имени dn';
      diagDetails.appendChild(diagSummary);

      var diagPre = document.createElement('pre');
      diagPre.style.cssText =
        'white-space:pre-wrap;overflow-wrap:anywhere;' +
        'font:12px monospace;line-height:1.5';

      var diag = magnetDiagnostic(item);

      diagPre.textContent =
        'Название карточки Lampa:\n' + diag.title +
        '\n\nИмя dn в magnet:\n' + diag.dn +
        '\n\nHash:\n' + diag.hash +
        '\n\nMagnet найден: ' + (diag.magnetFound ? 'да' : 'нет');

      diagDetails.appendChild(diagPre);
      card.appendChild(diagDetails);

      var cacheLabel = document.createElement('div');
      cacheLabel.setAttribute('data-cache-hash', item.hash);
      cacheLabel.style.cssText = 'margin-top:6px;font-size:.9em';
      card.appendChild(cacheLabel);

      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Добавить и выбрать файлы';
      button.style.cssText =
        'display:block;position:relative;z-index:1;margin-top:10px;' +
        'padding:12px 14px;border:0;border-radius:6px;' +
        'background:#7a5cff;color:#fff;cursor:pointer;touch-action:manipulation';

      var result = document.createElement('div');
      result.style.cssText =
        'margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.9em';

      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        testOne(item, button, result);
      });

      card.appendChild(button);
      card.appendChild(result);
    }

    var sourceLabel = card.querySelector('[data-source-label]');

    if (sourceLabel) {
      sourceLabel.textContent =
        'Источник: ' +
        (item.sources || [item.source || 'неизвестен']).join(' + ');
    }

    updateCacheLabel(screen, item);
    box.appendChild(card);
  });
}

/* ---------- Поиск и объединение результатов ---------- */

function openSearch(query, movie) {
  var access = token();

  if (!access) {
    note('Сначала подключи Real-Debrid в настройках.');
    return;
  }

  try {
    requireProxy();
  } catch (e) {
    note(e.message);
    return;
  }

  var config;

  try {
    config = getParserConfig();
  } catch (e) {
    note(e.message);
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
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<h2>Real-Debrid — поиск раздач</h2>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button id="rd-get-id">Получить RD_USER_ID</button>' +
          '<button id="rd-close">Закрыть</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0">' +
        '<button id="rd-sort-button" style="padding:10px 14px;border:1px solid #666;border-radius:8px;background:#333;color:#fff;cursor:pointer;touch-action:manipulation">Сортировка</button>' +
        '<span style="opacity:.8">Текущая: <span id="rd-sort-current"></span></span>' +
      '</div>' +
      '<p id="rd-status">Ищем: ' + esc(query) + '</p>' +
      '<div style="padding:12px;background:#333;border-radius:8px;line-height:1.5;margin-bottom:14px">' +
        'Источники берутся из настроек парсера Lampa. Зелёная метка означает, что DMM вернул хэш в available с непустым files. Отсутствие подтверждения не доказывает отсутствие кеша в Real-Debrid.' +
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

  screen.querySelector('#rd-sort-button').onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();
    openSortMenu(screen);
  };

  var parserStats = {};
  var parserErrors = [];
  var settingsDiagnostic = getParserSettingsDiagnostic();

  console.log('[RD Card Button] Настройки парсера:', settingsDiagnostic);

  screen.querySelector('#rd-status').textContent =
    'Ищем: ' + query + ' · источников: ' + config.parsers.length;

  Promise.all(config.parsers.map(function (parser) {
    return search(parser, query, access).then(function (rows) {
      parserStats[parser.name] = {
        rawCount: rows.rawCount || 0,
        validHashCount: rows.validHashCount || rows.length,
        rows: rows,
        error: ''
      };

      return rows;
    }).catch(function (err) {
      parserStats[parser.name] = {
        rawCount: 0,
        validHashCount: 0,
        rows: [],
        error: err.message
      };

      parserErrors.push(parser.name + ': ' + err.message);

      return [];
    });
  })).then(function (groups) {
    if (!screen.isConnected) return;

    var seen = {};
    var all = [];

    groups.forEach(function (group) {
      group.forEach(function (item) {
        var key = String(item.hash || '').toLowerCase();
        if (!key) return;

        if (!seen[key]) {
          item.sources = (item.sources || [item.source || 'неизвестен']).slice();
          seen[key] = item;
          all.push(item);
        } else {
          var existing = seen[key];
          var incomingSources = item.sources || [item.source || 'неизвестен'];

          incomingSources.forEach(function (source) {
            if (existing.sources.indexOf(source) === -1) {
              existing.sources.push(source);
            }
          });

          existing.sources.sort();
          existing.source = existing.sources.join(' + ');

          if (!existing.magnet && item.magnet) existing.magnet = item.magnet;
          if (!existing.tracker && item.tracker) existing.tracker = item.tracker;
          if (item.seeders > existing.seeders) existing.seeders = item.seeders;
          if (item.size > existing.size) existing.size = item.size;
          if (item.dateAdded > existing.dateAdded) {
            existing.dateAdded = item.dateAdded;
          }
        }
      });
    });

    screen.__rdItems = all;

    var box = screen.querySelector('#rd-results');
    var details = document.createElement('details');
    details.id = 'rd-search-diagnostics';
    details.style.cssText =
      'margin:14px 0;padding:12px;background:#292929;border-radius:8px';

    var summary = document.createElement('summary');
    summary.textContent = 'Диагностика поиска';
    details.appendChild(summary);

    var pre = document.createElement('pre');
    pre.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;font:13px monospace';

    var report = [
      'Запрос: ' + query,
      'IMDb ID: ' + (imdbId || 'не найден в объекте фильма'),
      'Тип парсера Lampa: ' + config.type,
      'Выбор ссылки Lampa: ' + config.selected,
      'parser_use: ' + String(settingsDiagnostic.parser_use),
      'parser_torrent_type: ' + String(settingsDiagnostic.parser_torrent_type),
      'parser_use_link: ' + String(settingsDiagnostic.parser_use_link),
      'Основной URL: ' + (settingsDiagnostic.jackett_url || '(не задан)'),
      'Дополнительный URL: ' + (settingsDiagnostic.jackett_url_two || '(не задан)'),
      'Основной API-ключ задан: ' + (settingsDiagnostic.primaryKeyConfigured ? 'да' : 'нет'),
      'Дополнительный API-ключ задан: ' + (settingsDiagnostic.secondaryKeyConfigured ? 'да' : 'нет'),
      'Источников запрошено: ' + config.parsers.length
    ];

    config.parsers.forEach(function (parser) {
      var info = parserStats[parser.name] || {};

      report.push(
        '\n' + parser.name + ' (' + parser.url + '):' +
        '\n  Ответов API: ' + (info.rawCount || 0) +
        '\n  С распознанным хешем: ' + (info.validHashCount || 0) +
        (info.error ? '\n  Ошибка: ' + info.error : '')
      );
    });

    report.push('\nВсего уникальных хешей после объединения: ' + all.length);

    if (parserErrors.length) {
      report.push('\nОшибки источников:\n' + parserErrors.join('\n'));
    }

    pre.textContent = report.join('\n');
    details.appendChild(pre);
    box.appendChild(details);

    if (!all.length) {
      var empty = document.createElement('p');

      empty.textContent =
        'Раздачи не найдены. Проверь URL, API-ключ и настройки парсера. ' +
        'Если появилась ошибка HTTP 403 Target not allowed, выбранный домен ' +
        'не разрешён в Worker.';

      box.appendChild(empty);

      screen.querySelector('#rd-status').textContent = 'Раздачи не найдены.';
      return;
    }

    all.forEach(function (item) {
      item.cacheState = 'checking';
      item.cacheFiles = 0;
    });

    renderCards(screen);
    runCacheCheck(all, imdbId, access, screen);
  }).catch(function (err) {
    if (screen.isConnected) {
      screen.querySelector('#rd-status').textContent =
        'Ошибка поиска: ' + err.message;
    }
  });
}

/* ---------- Кнопка в карточке фильма Lampa ---------- */

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
    openSearch(title, movie);
  });

  button.on('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
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