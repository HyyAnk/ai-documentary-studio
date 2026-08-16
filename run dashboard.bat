@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

for /f "delims=" %%A in ('echo prompt $E^| cmd') do set "ESC=%%A"
set "C_RESET=!ESC![0m"
set "C_INFO=!ESC![36m"
set "C_OK=!ESC![32m"
set "C_WARN=!ESC![33m"
set "C_ERROR=!ESC![1;31m"
set "C_STEP=!ESC![1;34m"
set "C_DEBUG=!ESC![2m"

call :log INFO T:setup startup "root=!ROOT! | profiles=1 | mode=local | concurrency=3 | automation=process+HTTP | storage=local-only"
call :log STEP T:setup dependencies "Checking Node.js, Corepack, pnpm, and workspace packages"

where node >nul 2>nul
if errorlevel 1 goto install_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto upgrade_node
goto node_ready

:install_node
call :log WARN T:setup node "Node.js 24+ was not found; trying winget"
where winget >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "winget is unavailable. Install Node.js 24+ and run this file again"
  exit /b 1
)
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements >nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js installation failed"
  exit /b 1
)
set "PATH=%ProgramFiles%\nodejs;%PATH%"
goto verify_node

:upgrade_node
call :log WARN T:setup node "Node.js is older than 24; trying winget upgrade"
where winget >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js 24+ is required and winget is unavailable"
  exit /b 1
)
winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements >nul
set "PATH=%ProgramFiles%\nodejs;%PATH%"

:verify_node
where node >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js is still unavailable after installation"
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js 24+ is required"
  exit /b 1
)

:node_ready
for /f "delims=" %%V in ('node --version 2^>nul') do set "NODE_VERSION=%%V"
call :log OK T:setup node "Node.js !NODE_VERSION! ready"

call :log STEP T:setup pnpm "Enabling pnpm through Corepack"
call corepack enable >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup pnpm "Corepack could not be enabled"
  exit /b 1
)
call corepack prepare pnpm@11.0.0 --activate >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup pnpm "pnpm could not be activated"
  exit /b 1
)
for /f "delims=" %%V in ('pnpm --version 2^>nul') do set "PNPM_VERSION=%%V"
call :log OK T:setup pnpm "pnpm !PNPM_VERSION! ready"

call :log STEP T:setup install "Installing locked workspace dependencies"
call pnpm install --frozen-lockfile
if errorlevel 1 (
  call :log ERROR T:setup install "Dependency installation failed"
  exit /b 1
)
call :log OK T:setup install "Workspace dependencies ready"

call :log STEP T:setup launch "Starting local server and dashboard"
start "AI Documentary Studio" /D "%ROOT%" cmd /k "pnpm dev"

call :log STEP T:setup wait "Waiting for http://127.0.0.1:5173"
for /l %%I in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto dashboard_ready
  timeout /t 1 /nobreak >nul
)
call :log WARN T:setup wait "Dashboard did not answer within 30 seconds; opening the URL anyway"

:dashboard_ready
start "" "http://127.0.0.1:5173/"
call :log OK T:setup done "Dashboard opened. Keep the server window running while working"
exit /b 0

:log
set "LEVEL=%~1"
set "WORKER=%~2"
set "STEP=%~3"
set "MESSAGE=%~4"
set "COLOR=!C_INFO!"
if /i "!LEVEL!"=="OK" set "COLOR=!C_OK!"
if /i "!LEVEL!"=="WARN" set "COLOR=!C_WARN!"
if /i "!LEVEL!"=="ERROR" set "COLOR=!C_ERROR!"
if /i "!LEVEL!"=="STEP" set "COLOR=!C_STEP!"
if /i "!LEVEL!"=="DEBUG" set "COLOR=!C_DEBUG!"
echo !COLOR![%time:~0,8%] [!LEVEL!] [!WORKER!] [STEP:!STEP!] !MESSAGE!!C_RESET!
exit /b 0
