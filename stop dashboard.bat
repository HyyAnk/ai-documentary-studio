@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

for /f "delims=" %%A in ('echo prompt $E^| cmd') do set "ESC=%%A"
set "C_INFO=!ESC![36m"
set "C_OK=!ESC![32m"
set "C_ERROR=!ESC![1;31m"

echo !C_INFO![%time:~0,8%] [STEP] [T:stop-dashboard] [STEP:shutdown] Stopping local dashboard services...!ESC![0m
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\stop-dashboard.ps1" -ProjectRoot "%ROOT%"
if errorlevel 1 (
  echo !C_ERROR![%time:~0,8%] [ERROR] [T:stop-dashboard] [STEP:shutdown] Some services could not be stopped.!ESC![0m
  exit /b 1
)

echo !C_OK![%time:~0,8%] [OK] [T:stop-dashboard] [STEP:shutdown] Dashboard stopped. Channel data was left untouched.!ESC![0m
exit /b 0
