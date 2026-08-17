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
    isAvailable: isAvailable,
    encode: encode,
    decode: decode,
    toLink: toLink,
    fromLocation: fromLocation,
    stripLocation: stripLocation,
    filename: filename
  };
});
