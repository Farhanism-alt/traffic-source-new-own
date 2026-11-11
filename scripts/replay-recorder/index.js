// Session replay recorder. Built into public/r.js by `npm run build:recorder`.
// Loaded by t.js only when replay is enabled for the site and this session is sampled in.
// Events are buffered, gzipped in the browser and uploaded in numbered chunks.
import { record } from '@rrweb/record';

(function () {
  var cfg = window.__ts_replay;
  if (!cfg || window.__ts_replay_started) return;
  window.__ts_replay_started = true;

  var RID = '_ts_rid';
  var RSID = '_ts_rsid';
  var SEQ = '_ts_rseq';
  var START = '_ts_rstart';
  var FLUSH_MS = 20000;
  var MAX_BUFFER = 256 * 1024; // raw chars; ~30-50 KB gzipped, under the 64 KB keepalive limit
  var IDLE_MS = 5 * 60 * 1000;
  var MAX_SEQ = 2500;
  var MIN_MS = Math.max(0, (cfg.minSeconds || 0) * 1000);
  // Incremental sources that mean the user did something: mouse move/interaction, scroll, input, touch, drag
  var ACTIVE_SOURCES = { 1: 1, 2: 1, 3: 1, 5: 1, 6: 1, 12: 1 };

  function ss(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      sessionStorage.setItem(k, v);
    } catch (_) {}
    return null;
  }
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var rid;
  function ensureReplay() {
    var sid = cfg.sid();
    rid = ss(RID);
    if (!rid || ss(RSID) !== sid) {
      rid = newId();
      ss(RID, rid);
      ss(RSID, sid);
      ss(SEQ, '0');
      ss(START, String(Date.now()));
    }
  }
  ensureReplay();

  var buf = [];
  var size = 0;
  var stopFn = null;
  var dead = false;
  var lastActive = Date.now();

  function url(seq, z) {
    var e = encodeURIComponent;
    return cfg.endpoint + '?s=' + e(cfg.site) + '&r=' + rid + '&q=' + seq + '&sid=' + e(ss(RSID) || '') + '&v=' + e(cfg.vid) + '&z=' + z;
  }

  function handleStatus(r) {
    // Replay switched off, storage full or replay too long: stop recording this session
    if (r && (r.status === 403 || r.status === 507)) shutdown();
  }

  function flush(unloading) {
    if (!buf.length || dead) return;
    var seq = parseInt(ss(SEQ) || '0', 10);
    var started = parseInt(ss(START) || '0', 10) || Date.now();
    if (seq === 0 && Date.now() - started < MIN_MS) {
      // Too short to keep: wait, or drop it if the visitor is already leaving
      if (unloading) { buf = []; size = 0; }
      return;
    }
    if (seq >= MAX_SEQ) return shutdown();
    var body = '[' + buf.join(',') + ']';
    buf = [];
    size = 0;
    ss(SEQ, String(seq + 1));

    if (unloading || typeof CompressionStream === 'undefined') {
      var small = body.length < 63000;
      if (small && navigator.sendBeacon && navigator.sendBeacon(url(seq, 0), body)) return;
      try {
        fetch(url(seq, 0), { method: 'POST', body: body, keepalive: small, headers: { 'Content-Type': 'text/plain' } })
          .then(handleStatus, function () {});
      } catch (_) {}
      return;
    }
    new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip')))
      .blob()
      .then(function (gz) {
        return fetch(url(seq, 1), { method: 'POST', body: gz, keepalive: gz.size < 60000, headers: { 'Content-Type': 'text/plain' } });
      })
      .then(handleStatus, function () {});
  }

  function emit(event) {
    var s;
    try { s = JSON.stringify(event); } catch (_) { return; }
    buf.push(s);
    size += s.length;
    if (event.type === 3 && event.data && ACTIVE_SOURCES[event.data.source]) lastActive = Date.now();
    if (size > MAX_BUFFER) flush(false);
  }

  function start() {
    if (stopFn || dead) return;
    ensureReplay();
    lastActive = Date.now();
    stopFn = record({
      emit: emit,
      maskAllInputs: cfg.maskInputs !== false,
      maskInputOptions: { password: true },
      blockClass: 'ts-no-record',
      blockSelector: '[data-ts-no-record]',
      maskTextClass: 'ts-mask',
      ignoreClass: 'ts-ignore',
      slimDOMOptions: 'all',
      inlineStylesheet: true,
      recordCanvas: false,
      collectFonts: false,
      sampling: { mousemove: 100, scroll: 150, media: 800, input: 'last' },
    });
  }

  function pause() {
    if (!stopFn) return;
    try { stopFn(); } catch (_) {}
    stopFn = null;
    flush(false);
  }

  function shutdown() {
    pause();
    dead = true;
    buf = [];
  }

  // Idle tabs stop recording; the next interaction resumes with a fresh snapshot.
  setInterval(function () {
    if (stopFn && Date.now() - lastActive > IDLE_MS) pause();
    else flush(false);
  }, FLUSH_MS);
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (!stopFn && !dead) start(); }, { passive: true, capture: true });
  });

  // The first chunk (full page snapshot) goes out as soon as the minimum length is reached
  setTimeout(function () { flush(false); }, Math.max(MIN_MS, 2000) + 100);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(false);
  });
  window.addEventListener('pagehide', function () { flush(true); });

  start();
})();
