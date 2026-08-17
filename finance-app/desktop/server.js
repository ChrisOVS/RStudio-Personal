#!/usr/bin/env node
/*
 * server.js — run Paycheck & Finance as an app on your own machine.
 *
 *   node desktop/server.js
 *
 * Serves the app and stores your figures in a real file on this PC, which you
 * can back up, copy to another machine, or open in a text editor. Nothing
 * leaves the computer: the socket binds to 127.0.0.1, so it is not reachable
 * from your network even on shared wifi.
 *
 * No dependencies. Node's own http/fs only, so there is nothing to install and
 * nothing to keep patched.
 */

'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var url = require('url');
var { execFile } = require('child_process');

var APP_DIR = path.resolve(__dirname, '..');
var DATA_DIR = path.join(APP_DIR, 'data');
var DATA_FILE = path.join(DATA_DIR, 'paycheck-finance.json');
var HOST = '127.0.0.1';
var START_PORT = Number(process.env.PORT) || 4321;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* --------------------------------------------------------------- the data -- */

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * Write via a temp file and rename.
 *
 * A rename is atomic on every OS this runs on, so a crash or a power cut in the
 * middle leaves the previous file intact rather than a half-written one. Writing
 * in place would risk losing everything to a badly timed interruption.
 */
function writeData(payload) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  var tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

/** Keep a rolling set of backups, so a bad import is recoverable. */
function backupExisting() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(DATA_FILE, path.join(DATA_DIR, 'backups', 'paycheck-finance-' + stamp + '.json'));

    var kept = fs.readdirSync(path.join(DATA_DIR, 'backups')).sort();
    while (kept.length > 20) {
      fs.unlinkSync(path.join(DATA_DIR, 'backups', kept.shift()));
    }
  } catch (e) { /* a backup failing must never block the save */ }
}

/* ------------------------------------------------------------- the server -- */

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, function (err, buf) {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, buf, TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
}

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url);
  var pathname = decodeURIComponent(parsed.pathname);

  if (pathname === '/api/data') {
    if (req.method === 'GET') {
      var data = readData();
      return send(res, 200, JSON.stringify(data || { format: null, data: {} }),
        'application/json; charset=utf-8');
    }

    if (req.method === 'PUT') {
      var chunks = [];
      var size = 0;
      req.on('data', function (c) {
        size += c.length;
        // A finance ledger is kilobytes. Anything past this is a mistake or an
        // attempt to fill the disk, and neither should be written.
        if (size > 5 * 1024 * 1024) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', function () {
        try {
          var payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          backupExisting();
          writeData(payload);
          send(res, 200, JSON.stringify({ ok: true, file: DATA_FILE }),
            'application/json; charset=utf-8');
          process.stdout.write('  saved  ' + new Date().toLocaleTimeString() + '\n');
        } catch (e) {
          send(res, 400, JSON.stringify({ error: 'Could not parse that as JSON.' }),
            'application/json; charset=utf-8');
        }
      });
      return;
    }
    return send(res, 405, 'Method not allowed');
  }

  if (pathname === '/api/info') {
    return send(res, 200, JSON.stringify({
      mode: 'local-server',
      file: DATA_FILE,
      exists: fs.existsSync(DATA_FILE)
    }), 'application/json; charset=utf-8');
  }

  // Static files, confined to the app directory. Resolving first and then
  // checking the prefix is what stops ../../ escaping to the rest of the disk.
  var rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  var full = path.resolve(APP_DIR, rel);
  if (full !== APP_DIR && !full.startsWith(APP_DIR + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  serveFile(res, full);
});

/* ---------------------------------------------------------------- startup -- */

function openBrowser(target) {
  var cmd = process.platform === 'win32' ? 'cmd'
          : process.platform === 'darwin' ? 'open'
          : 'xdg-open';
  var args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  execFile(cmd, args, function () { /* opening is a nicety, not a requirement */ });
}

function listen(port, attemptsLeft) {
  server.once('error', function (err) {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      return listen(port + 1, attemptsLeft - 1);
    }
    console.error('\nCould not start: ' + err.message);
    process.exit(1);
  });

  server.listen(port, HOST, function () {
    var address = 'http://' + HOST + ':' + port + '/';
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('');
    console.log('  Paycheck & Finance is running');
    console.log('');
    console.log('  Open        ' + address);
    console.log('  Saving to   ' + DATA_FILE);
    console.log('');
    console.log('  Your figures are written to that file as you type.');
    console.log('  Nothing leaves this computer. Press Ctrl+C to stop.');
    console.log('');
    if (process.env.NO_OPEN !== '1') openBrowser(address);
  });
}

listen(START_PORT, 20);

process.on('SIGINT', function () {
  console.log('\n  Stopped. Your figures are saved in ' + DATA_FILE + '\n');
  process.exit(0);
});
