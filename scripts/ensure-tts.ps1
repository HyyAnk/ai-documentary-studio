[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$ttsRoot = Join-Path $project "services\tts"
$venvRoot = Join-Path $ttsRoot ".venv"
$ttsPython = Join-Path $venvRoot "Scripts\python.exe"
$requirements = Join-Path $ttsRoot "requirements.txt"
$runtimeRoot = Join-Path $project ".documentary-studio\logs"
$worker = "main"
$profile = "tts"
$desiredModel = "turbo"

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

function Write-Log {
  param(
    [ValidateSet("INFO", "STEP", "OK", "WARN", "ERROR")]
    [string]$Level,
    [string]$Step,
    [string]$Message
  )

  $timestamp = Get-Date -Format "HH:mm:ss"
  $color = switch ($Level) {
    "OK" { "Green" }
    "WARN" { "Yellow" }
    "ERROR" { "Red" }
    "STEP" { "Blue" }
    default { "Cyan" }
  }
  Write-Host "[$timestamp] [$Level] [W:$worker] [P:$profile] [STEP:$Step] $Message" -ForegroundColor $color
}

function Invoke-Checked {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [string]$Step,
    [string]$OutputPrefix
  )

  $stdout = Join-Path $runtimeRoot "$OutputPrefix.stdout.log"
  $stderr = Join-Path $runtimeRoot "$OutputPrefix.stderr.log"
  $argumentLine = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
  $process = Start-Process -FilePath $Executable -ArgumentList $argumentLine -WorkingDirectory $project -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if ($process.ExitCode -ne 0) {
    Write-Log "ERROR" $Step "Command failed with exit code $($process.ExitCode). See $stdout and $stderr"
    return $false
  }
  return $true
}

function Find-PythonLauncher {
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($null -ne $py) {
    foreach ($version in @("3.11", "3.10", "3.13")) {
      try { & $py.Source "-$version" "--version" > $null 2> $null } catch { $global:LASTEXITCODE = 1 }
      if ($LASTEXITCODE -eq 0) {
        return @{ Executable = $py.Source; Arguments = @("-$version") }
      }
    }
  }

  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($null -ne $python) {
    $versionText = (& $python.Source "--version" 2>&1 | Out-String).Trim()
    if ($versionText -match "Python\s+3\.(10|11|13)(\.|$)") {
      return @{ Executable = $python.Source; Arguments = @() }
    }
  }
  return $null
}

function Ensure-Python {
  $launcher = Find-PythonLauncher
  if ($null -ne $launcher) { return $launcher }

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($null -eq $winget) {
    Write-Log "ERROR" "python" "Python 3.10, 3.11, or 3.13 was not found and winget is unavailable"
    return $null
  }

  Write-Log "STEP" "python" "Installing Python 3.11 through winget"
  & $winget.Source "install" "--id" "Python.Python.3.11" "-e" "--accept-source-agreements" "--accept-package-agreements" > $null 2> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR" "python" "Python installation failed"
    return $null
  }
  $launcher = Find-PythonLauncher
  if ($null -eq $launcher) { Write-Log "ERROR" "python" "Python was installed but could not be located in this shell" }
  return $launcher
}

function Get-TtsHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8890/health" -TimeoutSec 2
    $payload = $response.Content | ConvertFrom-Json
    return @{ Seen = $true; Ready = ($payload.model_loaded -eq $true); Payload = $payload }
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $payload = ($reader.ReadToEnd() | ConvertFrom-Json)
        $reader.Dispose()
        return @{ Seen = $true; Ready = ($payload.model_loaded -eq $true); Payload = $payload }
      } catch { }
    }
    return @{ Seen = $false; Ready = $false; Payload = $null }
  }
}

