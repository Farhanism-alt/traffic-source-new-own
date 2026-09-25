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
  var refParam = new URLSearchParams(location.search).get('ref');
  if (refParam) {
    localStorage.setItem(REF_KEY, refParam);
  }

  var vid = localStorage.getItem(VID_KEY) || getCookie(VID_KEY);
  if (!vid) {
    vid = uid();
  }
  localStorage.setItem(VID_KEY, vid);
  setCookie(VID_KEY, vid, 31536000);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function getSession() {
    var stored = sessionStorage.getItem(SID_KEY) || getCookie(SID_KEY);
    var ts = parseInt(sessionStorage.getItem(STS_KEY) || '0', 10);
    var sid;
    if (stored && Date.now() - ts < TIMEOUT) {
      sid = stored;
    } else {
      sid = uid();
    }
    sessionStorage.setItem(SID_KEY, sid);
    sessionStorage.setItem(STS_KEY, String(Date.now()));
    setCookie(SID_KEY, sid, 1800);
    return sid;
  }

  function getUtm() {
    var p = new URLSearchParams(location.search);
    var u = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'via'].forEach(function (k) {
      var v = p.get(k);
      if (v) u[k] = v;
    });
    return u;
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

    var ref = localStorage.getItem(REF_KEY);
    if (ref) data.ref = ref;
    return data;
  }

  function post(items) {
    if (!items.length) return;
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
    try { sent = sessionStorage.getItem(IDN_KEY) || ''; } catch (_) {}
    if (sent === email) return;
    try { sessionStorage.setItem(IDN_KEY, email); } catch (_) {}
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

  var existingTs = window.__ts;
  window.__ts = { vid: vid, sid: function () { return getSession(); }, track: track, identify: identify };

  if (existingTs && Array.isArray(existingTs.q)) {
    for (var i = 0; i < existingTs.q.length; i++) {
      var cmd = existingTs.q[i];
      if (cmd && cmd[0] === 'identify') identify(cmd[1]);
      if (cmd && cmd[0] === 'track') track(cmd[1], cmd[2]);
    }
  }
})();
