param (
    [string]$Version = "v1.0.0",
    [string]$Repo = "HyyAnk/ai-documentary-studio",
    [string]$TargetDir = "$PSScriptRoot\..\assets\audio\bgm\tracks",
    [string]$CustomUrl = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

$existingMp3s = Get-ChildItem -Path $TargetDir -Filter "*.mp3" -ErrorAction SilentlyContinue
$count = $existingMp3s.Count

if ($count -ge 40) {
    Write-Host "✅ Kho BGM da san sang: $count file MP3 trong $TargetDir" -ForegroundColor Green
    exit 0
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  ENSURE BGM ASSETS (GitHub Release Sync)" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "⚠️ Phat hien thieu file BGM (Hien co: $count file). Dang tien hanh dong bo..." -ForegroundColor Yellow

$releaseTag = "$Version-assets"
$zipName = "kid-bgm-$Version.zip"
$downloadUrl = if ($CustomUrl) { $CustomUrl } else { "https://github.com/$Repo/releases/download/$releaseTag/$zipName" }
$tempZip = Join-Path $PSScriptRoot "temp-$zipName"

try {
    Write-Host "📥 Dang tai $zipName tu GitHub Release ($downloadUrl)..." -ForegroundColor Cyan
    
    # Check if gh CLI is available for fast authenticated download
    $ghAvailable = (Get-Command gh -ErrorAction SilentlyContinue) -ne $null
    $downloaded = $false
    
    if ($ghAvailable) {
        try {
            Write-Host "  -> Dang su dung GitHub CLI (gh release download)..." -ForegroundColor Gray
            gh release download $releaseTag --repo $Repo --pattern $zipName --dir $PSScriptRoot
            if (Test-Path (Join-Path $PSScriptRoot $zipName)) {
                Move-Item -Path (Join-Path $PSScriptRoot $zipName) -Destination $tempZip -Force
                $downloaded = $true
            }
        } catch {
            Write-Host "  -> gh CLI chua dang nhap hoac khong tim thay release, chuyen sang tai truc tiep HTTP..." -ForegroundColor Yellow
        }
    }
    
    if (-not $downloaded) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing
    }

    Write-Host "📦 Dang giai nen BGM vao: $TargetDir ..." -ForegroundColor Cyan
    Expand-Archive -Path $tempZip -DestinationPath $TargetDir -Force
    Remove-Item -Path $tempZip -Force

    $finalCount = (Get-ChildItem -Path $TargetDir -Filter "*.mp3").Count
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host "✅ Dong bo BGM thanh cong! Tong cong: $finalCount file MP3." -ForegroundColor Green
    Write-Host "======================================================" -ForegroundColor Green
} catch {
    Write-Host "❌ Khong the tu dong tai BGM tu GitHub Release: $_" -ForegroundColor Red
    Write-Host "💡 Huong dan khac phuc:" -ForegroundColor Yellow
    Write-Host "   1. Dam bao ban da tao Release '$releaseTag' tren GitHub voi file '$zipName'." -ForegroundColor Yellow
    Write-Host "   2. Hoac copy truc tiep cac file .mp3 vao thu muc: $TargetDir" -ForegroundColor Yellow
    if (Test-Path $tempZip) { Remove-Item -Path $tempZip -Force }
    exit 1
}
