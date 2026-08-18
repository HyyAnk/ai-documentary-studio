@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
if "!ROOT:~-1!"=="\" set "ROOT=!ROOT:~0,-1!"
cd /d "%ROOT%"

for /f "delims=" %%A in ('echo prompt $E^| cmd') do set "ESC=%%A"
set "C_RESET=!ESC![0m"
set "C_INFO=!ESC![36m"
set "C_OK=!ESC![32m"
set "C_WARN=!ESC![33m"
set "C_ERROR=!ESC![1;31m"
set "C_STEP=!ESC![1;34m"
set "C_DEBUG=!ESC![2m"

set "CHATTERBOX_MODEL=turbo"
call :log INFO T:setup startup "root=!ROOT! | profiles=1 | mode=local | concurrency=3 | automation=process+HTTP | audio=chatterbox-turbo | storage=local-only"
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

call :log STEP T:setup pnpm "Checking pnpm installation"
where pnpm >nul 2>nul
if errorlevel 1 (
  call :log STEP T:setup pnpm "pnpm was not found; enabling it through Corepack"
  call corepack enable >nul 2>nul
  if errorlevel 1 (
    call :log ERROR T:setup pnpm "pnpm is unavailable and Corepack could not be enabled"
    exit /b 1
  )
  call corepack prepare pnpm@11.0.0 --activate >nul 2>nul
  if errorlevel 1 (
    call :log ERROR T:setup pnpm "pnpm could not be activated"
    exit /b 1
  )
)
where pnpm >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup pnpm "pnpm is unavailable"
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

call :log STEP T:setup audio "Preparing Chatterbox Turbo TTS runtime and waiting for native laughter support"
powershell -NoProfile -ExecutionPolicy Bypass -File "!ROOT!\scripts\ensure-tts.ps1" -ProjectRoot "!ROOT!"
if errorlevel 1 (
  call :log ERROR T:setup audio "Chatterbox could not be prepared. Dashboard startup stopped so Generate Audio is not silently unavailable"
  exit /b 1
)
call :log OK T:setup audio "Chatterbox sidecar is ready"

call :log STEP T:setup launch "Checking local server and web app versions"
set "SERVER_READY=0"
set "WEB_READY=0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $config = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:4310/api/config' -TimeoutSec 2; if ($null -ne $config.audio_generation) { exit 0 }; exit 2 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 set "SERVER_READY=1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($page.Content -match '<title>AI Documentary Studio</title>') { exit 0 }; exit 2 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 set "WEB_READY=1"

if "!SERVER_READY!"=="1" if "!WEB_READY!"=="1" (
  call :log OK T:setup launch "Local server and web app are already running"
  goto wait_for_dashboard
)

if "!SERVER_READY!"=="0" (
  call :log STEP T:setup launch "Stopping stale local server before starting the current version"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$connections = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue; foreach ($connection in $connections) { Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul
  start "AI Documentary Studio" /D "%ROOT%" cmd /k "pnpm dev"
) else if "!WEB_READY!"=="0" (
  call :log STEP T:setup launch "Local server is running; starting the web app"
  start "AI Documentary Studio Web" /D "%ROOT%" cmd /k "pnpm --filter @studio/web dev"
)

:wait_for_dashboard
call :log STEP T:setup wait "Waiting for http://127.0.0.1:5173"
for /l %%I in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $config = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:4310/api/config' -TimeoutSec 2; if ($null -eq $config.audio_generation) { exit 1 }; Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto dashboard_ready
  timeout /t 1 /nobreak >nul
)
call :log WARN T:setup wait "Dashboard did not answer within 30 seconds; opening the URL anyway"

:dashboard_ready
start "" "http://127.0.0.1:5173/"
call :log OK T:setup done "Dashboard opened. Keep the server window running while working"
call :log OK T:setup summary "total=1 | success=1 | failed=0 | skipped=0 | retries=0 | elapsed=bootstrap complete"
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
