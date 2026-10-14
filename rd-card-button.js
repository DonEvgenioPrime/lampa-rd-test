(function () {
'use strict';
if (window.__rd_card_button_search) return;
window.__rd_card_button_search = true;
var PROXY = 'https://lampa-rd-proxy.evgeniy4450.workers.dev/';
var RD = 'https://api.real-debrid.com/rest/1.0/';
var STORE = 'rd_bridge_oauth_v2';
var PARSERS = ['https://jr.maxvol.pro', 'https://jacred.xyz'];
function token() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}').access_token || ''; }
  catch (e) { return ''; }
}
function note(s) {
  if (window.Lampa && Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(s);
}
function req(url, access) {
  var h = {Accept:'application/json'};
  if (access) h.Authorization = 'Bearer ' + access;
  return fetch(PROXY + '?url=' + encodeURIComponent(url), {headers:h})
    .then(function(r) {
      return r.text().then(function(t) {
        var d;
        try { d = t ? JSON.parse(t) : {}; } catch(e) { d = {message:t}; }
        if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
        return d;
      });
    });
}
function hashOf(x) {
  var h = x.InfoHash || x.infoHash || x.info_hash || x.Hash || x.hash || '';
  if (/^[a-f0-9]{40}$/i.test(String(h))) return String(h).toLowerCase();
  var m = String(x.MagnetUri || x.magnetUri || x.magnet || x.link || x.Link || '')
    .match(/urn:btih:([a-f0-9]{40})/i);
  return m ? m[1].toLowerCase() : '';
}
function search(host, q) {
  var url = host + '/api/v2.0/indexers/all/results?Query=' +
    encodeURIComponent(q) + '&Category=2000,5000';
  return req(url).then(function(d) {
    var a = Array.isArray(d) ? d : (d.Results || d.results || []);
    return a.map(function(x) {
      return {
        title:x.Title || x.title || x.Name || x.name || 'Без названия',
        hash:hashOf(x),
        size:x.Size || x.size || 0,
        seeders:x.Seeders || x.seeders || 0,
        tracker:x.Tracker || x.tracker || '',
        raw:x
      };
    }).filter(function(x) { return x.hash; });
  });
}
function cached(hash, access) {
  return req(RD + 'torrents/instantAvailability/' + hash, access)
    .then(function(d) {
      var e = d[hash] || d[hash.toUpperCase()] || d[hash.toLowerCase()];
      if (!e || !e.rd) return false;
      var slots = Array.isArray(e.rd) ? e.rd : [e.rd];
      return slots.some(function(slot) {
        return slot && Object.keys(slot).some(function(k) {
          var v = slot[k];
          return Array.isArray(v) ? v.length > 0 :
            !!v && typeof v === 'object' && Object.keys(v).length > 0;
        });
      });
    }).catch(function() { return false; });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}
function size(n) {
  n = Number(n);
  if (!n) return '';
  var u = ['B','KB','MB','GB','TB'], i = 0;
  while (n >= 1024 && i < 4) { n /= 1024; i++; }
  return n.toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
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
  screen.style.cssText = 'position:fixed;z-index:999999;inset:0;overflow:auto;background:#171717;color:#fff;padding:20px;box-sizing:border-box;font:16px Arial,sans-serif';
  screen.innerHTML = '<div style="max-width:950px;margin:auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px">' +
    '<h2>Real-Debrid — кэш</h2><button id="rd-close">Закрыть</button></div>' +
    '<p id="rd-status">Ищем: ' + esc(query) + '</p><div id="rd-results"></div></div>';
  document.body.appendChild(screen);
  screen.querySelector('#rd-close').onclick = function() { screen.remove(); };
  Promise.all(PARSERS.map(function(p) {
    return search(p, query).catch(function() { return []; });
  })).then(function(groups) {
    if (!screen.isConnected) return [];
    var seen = {}, all = [];
    groups.forEach(function(g) {
      g.forEach(function(x) {
        if (!seen[x.hash]) { seen[x.hash] = true; all.push(x); }
      });
    });
    screen.querySelector('#rd-status').textContent =
      'Найдено релизов: ' + all.length + '. Проверяем кэш…';
    return Promise.all(all.slice(0, 60).map(function(x) {
      return cached(x.hash, access).then(function(ok) { return ok ? x : null; });
    }));
  }).then(function(rows) {
    if (!screen.isConnected || !rows) return;
    var results = rows.filter(Boolean);
    var status = screen.querySelector('#rd-status');
    var box = screen.querySelector('#rd-results');
    status.textContent = 'Закэшировано в Real-Debrid: ' + results.length;
    if (!results.length) {
      box.textContent = 'Закэшированных релизов не найдено.';
      return;
    }
    results.forEach(function(x) {
      var card = document.createElement('div');
      card.style.cssText = 'padding:14px;margin:10px 0;background:#303030;border-radius:8px;line-height:1.5';
      var meta = [];
      if (x.size) meta.push(size(x.size));
      if (x.seeders) meta.push('Сиды: ' + x.seeders);
      if (x.tracker) meta.push(x.tracker);
      card.innerHTML = '<div style="font-weight:600">⚡ ' + esc(x.title) + '</div>' +
        (meta.length ? '<div style="opacity:.75;font-size:.9em">' +
        meta.map(esc).join(' · ') + '</div>' : '');
      box.appendChild(card);
    });
  }).catch(function(e) {
    if (screen.isConnected) screen.querySelector('#rd-status').textContent =
      'Ошибка поиска: ' + e.message;
  });
}
function addButton(e) {
  if (!e || e.type !== 'complite' || !e.data || !e.data.movie) return;
  var root = e.object && e.object.activity && e.object.activity.render
    ? e.object.activity.render() : null;
  if (!root || !root.length || !window.jQuery ||
      root.find('.view--realdebrid').length) return;
  var m = e.data.movie;
  var title = m.title || m.name || m.original_title || '';
  if (!title) return;
  var b = window.jQuery(
    '<div class="full-start__button selector view--realdebrid"><span>Real-Debrid</span></div>'
  );
  b.on('hover:enter', function() { openSearch(title); });
  b.on('click', function() { openSearch(title); });
  var torrent = root.find('.view--torrent');
  if (torrent.length) torrent.after(b);
  else {
    var play = root.find('.full-start__play');
    if (play.length) play.after(b);
    else root.find('.full-start__buttons').append(b);
  }
}
function boot() {
  if (!window.Lampa || !Lampa.Listener || window.__rd_card_listener) return;
  window.__rd_card_listener = true;
  Lampa.Listener.follow('full', addButton);
}
if (window.Lampa && Lampa.Activity) boot();
else if (window.Lampa && Lampa.Listener) {
  Lampa.Listener.follow('app', function(e) {
    if (e.type === 'ready') boot();
  });
}
})();