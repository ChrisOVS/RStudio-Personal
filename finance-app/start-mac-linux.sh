#!/usr/bin/env bash
# Run Paycheck & Finance on this machine.
# Tries Node first, then Python. You need one of them, not both.

cd "$(dirname "$0")" || exit 1

if command -v node >/dev/null 2>&1; then
  exec node desktop/server.js
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 desktop/server.py
fi

cat <<'MSG'

  Neither Node nor Python 3 was found.

  Install either one, then run this again:
    Node    https://nodejs.org
    Python  https://www.python.org/downloads/

  Or open dist/paycheck-calculator.html in your browser — that works with
  nothing installed, but saves inside the browser rather than to a file.

MSG
exit 1
