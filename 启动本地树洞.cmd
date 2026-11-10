@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist "index.html" (
  echo Cannot find index.html in this folder.
  echo Please extract the whole ZIP first, then run this file inside the ai-treehole folder.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 goto :offline

node scripts\start-local.js
set "RC=%ERRORLEVEL%"
goto :done

:offline
echo Node.js was not found on this computer. Opening the offline demo instead.
start "" "%~dp0index.html"
set "RC=0"

:done
echo.
pause
exit /b %RC%
