(function () {
  'use strict';
  if (window.__ts_initialized) return;
  window.__ts_initialized = true;

  var script = document.currentScript;
  var ENDPOINT = script.src.replace('/t.js', '/api/collect');
  var SITE_ID = script.getAttribute('data-site');
  if (!SITE_ID) return;

  // Skip automated browsers and crawlers — they only cost requests
  if (navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|phantom/i.test(navigator.userAgent || '')) return;

  // Storage can be blocked (Safari "Block all cookies", some in-app browsers, sandboxed
  // iframes): every access goes through these so tracking keeps working without it.
  var memStore = {};
  function store(kind) {
    return {
      get: function (k) {
        try { var v = window[kind].getItem(k); if (v !== null) return v; } catch (_) {}
        return Object.prototype.hasOwnProperty.call(memStore, kind + k) ? memStore[kind + k] : null;
      },
      set: function (k, v) {
        memStore[kind + k] = v;
        try { window[kind].setItem(k, v); } catch (_) {}
      },
    };
  }
  var LS = store('localStorage');
  var SS = store('sessionStorage');

  var VERSION = '2026.11.13';

  // The query string this page was loaded with. Sites often strip ?utm_… (router redirects,
  // "clean URL" scripts) before this deferred script runs; the browser keeps the original
  // navigation URL, so campaign parameters are read from there when the address bar lost them.
  var CAMPAIGN_RE = /[?&](utm_[a-z]+|ref|via|source)=/i;
  var landingQuery = location.search;
  var navQuery = '';
  try {
    var navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (navEntry && navEntry.name) navQuery = new URL(navEntry.name).search;
  } catch (_) {}
  if (!CAMPAIGN_RE.test(landingQuery) && CAMPAIGN_RE.test(navQuery)) landingQuery = navQuery;
  var landingUsed = false;

  // Debug: add ?ts_debug=1 to any page (remembered; ?ts_debug=0 turns it off) to log every hit
  var DEBUG = false;
  try {
    var dbg = new URLSearchParams(location.search).get('ts_debug') || new URLSearchParams(navQuery).get('ts_debug');
    if (dbg === '1') LS.set('_ts_debug', '1');
    if (dbg === '0') LS.set('_ts_debug', '');
    DEBUG = LS.get('_ts_debug') === '1';
  } catch (_) {}
  function log() {
    if (DEBUG && window.console) console.log.apply(console, ['[traffic-source ' + VERSION + ']'].concat([].slice.call(arguments)));
  }

  var VID_KEY = '_ts_vid';
  var SID_KEY = '_ts_sid';
  var STS_KEY = '_ts_sts';
  var REF_KEY = '_ts_ref';
  var TIMEOUT = 30 * 60 * 1000;

  function getCookieDomain() {
    if (script && script.getAttribute('data-cookie-domain')) {
      return script.getAttribute('data-cookie-domain');
    }
    var host = location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1' || /^(\d+\.){3}\d+$/.test(host)) {
      return '';
    }
    var parts = host.split('.');
    if (parts.length >= 2) {
      return '.' + parts.slice(-2).join('.');
    }
    return '';
  }

  function getCookie(name) {
    var v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
    return v ? v[2] : null;
  }

  function setCookie(name, value, maxAge) {
    var domain = getCookieDomain();
    var domainAttr = domain ? ';domain=' + domain : '';
    document.cookie = name + '=' + value + ';path=/' + domainAttr + ';max-age=' + maxAge + ';SameSite=Lax';
  }

  // Detect and persist affiliate ref parameter
  var refParam = new URLSearchParams(location.search).get('ref') || new URLSearchParams(landingQuery).get('ref');
  if (refParam) {
    LS.set(REF_KEY, refParam);
  }

  var vid = LS.get(VID_KEY) || getCookie(VID_KEY);
  if (!vid) {
    vid = uid();
  }
  LS.set(VID_KEY, vid);
  setCookie(VID_KEY, vid, 31536000);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // Where this page load came from: a campaign (utm_*) or another website. Arriving from a
  // new source starts a new session, like Google Analytics, so the visit is credited to it.
  var SRC_KEY = '_ts_src';
  function rootOf(host) {
    var p = String(host || '').toLowerCase().split('.');
    if (p.length <= 2) return p.join('.');
    var take = p[p.length - 1].length === 2 && /^(co|com|org|net|ac|gov|edu|ne|or)$/.test(p[p.length - 2]) ? 3 : 2;
    return p.slice(-take).join('.');
  }
  var landingSource = (function () {
    var q = new URLSearchParams(landingQuery);
    var utm = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'via'].map(function (k) { return q.get(k) || ''; }).join('|');
    if (utm.replace(/\|/g, '')) return 'utm:' + utm;
    try {
      var refHost = document.referrer ? new URL(document.referrer).hostname : '';
      if (refHost && rootOf(refHost) !== rootOf(location.hostname)) return 'ref:' + refHost;
    } catch (_) {}
    return '';
  })();

  function getSession() {
    var stored = SS.get(SID_KEY) || getCookie(SID_KEY);
    var ts = parseInt(SS.get(STS_KEY) || getCookie(STS_KEY) || '0', 10);
    var prevSource = SS.get(SRC_KEY) || getCookie(SRC_KEY) || '';
    var sid;
    if (stored && Date.now() - ts < TIMEOUT && !(landingSource && landingSource !== decodeURIComponent(prevSource))) {
      sid = stored;
    } else {
      sid = uid();
    }
    if (landingSource) {
      SS.set(SRC_KEY, encodeURIComponent(landingSource));
      setCookie(SRC_KEY, encodeURIComponent(landingSource), 1800);
    }
    SS.set(SID_KEY, sid);
    SS.set(STS_KEY, String(Date.now()));
    setCookie(SID_KEY, sid, 1800);
    setCookie(STS_KEY, String(Date.now()), 1800);
    return sid;
  }

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'via'];
  function readUtm(query) {
    var p = new URLSearchParams(query);
    var u = {};
    var found = false;
    UTM_KEYS.forEach(function (k) {
      var v = p.get(k);
      if (v) { u[k] = v; found = true; }
    });
    return found ? u : null;
  }
  function getUtm() {
    var u = readUtm(location.search);
    // First page view of this load: fall back to the original URL if the site stripped the params
    if (!u && !landingUsed) u = readUtm(landingQuery);
    return u || {};
  }

  function build(data) {
    data.site_id = SITE_ID;
    data.visitor_id = vid;
    data.session_id = getSession();
    data.url = location.href;
    data.pathname = location.pathname;
    data.hostname = location.hostname;
    data.referrer = document.referrer || '';
    data.screen_width = screen.width;
    data.screen_height = screen.height;
    if (data.type !== 'event') Object.assign(data, getUtm());

    var ref = LS.get(REF_KEY);
    if (ref) data.ref = ref;
    return data;
  }

  function post(items) {
    if (!items.length) return;
    log('sending', items.map(function (i) {
      return { type: i.type, path: i.pathname, session: i.session_id, utm_source: i.utm_source || null, referrer: i.referrer || null };
    }));
    var payload = JSON.stringify(items.length === 1 ? items[0] : { batch: items });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, payload)) return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', ENDPOINT, true);
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.send(payload);
    } catch (_) {}
  }

  // Low-priority hits (events, identify) are queued and sent together:
  // with the next pageview, after a short delay, or when the page is hidden.
  var queue = [];
  var flushTimer = null;
  var MAX_BATCH = 20;

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    while (queue.length) post(queue.splice(0, MAX_BATCH));
  }

  function enqueue(data) {
    queue.push(build(data));
    if (queue.length >= MAX_BATCH) return flush();
    if (!flushTimer) flushTimer = setTimeout(flush, 5000);
  }

  // Pageviews go out immediately, carrying anything queued with them
  function send(data) {
    queue.unshift(build(data));
    if (data.type === 'pageview') landingUsed = true;
    flush();
  }

  // Custom event tracking — window.__ts.track('Button Click', { label: 'signup' })
  function track(name, props) {
    if (!name) return;
    enqueue({ type: 'event', name: String(name), props: props || {} });
  }

  // Manual identify — window.__ts.identify('user@example.com')
  var IDN_KEY = '_ts_idn';
  function identify(email) {
    if (!email || String(email).indexOf('@') < 1) return;
    email = String(email).trim().toLowerCase();
    // Each email is sent once per session (blur + change + submit all fire for the same field)
    var sent = '';
    sent = SS.get(IDN_KEY) || '';
    if (sent === email) return;
    SS.set(IDN_KEY, email);
    enqueue({ type: 'identify', email: email });
  }

  // Capture email as soon as the user leaves an email field — fires before any form submit
  // or Stripe redirect, so the identify event reaches the server even on external checkouts.
  function maybeSendEmail(el) {
    if (!el) return;
    var t = (el.type || '').toLowerCase();
    var n = (el.name || '').toLowerCase();
    var id = (el.id || '').toLowerCase();
    if (t !== 'email' && n.indexOf('email') < 0 && id.indexOf('email') < 0) return;
    var email = (el.value || '').trim().toLowerCase();
    if (email && email.indexOf('@') > 1 && email.indexOf('.') > 2) {
      identify(email);
    }
  }
  document.addEventListener('blur', function (e) { maybeSendEmail(e.target); }, true);
  document.addEventListener('change', function (e) { maybeSendEmail(e.target); }, true);

  // Also capture on form submission as a safety net
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var emailEl = form.querySelector('input[type="email"]') ||
      form.querySelector('input[name="email"]') ||
      form.querySelector('input[name="email_address"]') ||
      form.querySelector('input[id*="email"]');
    if (!emailEl) return;
    var email = (emailEl.value || '').trim().toLowerCase();
    if (email && email.indexOf('@') > 0) {
      identify(email);
      flush();
    }
  }, true);

  // Auto-track outbound links and file downloads
  var DOWNLOAD_EXTS = ['pdf', 'zip', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'csv', 'mp4', 'mp3', 'dmg', 'exe', 'pkg'];
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a[href]');
    if (!el) return;
    try {
      var url = new URL(el.href, location.href);
      if (url.hostname === location.hostname) return;
      var parts = url.pathname.split('.');
      var ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
      if (DOWNLOAD_EXTS.indexOf(ext) > -1) {
        track('File Download', { url: url.href, type: ext });
      } else {
        track('Outbound Link', { url: url.href });
      }
    } catch (_) {}
  }, true);

  // Track initial page view
  send({ type: 'pageview' });

  // Heartbeat keeps the live-visitor count accurate (realtime window is 5 min).
  // Only sent while the tab is visible and the user was active in the last 30 min.
  var HEARTBEAT_MS = 4 * 60 * 1000;
  var IDLE_MS = 30 * 60 * 1000;
  var lastInput = Date.now();
  var lastSent = Date.now();
  ['mousemove', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastInput = Date.now(); }, { passive: true, capture: true });
  });
  function beat() {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastInput > IDLE_MS) return;
    lastSent = Date.now();
    post([build({ type: 'heartbeat' })]);
  }
  setInterval(beat, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
    // Returning after a long absence: refresh presence right away
    else if (Date.now() - lastSent > HEARTBEAT_MS) { lastInput = Date.now(); beat(); }
  });
  window.addEventListener('pagehide', flush);

  // Back/forward restores from the browser cache don't reload the script: count them too
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { lastUrl = location.href; send({ type: 'pageview' }); }
  });

  // SPA support — only fire when URL actually changes
  var lastUrl = location.href;
  var pushState = history.pushState;
  var replaceState = history.replaceState;
  history.pushState = function () {
    pushState.apply(this, arguments);
    setTimeout(function () {
      if (location.href !== lastUrl) { lastUrl = location.href; send({ type: 'pageview' }); }
    }, 0);
  };
  history.replaceState = function () {
    replaceState.apply(this, arguments);
    setTimeout(function () {
      if (location.href !== lastUrl) { lastUrl = location.href; send({ type: 'pageview' }); }
    }, 0);
  };
  window.addEventListener('popstate', function () {
    if (location.href !== lastUrl) { lastUrl = location.href; send({ type: 'pageview' }); }
  });

  // Session replay: the recorder (r.js) loads only when replay is on for this site
  // and this session is sampled in. Opt out per page with data-replay="off" on the script tag.
  function currentSid() {
    return SS.get(SID_KEY) || getCookie(SID_KEY) || '';
  }
  function startReplay(cfg) {
    if (!cfg || !cfg.enabled) return;
    var sid = currentSid();
    var pick = '';
    try { pick = sessionStorage.getItem('_ts_rsamp') || ''; } catch (_) {}
    if (pick.split(':')[0] !== sid) {
      pick = sid + ':' + (Math.random() * 100 < (cfg.sample || 100) ? '1' : '0');
      try { sessionStorage.setItem('_ts_rsamp', pick); } catch (_) {}
    }
    if (pick.split(':')[1] !== '1') return;
    window.__ts_replay = {
      endpoint: BASE + '/api/replay',
      site: SITE_ID,
      vid: vid,
      sid: currentSid,
      maskInputs: cfg.maskInputs !== false,
      minSeconds: cfg.minSeconds || 0,
    };
    var s = document.createElement('script');
    s.src = BASE + '/r.js';
    s.async = true;
    (document.head || document.documentElement).appendChild(s);
  }
  var BASE = script.src.replace(/\/t\.js(\?.*)?$/, '');
  if (script.getAttribute('data-replay') !== 'off' && window.fetch && window.Promise) {
    var RCFG = '_ts_rcfg';
    var cachedCfg = null;
    try { cachedCfg = JSON.parse(sessionStorage.getItem(RCFG) || 'null'); } catch (_) {}
    if (cachedCfg) startReplay(cachedCfg);
    else {
      fetch(BASE + '/api/replay?config=1&s=' + encodeURIComponent(SITE_ID))
        .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
        .then(function (c) {
          try { sessionStorage.setItem(RCFG, JSON.stringify(c)); } catch (_) {}
          startReplay(c);
        })
        .catch(function () {});
    }
  }

  var existingTs = window.__ts;
  window.__ts = { version: VERSION, vid: vid, sid: function () { return getSession(); }, track: track, identify: identify };
  log('loaded', { site: SITE_ID, landingSource: landingSource || '(none: direct)', landingQuery: landingQuery || '(none)', url: location.href, referrer: document.referrer || '(none)' });

  if (existingTs && Array.isArray(existingTs.q)) {
    for (var i = 0; i < existingTs.q.length; i++) {
      var cmd = existingTs.q[i];
      if (cmd && cmd[0] === 'identify') identify(cmd[1]);
      if (cmd && cmd[0] === 'track') track(cmd[1], cmd[2]);
    }
  }
})();
