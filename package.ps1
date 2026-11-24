# Builds the Chrome Web Store upload zip.
#
# The package holds ONLY the files the extension loads at runtime, discovered
# from the code itself rather than a hand-kept list (the old hand-kept list fell
# behind in 2.0 and left out cloud-library.js, ai-assist.js and cloud-vault.js):
#   - manifest.json, its icons, background worker, side panel page, content scripts
#   - every <script src> / <link href> in the side panel page
#   - every importScripts(...) and js:/files: script list in background.js
# Docs, tests, tools, design, plan, cloud/, screenshots and old zips are left out.
#
# Usage:  powershell -ExecutionPolicy Bypass -File package.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json

$files = New-Object System.Collections.Generic.SortedSet[string]
[void]$files.Add('manifest.json')
foreach ($p in $manifest.icons.PSObject.Properties) { [void]$files.Add($p.Value) }
foreach ($p in $manifest.action.default_icon.PSObject.Properties) { [void]$files.Add($p.Value) }
[void]$files.Add($manifest.background.service_worker)
[void]$files.Add($manifest.side_panel.default_path)
foreach ($cs in $manifest.content_scripts) { foreach ($js in $cs.js) { [void]$files.Add($js) } }

$panel = Get-Content (Join-Path $root $manifest.side_panel.default_path) -Raw
foreach ($m in [regex]::Matches($panel, '(?:src|href)="([^"#:]+\.(?:js|css|png|svg))"')) { [void]$files.Add($m.Groups[1].Value) }

$bg = Get-Content (Join-Path $root $manifest.background.service_worker) -Raw
foreach ($m in [regex]::Matches($bg, "(?:importScripts\(|js:\s*\[|files:\s*\[)([^)\]]*)")) {
    foreach ($q in [regex]::Matches($m.Groups[1].Value, "'([^']+\.js)'")) { [void]$files.Add($q.Groups[1].Value) }
}

foreach ($f in $files) {
    if (-not (Test-Path (Join-Path $root $f) -PathType Leaf)) { throw "Referenced but missing: $f" }
}

$out = Join-Path $root "workday-better-autofill-v$($manifest.version).zip"
if (Test-Path $out) { Remove-Item $out -Force }

# System.IO.Compression with explicit forward-slash entry names: Windows
# PowerShell 5.1's Compress-Archive writes "icons\icon16.png", which zip readers
# outside Windows treat as a file name containing a backslash.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
    foreach ($f in $files) {
        $entry = $f -replace '\\', '/'
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), $entry, 'Optimal')
    }
} finally { $zip.Dispose() }

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "Built $([System.IO.Path]::GetFileName($out))  ($size KB, $($files.Count) files)"
$files | ForEach-Object { Write-Host "  $_" }
Write-Host "Upload this at https://chrome.google.com/webstore/devconsole"
