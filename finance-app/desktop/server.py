#!/usr/bin/env python3
"""
server.py - run Paycheck & Finance as an app on your own machine.

    python desktop/server.py

Identical to desktop/server.js in what it does and where it saves; this version
exists so the app runs whether you have Node or Python installed, without having
to install either. Standard library only.

Your figures go to a real file on this PC. The socket binds to 127.0.0.1, so
nothing on your network can reach it.
"""

import json
import os
import shutil
import sys
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(APP_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "paycheck-finance.json")
HOST = "127.0.0.1"
START_PORT = int(os.environ.get("PORT", "4321"))
MAX_BODY = 5 * 1024 * 1024

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def read_data():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def write_data(payload):
    """Write to a temp file then rename.

    Rename is atomic, so an interruption mid-write leaves the previous file
    intact instead of a truncated one.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    os.replace(tmp, DATA_FILE)


def backup_existing():
    """Keep the last 20 versions, so a bad import is recoverable."""
    if not os.path.exists(DATA_FILE):
        return
    try:
        backups = os.path.join(DATA_DIR, "backups")
        os.makedirs(backups, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        shutil.copyfile(DATA_FILE, os.path.join(backups, "paycheck-finance-%s.json" % stamp))
        kept = sorted(os.listdir(backups))
        while len(kept) > 20:
            os.unlink(os.path.join(backups, kept.pop(0)))
    except Exception:
        pass  # a backup failing must never block the save


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # the default access log is noise here

    def _send(self, code, body, ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)

        if path == "/api/data":
            data = read_data() or {"format": None, "data": {}}
            return self._send(200, json.dumps(data), "application/json; charset=utf-8")

        if path == "/api/info":
            return self._send(200, json.dumps({
                "mode": "local-server",
                "file": DATA_FILE,
                "exists": os.path.exists(DATA_FILE),
            }), "application/json; charset=utf-8")

        rel = "index.html" if path == "/" else path.lstrip("/")
        full = os.path.realpath(os.path.join(APP_DIR, rel))
        # Resolve first, then check the prefix: that is what stops ../../ from
        # walking out of the app directory into the rest of the disk.
        if full != APP_DIR and not full.startswith(APP_DIR + os.sep):
            return self._send(403, "Forbidden")
        try:
            with open(full, "rb") as fh:
                body = fh.read()
        except OSError:
            return self._send(404, "Not found")
        ext = os.path.splitext(full)[1].lower()
        self._send(200, body, TYPES.get(ext, "application/octet-stream"))

    def do_PUT(self):
        if unquote(urlparse(self.path).path) != "/api/data":
            return self._send(405, "Method not allowed")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._send(400, json.dumps({"error": "Bad body size"}),
                              "application/json; charset=utf-8")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return self._send(400, json.dumps({"error": "Could not parse that as JSON."}),
                              "application/json; charset=utf-8")
        backup_existing()
        write_data(payload)
        sys.stdout.write("  saved  %s\n" % datetime.now().strftime("%H:%M:%S"))
        sys.stdout.flush()
        self._send(200, json.dumps({"ok": True, "file": DATA_FILE}),
                   "application/json; charset=utf-8")


def main():
    port = START_PORT
    httpd = None
    for _ in range(20):
        try:
            httpd = ThreadingHTTPServer((HOST, port), Handler)
            break
        except OSError:
            port += 1
    if httpd is None:
        print("Could not find a free port.")
        sys.exit(1)

    os.makedirs(DATA_DIR, exist_ok=True)
    address = "http://%s:%d/" % (HOST, port)
    print("")
    print("  Paycheck & Finance is running")
    print("")
    print("  Open        %s" % address)
    print("  Saving to   %s" % DATA_FILE)
    print("")
    print("  Your figures are written to that file as you type.")
    print("  Nothing leaves this computer. Press Ctrl+C to stop.")
    print("")
    if os.environ.get("NO_OPEN") != "1":
        try:
            webbrowser.open(address)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped. Your figures are saved in %s\n" % DATA_FILE)


if __name__ == "__main__":
    main()
