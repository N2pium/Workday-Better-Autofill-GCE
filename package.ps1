# Builds the Chrome Web Store upload zip.
#
# Only the files Chrome actually needs go in the package. Source artwork
# (design/), developer notes (*.md) and this script are deliberately excluded:
# everything in the zip is downloaded by every user, and unused files can also
# draw review questions about unreferenced content.
#
# Usage:  powershell -ExecutionPolicy Bypass -File package.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$include = @(
    'manifest.json',
    'background.js',
    'content.js',
    'greenhouse.js',
    'greenhouse-main.js',
    'popup.html',
    'popup.css',
    'popup.js',
    'cloud-config.js',
    'cloud-auth.js',
    'cloud-sync.js',
    'icons'
)

# Fail loudly if something referenced by the manifest is missing.
foreach ($item in $include) {
    $p = Join-Path $root $item
    if (-not (Test-Path $p)) { throw "Missing required file: $item" }
}

$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$out = Join-Path $root "workday-better-autofill-v$version.zip"

if (Test-Path $out) { Remove-Item $out -Force }

$paths = $include | ForEach-Object { Join-Path $root $_ }
Compress-Archive -Path $paths -DestinationPath $out -CompressionLevel Optimal

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "Built $([System.IO.Path]::GetFileName($out))  ($size KB)"
Write-Host "Upload this at https://chrome.google.com/webstore/devconsole"
