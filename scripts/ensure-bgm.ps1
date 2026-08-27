param (
    [string]$Version = "v1.0.0",
    [string]$Repo = "HyyAnk/my-1x-project",
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
    Write-Host "📥 Dang tai $zipName tu GitHub Release..." -ForegroundColor Cyan
    Write-Host "   URL: $downloadUrl" -ForegroundColor Gray
    
    $curlAvailable = (Get-Command curl.exe -ErrorAction SilentlyContinue) -ne $null
    
    if ($curlAvailable) {
        & curl.exe -L -s -S --fail -o $tempZip $downloadUrl
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($downloadUrl, $tempZip)
    }

    if (-not (Test-Path $tempZip) -or (Get-Item $tempZip).Length -lt 1000) {
        throw "File tai ve khong hop le hoac dung luong qua nho."
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
    Write-Host "   1. Dam bao release '$releaseTag' tren GitHub ton tai file '$zipName'." -ForegroundColor Yellow
    Write-Host "   2. Hoac copy truc tiep cac file .mp3 vao thu muc: $TargetDir" -ForegroundColor Yellow
    if (Test-Path $tempZip) { Remove-Item -Path $tempZip -Force }
    exit 1
}
