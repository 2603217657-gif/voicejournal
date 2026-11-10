@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

node scripts\install-model.js
set "RC=%ERRORLEVEL%"
goto :done

:nonode
echo Node.js is required but was not found on this computer.
echo Install Node.js 20 or newer from https://nodejs.org/ then run this file again.
set "RC=1"

:done
echo.
pause
exit /b %RC%
