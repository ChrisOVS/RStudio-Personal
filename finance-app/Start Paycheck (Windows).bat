@echo off
REM Double-click this to run Paycheck & Finance on this PC.
REM It tries Node first, then Python. You need one of them; you do not need both,
REM and there is nothing to install beyond that.

cd /d "%~dp0"
title Paycheck ^& Finance

where node >nul 2>nul
if %errorlevel%==0 (
  node "desktop\server.js"
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  python "desktop\server.py"
  goto :end
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "desktop\server.py"
  goto :end
)

echo.
echo   Neither Node nor Python was found on this PC.
echo.
echo   Install either one, then double-click this file again:
echo     Node    https://nodejs.org         (pick the LTS installer)
echo     Python  https://www.python.org/downloads/
echo.
echo   Or, with nothing installed at all, just open this file in your browser:
echo     dist\paycheck-calculator.html
echo   It works, but it saves inside the browser rather than to a file.
echo.
pause

:end
