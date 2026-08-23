param (
    [string]$Version = "v1.0.0",
    [string]$OutputDir = "$PSScriptRoot\..\dist-assets"
)

$ErrorActionPreference = "Stop"

$BgmTracksDir = "$PSScriptRoot\..\assets\audio\bgm\tracks"
$ManifestFile = "$PSScriptRoot\..\assets\audio\bgm\manifest.json"

if (-not (Test-Path $BgmTracksDir)) {
    Write-Error "Khong tim thay thu muc BGM tracks: $BgmTracksDir"
}

$mp3Files = Get-ChildItem -Path $BgmTracksDir -Filter "*.mp3"
$count = $mp3Files.Count

if ($count -eq 0) {
    Write-Error "Khong co file .mp3 nao trong $BgmTracksDir"
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$zipFileName = "kid-bgm-$Version.zip"
$zipFilePath = Join-Path $OutputDir $zipFileName

if (Test-Path $zipFilePath) {
    Remove-Item -Path $zipFilePath -Force
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  DONG GOI BGM RELEASE ($Version)" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  So luong file BGM: $count file MP3" -ForegroundColor Yellow
Write-Host "  Nguon: $BgmTracksDir"
Write-Host "  Dich:  $zipFilePath"

# Zip the tracks
Compress-Archive -Path "$BgmTracksDir\*.mp3" -DestinationPath $zipFilePath -CompressionLevel Optimal

$sizeMb = [Math]::Round((Get-Item $zipFilePath).Length / 1MB, 2)
Write-Host "======================================================" -ForegroundColor Green
Write-Host "✅ Da tao thanh cong file ZIP release!" -ForegroundColor Green
Write-Host "  File: $zipFilePath ($sizeMb MB)" -ForegroundColor Green
Write-Host "  Ban co the upload file nay len GitHub Release tag: $Version-assets" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Green
