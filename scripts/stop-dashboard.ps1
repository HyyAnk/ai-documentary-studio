param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$DelayMilliseconds = 0
)

$ErrorActionPreference = "SilentlyContinue"
$worker = "stop-dashboard"
$ports = @(4310, 2233, 8890)
$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd("\").ToLowerInvariant()
$startedAt = Get-Date
$stopped = 0
$failed = 0

function Write-Log {
  param(
    [string]$Level,
    [string]$Step,
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )

  $timestamp = (Get-Date).ToString("HH:mm:ss")
  Write-Host ("[{0}] [{1}] [T:{2}] [STEP:{3}] {4}" -f $timestamp, $Level, $worker, $Step, $Message) -ForegroundColor $Color
}

Write-Log "INFO" "startup" ("root={0} | ports={1} | mode=local-only | automation=process" -f $resolvedRoot, ($ports -join ","))
if ($DelayMilliseconds -gt 0) {
  Write-Log "STEP" "delay" ("Waiting {0}ms for the shutdown response to finish" -f $DelayMilliseconds) ([ConsoleColor]::Blue)
  Start-Sleep -Milliseconds $DelayMilliseconds
}

foreach ($port in $ports) {
  Write-Log "STEP" "inspect" ("Checking local service on port {0}" -f $port) ([ConsoleColor]::Blue)
  $connections = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $port -State Listen)
  $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)

  if ($processIds.Count -eq 0) {
    Write-Log "INFO" "inspect" ("No service found on port {0}" -f $port)
    continue
  }

  foreach ($processId in $processIds) {
    $process = Get-Process -Id $processId
    if ($null -eq $process) {
      Write-Log "WARN" "stop" ("Process {0} disappeared before it could be stopped" -f $processId) ([ConsoleColor]::Yellow)
      continue
    }

    $metadata = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $processId)
    $commandLine = ([string]$metadata.CommandLine).Replace("/", "\").ToLowerInvariant()
    if (-not $commandLine.Contains($resolvedRoot)) {
      $failed++
      Write-Log "ERROR" "guard" ("Refusing to stop PID {0} on port {1}: it is not running from this workspace" -f $processId, $port) ([ConsoleColor]::Red)
      continue
    }

    Write-Log "STEP" "stop" ("Stopping {0} (PID {1}) for port {2}" -f $process.ProcessName, $processId, $port) ([ConsoleColor]::Blue)
    Stop-Process -Id $processId -Force
    if (Get-Process -Id $processId) {
      $failed++
      Write-Log "ERROR" "stop" ("Could not stop PID {0}; close the local service manually if it remains" -f $processId) ([ConsoleColor]::Red)
    } else {
      $stopped++
      Write-Log "OK" "stop" ("Stopped PID {0} on port {1}" -f $processId, $port) ([ConsoleColor]::Green)
    }
  }
}

# The launcher uses a dedicated window title. Closing that process tree prevents
# pnpm/concurrently watchers from restarting a service after its listener exits.
$launcher = @(Get-Process -Name cmd | Where-Object { $_.MainWindowTitle -eq "AI Documentary Studio" })
foreach ($process in $launcher) {
  Write-Log "STEP" "launcher" ("Stopping launcher process tree PID {0}" -f $process.Id) ([ConsoleColor]::Blue)
  & taskkill.exe /PID $process.Id /T /F >$null 2>&1
  if ($LASTEXITCODE -eq 0) {
    $stopped++
    Write-Log "OK" "launcher" ("Launcher process tree {0} stopped" -f $process.Id) ([ConsoleColor]::Green)
  } else {
    $failed++
    Write-Log "WARN" "launcher" ("Launcher process tree {0} was already closed or could not be found" -f $process.Id) ([ConsoleColor]::Yellow)
  }
}

$elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
if ($failed -gt 0) {
  Write-Log "ERROR" "summary" ("total={0} | stopped={1} | failed={2} | elapsed={3}s" -f $ports.Count, $stopped, $failed, $elapsed) ([ConsoleColor]::Red)
  exit 1
}

Write-Log "OK" "summary" ("total={0} | stopped={1} | failed=0 | data=untouched | elapsed={2}s" -f $ports.Count, $stopped, $elapsed) ([ConsoleColor]::Green)
exit 0