function Stop-TtsListener {
  $connections = Get-NetTCPConnection -LocalPort 8890 -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    Write-Log "WARN" "restart" "Stopping existing Chatterbox process $($connection.OwningProcess) so Turbo can be enabled"
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

function Restore-EnvironmentValue {
  param(
    [string]$Name,
    [AllowNull()][string]$Value
  )

  if ($null -eq $Value) {
    Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item "Env:$Name" $Value
  }
}

Write-Log "STEP" "startup" "Preparing local Chatterbox runtime"
$launcher = Ensure-Python
if ($null -eq $launcher) { exit 1 }
Write-Log "OK" "python" "Python launcher ready: $($launcher.Executable) $($launcher.Arguments -join ' ')"

if (-not (Test-Path -LiteralPath $ttsPython)) {
  Write-Log "STEP" "venv" "Creating isolated Python environment"
  $venvArguments = @($launcher.Arguments) + @("-m", "venv", $venvRoot)
  & $launcher.Executable @venvArguments > $null 2> $null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ttsPython)) {
    Write-Log "ERROR" "venv" "Could not create $venvRoot"
    exit 1
  }
  Write-Log "OK" "venv" "Python environment created"
}

$importCheck = @'
import importlib.util
required = ('chatterbox', 'fastapi', 'uvicorn', 'torch', 'torchaudio', 'perth')
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
    raise SystemExit(1)
import perth
raise SystemExit(0 if getattr(perth, 'PerthImplicitWatermarker', None) is not None else 1)
'@
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$probeOutput = & $ttsPython "-c" $importCheck 2>&1
$importExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
if ($importExitCode -ne 0) {
  Write-Log "STEP" "dependencies" "Installing Chatterbox, PyTorch, and the local HTTP service"
  if (-not (Invoke-Checked $ttsPython @("-m", "pip", "install", "--upgrade", "pip", "setuptools<81", "wheel") "dependencies" "tts-pip-bootstrap")) { exit 1 }
  if (-not (Invoke-Checked $ttsPython @("-m", "pip", "install", "-r", $requirements) "dependencies" "tts-pip-install")) { exit 1 }
  Write-Log "OK" "dependencies" "Chatterbox dependencies installed"
} else {
  Write-Log "OK" "dependencies" "Chatterbox dependencies already installed"
}

$health = Get-TtsHealth
if ($health.Seen -and ($null -eq $health.Payload -or $health.Payload.model -ne $desiredModel -or $health.Payload.paralinguistic_tags -ne $true)) {
  $activeModel = if ($null -ne $health.Payload -and $health.Payload.model) { $health.Payload.model } else { "unknown" }
  Write-Log "WARN" "model" "Existing Chatterbox sidecar is $activeModel; switching to Turbo with native laughter cues"
  Stop-TtsListener
  for ($attempt = 1; $attempt -le 15; $attempt++) {
    if (-not (Get-TtsHealth).Seen) { break }
    Start-Sleep -Milliseconds 200
  }
  $health = Get-TtsHealth
}
if (-not $health.Seen) {
  Write-Log "STEP" "launch" "Starting Chatterbox Turbo sidecar on 127.0.0.1:8890"
  $stdout = Join-Path $runtimeRoot "tts.stdout.log"
  $stderr = Join-Path $runtimeRoot "tts.stderr.log"
  $previousModel = $env:CHATTERBOX_MODEL
  $env:CHATTERBOX_MODEL = $desiredModel
  try {
    Start-Process -FilePath $ttsPython -ArgumentList @("-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8890") -WorkingDirectory $ttsRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
  } finally {
    Restore-EnvironmentValue "CHATTERBOX_MODEL" $previousModel
  }
} else {
  Write-Log "INFO" "launch" "Chatterbox Turbo sidecar is already responding; waiting for model readiness"
}

for ($attempt = 1; $attempt -le 300; $attempt++) {
  $health = Get-TtsHealth
  if ($health.Ready -and $null -ne $health.Payload -and $health.Payload.model -eq $desiredModel -and $health.Payload.paralinguistic_tags -eq $true) {
    Write-Log "OK" "health" "Chatterbox Turbo is ready with native laughter cues"
    exit 0
  }
  if ($attempt -eq 1 -or $attempt % 15 -eq 0) {
    $detail = if ($null -ne $health.Payload -and $health.Payload.error) { ": $($health.Payload.error)" } else { "" }
    Write-Log "INFO" "health" "Waiting for Chatterbox model readiness ($attempt/300)$detail"
  }
  Start-Sleep -Seconds 1
}

Write-Log "ERROR" "health" "Chatterbox did not become ready within 5 minutes. Check .documentary-studio/logs/tts.stderr.log"
exit 1
