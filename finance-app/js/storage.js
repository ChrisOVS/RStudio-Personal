/*
 * storage.js — keeping your figures between visits.
 *
 * There is no server here. The app is a single file that runs entirely in your
 * browser and never sends anything anywhere, which is the reason a Google or
 * Apple sign-in is not on offer: OAuth needs a backend holding client secrets
 * and a registered redirect, and any such flow would also mean your salary
 * leaving your machine. So persistence is done three ways instead, in order of
 * how much effort each costs you:
 *
 * 1. AUTOMATIC — every tab already writes to localStorage as you type. Come
 *    back in the same browser and it is all still there. Nothing to press.
 *
 * 2. BACKUP FILE — one JSON file with everything in it. Survives clearing your
 *    browser, moves between machines, and is yours to keep.
 *
 * 3. A LINK — the whole dataset packed into a URL you can bookmark or mail to
 *    yourself. Opening it restores everything, which is what makes another
 *    device work without an account.
 *
 * All three carry the same payload, so a file saved today opens from a link
 * tomorrow.
 */

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.Storage = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREFIX = 'finance-app.';
  var FORMAT = 'paycheck-finance/1';
  // Theme is a device preference, not part of your financial data.
  var EXCLUDE = ['finance-app.theme'];

  function keys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0 && EXCLUDE.indexOf(k) === -1) out.push(k);
      }
    } catch (e) { /* storage unavailable */ }
    return out.sort();
  }

  /** Everything the app knows about you, as one plain object. */
  function collect() {
    var data = {};
    keys().forEach(function (k) {
      try {
        data[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k));
      } catch (e) { /* skip anything unreadable rather than failing the export */ }
    });
    return {
      format: FORMAT,
      savedAt: new Date().toISOString(),
      data: data
    };
  }

  /**
   * Write a payload back. Returns how many sections were restored.
   *
   * Existing keys are cleared first, so restoring a backup gives you exactly
   * what was in it rather than a merge of old and new — a half-merged ledger
   * would be worse than either.
   */
  function apply(payload) {
    if (!payload || payload.format !== FORMAT || typeof payload.data !== 'object') {
      throw new Error('That does not look like a Paycheck & Finance backup.');
    }
    keys().forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    });
    var n = 0;
    Object.keys(payload.data).forEach(function (name) {
      try {
        localStorage.setItem(PREFIX + name, JSON.stringify(payload.data[name]));
        n++;
      } catch (e) { /* ignore individual failures */ }
    });
    return n;
  }

  function clear() {
    var k = keys();
    k.forEach(function (key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    });
    return k.length;
  }

  /** Is anything actually saved? Drives the "last saved" line. */
  function summary() {
    var k = keys();
    var bytes = 0;
    k.forEach(function (key) {
      try { bytes += (localStorage.getItem(key) || '').length; } catch (e) { /* ignore */ }
    });
    return { sections: k.length, bytes: bytes, available: isAvailable() };
  }

  /**
   * Whether anything was saved BEFORE this page run started.
   *
   * Snapshotted while this module is parsed, which is before any tab's
   * DOMContentLoaded init can run — several of them write their defaults to
   * storage on startup, so asking later always answers "yes" and a first-time
   * visitor would be treated as a returning one.
   */
  var hadDataAtLoad = keys().length > 0;
  function hadSavedData() { return hadDataAtLoad; }

  function isAvailable() {
    try {
      var probe = PREFIX + '__probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* -------------------------------------------------------------- encoding */

  /**
   * base64 that survives non-ASCII. btoa() throws on anything outside Latin-1,
   * and an account name with an accent in it should not break a backup link.
   * URL-safe alphabet, since this ends up in a fragment.
   */
  function encode(payload) {
    var json = JSON.stringify(payload);
    var bytes = new TextEncoder().encode(json);
    var bin = '';
    // Chunked so a large ledger cannot blow the argument limit on apply().
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode(text) {
    var b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function toLink(baseUrl) {
    var base = (baseUrl || location.href).split('#')[0];
    return base + '#data=' + encode(collect());
  }

  /** Pull a payload out of the current URL, if one is riding along. */
  function fromLocation() {
    var hash = location.hash || '';
    var at = hash.indexOf('data=');
    if (at === -1) return null;
    try {
      return decode(hash.slice(at + 5));
    } catch (e) {
      return null;
    }
  }

  /** Take the payload out of the address bar once used, so a reload is clean. */
  function stripLocation() {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      location.hash = '';
    }
  }

  /* ------------------------------------------------- the local-server mode */

  /*
   * When the app is launched by desktop/server.js (or server.py), there is a
   * real file on this PC behind it. The six tab modules keep writing to
   * localStorage exactly as before and know nothing about any of this — a sync
   * layer mirrors those writes to the file.
   *
   * Doing it here rather than in each tab means one place to get right, and no
   * risk of a tab being added later that forgets to save.
   */

  var server = {
    active: false,
    file: null,
    lastError: null,
    lastSavedAt: null,
    onChange: null      // set by the UI so it can show the status
  };

  function notify() { if (typeof server.onChange === 'function') server.onChange(server); }

  /** Is a local server behind this page? */
  function probeServer() {
    return fetch('api/info', { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || info.mode !== 'local-server') return null;
        server.active = true;
        server.file = info.file;
        return info;
      })
      .catch(function () { return null; });   // no server: ordinary browser mode
  }

  /** Stable comparison of two section maps, so key order cannot fake a change. */
  function sameData(a, b) {
    var ka = Object.keys(a || {}).sort();
    var kb = Object.keys(b || {}).sort();
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return false;
      if (JSON.stringify(a[ka[i]]) !== JSON.stringify(b[kb[i]])) return false;
    }
    return true;
  }

  function loadFromServer() {
    return fetch('api/data')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        if (!payload || !payload.data || !Object.keys(payload.data).length) return 0;

        // Only adopt the file when it actually differs from what this browser
        // already holds. Applying unconditionally made the caller reload on
        // every single load — a permanent reload loop, since the file always
        // has data once you have typed anything.
        if (sameData(collect().data, payload.data)) return 0;

        return apply(payload);
      })
      .catch(function () { return 0; });
  }

  var syncTimer = null;
  var syncing = false;
  var syncAgain = false;

  function pushToServer() {
    if (!server.active) return Promise.resolve(false);
    // One request at a time. Overlapping PUTs could land out of order and write
    // an older snapshot last, which is the one way this could lose data.
    if (syncing) { syncAgain = true; return Promise.resolve(false); }
    syncing = true;

    return fetch('api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect())
    })
      .then(function (r) {
        if (!r.ok) throw new Error('save failed');
        server.lastSavedAt = new Date();
        server.lastError = null;
      })
      .catch(function (e) {
        server.lastError = 'Could not write to the file. Is the app window still running?';
      })
      .then(function () {
        syncing = false;
        notify();
        if (syncAgain) { syncAgain = false; scheduleSync(); }
        return true;
      });
  }

  /** Debounced: typing a salary fires a write per keystroke otherwise. */
  function scheduleSync() {
    if (!server.active) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushToServer, 400);
  }

  /**
   * Watch localStorage for our own keys.
   *
   * Wrapping setItem is the least invasive hook available: every tab already
   * saves through it, so nothing else has to change and nothing can forget.
   */
  function watchWrites() {
    var native = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      native(key, value);
      if (String(key).indexOf(PREFIX) === 0 && EXCLUDE.indexOf(key) === -1) scheduleSync();
    };
    var nativeRemove = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (key) {
      nativeRemove(key);
      if (String(key).indexOf(PREFIX) === 0 && EXCLUDE.indexOf(key) === -1) scheduleSync();
    };
  }

  /**
   * Connect to the file, if there is one. Resolves with how many sections were
   * loaded from disk, or null when running as an ordinary web page.
   *
   * The file wins over localStorage on startup: it is the durable copy, and the
   * browser copy is just this session's working state.
   */
  function connect() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return probeServer().then(function (info) {
      if (!info) return null;
      watchWrites();
      return loadFromServer().then(function (n) {
        notify();
        return n;
      });
    });
  }

  function serverStatus() { return server; }
  function setStatusListener(fn) { server.onChange = fn; }

  function filename() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return 'paycheck-finance-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
  }

  return {
    FORMAT: FORMAT,
    keys: keys,
    collect: collect,
    apply: apply,
    clear: clear,
    summary: summary,
    hadSavedData: hadSavedData,
    isAvailable: isAvailable,
    encode: encode,
    decode: decode,
    toLink: toLink,
    fromLocation: fromLocation,
    stripLocation: stripLocation,
    filename: filename,
    sameData: sameData,
    connect: connect,
    pushToServer: pushToServer,
    serverStatus: serverStatus,
    setStatusListener: setStatusListener
  };
});
