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
set "DASHBOARD_WEB_PORT=2244"

REM Seed .env from .env.example if missing
if not exist "!ROOT!\.env" if exist "!ROOT!\.env.example" (
  copy /y "!ROOT!\.env.example" "!ROOT!\.env" >nul
)

REM Dynamically include standard Windows binary locations in session PATH
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\pnpm;%LOCALAPPDATA%\Microsoft\WinGet\Links;%ProgramFiles%\ffmpeg\bin;C:\ffmpeg\bin;!PATH!"

call :log INFO T:setup startup "root=!ROOT! | profiles=1 | mode=local | concurrency=3 | automation=process+HTTP | web_port=!DASHBOARD_WEB_PORT! | audio=chatterbox-turbo | dual_engine=codex+antigravity | storage=local-only"
call :log STEP T:setup dependencies "Checking Node.js, Corepack, pnpm, and workspace packages"

where node >nul 2>nul
if errorlevel 1 goto install_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto upgrade_node
goto node_ready

:install_node
call :log WARN T:setup node "Node.js 20+ was not found; trying winget"
where winget >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "winget is unavailable. Install Node.js LTS (20+) and run this file again"
  exit /b 1
)
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements >nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js installation failed"
  exit /b 1
)
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;!PATH!"
goto verify_node

:upgrade_node
call :log WARN T:setup node "Node.js is older than 20; trying winget upgrade"
where winget >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js 20+ is required and winget is unavailable"
  exit /b 1
)
winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements >nul
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;!PATH!"

:verify_node
where node >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js is still unavailable after installation"
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup node "Node.js 20+ is required"
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
  call corepack prepare pnpm@latest --activate >nul 2>nul
  set "PATH=%APPDATA%\npm;%LOCALAPPDATA%\pnpm;!PATH!"
)
where pnpm >nul 2>nul
if errorlevel 1 (
  call :log STEP T:setup pnpm "Corepack unavailable; installing pnpm globally via npm"
  call npm install -g pnpm >nul 2>nul
  set "PATH=%APPDATA%\npm;%LOCALAPPDATA%\pnpm;!PATH!"
)
where pnpm >nul 2>nul
if errorlevel 1 (
  call :log ERROR T:setup pnpm "pnpm is unavailable. Run 'npm install -g pnpm' manually"
  exit /b 1
)
for /f "delims=" %%V in ('pnpm --version 2^>nul') do set "PNPM_VERSION=%%V"
call :log OK T:setup pnpm "pnpm !PNPM_VERSION! ready"

call :log STEP T:setup ffmpeg "Checking FFmpeg installation"
where ffmpeg >nul 2>nul
if errorlevel 1 goto install_ffmpeg
goto ffmpeg_ready

:install_ffmpeg
call :log WARN T:setup ffmpeg "FFmpeg was not found; trying winget"
where winget >nul 2>nul
if errorlevel 1 (
  call :log WARN T:setup ffmpeg "winget is unavailable. Install FFmpeg manually or add it to PATH"
  goto ffmpeg_done
)
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements >nul
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%ProgramFiles%\ffmpeg\bin;C:\ffmpeg\bin;!PATH!"
for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*") do (
  for /d %%F in ("%%D\ffmpeg-*\bin") do if exist "%%F\ffmpeg.exe" set "PATH=%%F;!PATH!"
)
where ffmpeg >nul 2>nul
if errorlevel 1 (
  call :log WARN T:setup ffmpeg "FFmpeg was installed but may require restarting or adding to PATH"
  goto ffmpeg_done
)

:ffmpeg_ready
call :log OK T:setup ffmpeg "FFmpeg ready"

:ffmpeg_done

call :log STEP T:setup antigravity "Checking Google Antigravity active session and CLI"
if not defined ANTIGRAVITY_LS_ADDRESS (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p = Get-Process -Name 'language_server' -ErrorAction SilentlyContinue; if ($p) { (Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0') } | Select-Object -First 1).LocalPort }"` ) do (
    if not "%%P"=="" set "ANTIGRAVITY_LS_ADDRESS=localhost:%%P"
  )
)
if defined ANTIGRAVITY_LS_ADDRESS (
  call :log OK T:setup antigravity "Antigravity active IDE session detected (!ANTIGRAVITY_LS_ADDRESS!)"
) else (
  where agy >nul 2>nul
  if errorlevel 1 (
    call :log WARN T:setup antigravity "agy CLI was not detected in PATH. Antigravity engine can use custom path or Gemini API key from Settings"
  ) else (
    agy whoami >nul 2>nul
    if errorlevel 1 (
      call :log WARN T:setup antigravity "agy CLI found but not logged in. Run 'agy auth login' to enable OAuth subscription quota"
    ) else (
      call :log OK T:setup antigravity "Google Antigravity CLI authenticated"
    )
  )
)

call :log STEP T:setup install "Installing workspace dependencies"
call pnpm install --frozen-lockfile >nul 2>nul
if errorlevel 1 (
  call :log WARN T:setup install "Lockfile mismatch detected; resolving dependencies"
  call pnpm install
  if errorlevel 1 (
    call :log ERROR T:setup install "Dependency installation failed"
    exit /b 1
  )
)
call :log OK T:setup install "Workspace dependencies ready"

call :log STEP T:setup build "Building shared workspace package"
call pnpm --filter @studio/shared build
if errorlevel 1 (
  call :log ERROR T:setup build "Shared workspace package build failed"
  exit /b 1
)
call :log OK T:setup build "Shared workspace package ready"

call :log STEP T:setup bgm "Checking background music assets"
powershell -NoProfile -ExecutionPolicy Bypass -File "!ROOT!\scripts\ensure-bgm.ps1" -TargetDir "!ROOT!\assets\audio\bgm\tracks"
if errorlevel 1 (
  call :log WARN T:setup bgm "BGM sync was skipped or offline; dashboard will continue"
) else (
  call :log OK T:setup bgm "Background music assets ready"
)

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
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:!DASHBOARD_WEB_PORT!/' -TimeoutSec 2; if ($page.Content -match '<title>AI Documentary Studio</title>') { exit 0 }; exit 2 } catch { exit 1 }" >nul 2>nul
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
call :log STEP T:setup wait "Waiting for http://127.0.0.1:!DASHBOARD_WEB_PORT!"
for /l %%I in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $config = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:4310/api/config' -TimeoutSec 2; if ($null -eq $config.audio_generation) { exit 1 }; Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:!DASHBOARD_WEB_PORT!/' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto dashboard_ready
  timeout /t 1 /nobreak >nul
)
call :log WARN T:setup wait "Dashboard did not answer within 30 seconds; opening the URL anyway"

:dashboard_ready
start "" "http://127.0.0.1:!DASHBOARD_WEB_PORT!/"
call :log OK T:setup done "Dashboard opened at http://127.0.0.1:!DASHBOARD_WEB_PORT!/. Keep the server window running while working"
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
