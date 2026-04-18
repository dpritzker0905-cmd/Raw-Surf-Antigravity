
# scan_corrupted.ps1 - Find files corrupted to null bytes (common after desktop crash)
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$scanDir = Join-Path $baseDir "..\frontend\src"
$nullFiles = @()

Write-Host "Scanning: $scanDir" -ForegroundColor Cyan
$files = Get-ChildItem $scanDir -Recurse -Include "*.js","*.jsx","*.ts","*.tsx","*.css","*.json" -ErrorAction SilentlyContinue

foreach ($file in $files) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        if ($bytes.Length -gt 0 -and $bytes[0] -eq 0) {
            $nullFiles += $file.FullName
            Write-Host "CORRUPTED: $($file.FullName)" -ForegroundColor Red
        }
    } catch {
        Write-Host "UNREADABLE: $($file.FullName)" -ForegroundColor DarkRed
    }
}

Write-Host ""
if ($nullFiles.Count -eq 0) {
    Write-Host "No corrupted files found!" -ForegroundColor Green
} else {
    Write-Host "Total corrupted: $($nullFiles.Count)" -ForegroundColor Red
    $nullFiles | ForEach-Object { Write-Host "  $_" }
}

# Also scan backend Python files
$backendDir = Join-Path $baseDir "..\backend"
Write-Host ""
Write-Host "Scanning backend: $backendDir" -ForegroundColor Cyan
$pyFiles = Get-ChildItem $backendDir -Recurse -Include "*.py" -ErrorAction SilentlyContinue
$corruptedPy = @()

foreach ($file in $pyFiles) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        if ($bytes.Length -gt 0 -and $bytes[0] -eq 0) {
            $corruptedPy += $file.FullName
            Write-Host "CORRUPTED: $($file.FullName)" -ForegroundColor Red
        }
    } catch {}
}

if ($corruptedPy.Count -eq 0) {
    Write-Host "No corrupted Python files found!" -ForegroundColor Green
} else {
    Write-Host "Total corrupted Python files: $($corruptedPy.Count)" -ForegroundColor Red
}
