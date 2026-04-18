
# audit_extract.ps1 - Extract and report key audit data from qa-status.json
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$statusPath = "$scriptDir\qa-status.json"

Write-Host "=== RAW SURF QA AUDIT EXTRACT ===" -ForegroundColor Cyan
Write-Host "Reading: $statusPath" -ForegroundColor DarkGray

$json = Get-Content $statusPath -Raw | ConvertFrom-Json

Write-Host ""
Write-Host "Overall Status: $($json.overallStatus)" -ForegroundColor $(if ($json.overallStatus -eq 'PASS') { 'Green' } else { 'Red' })
Write-Host "Last Run: $($json.lastRun)"
Write-Host ""

# ESLint
$eslint = $json.checks | Where-Object { $_.tool -eq "ESLint" }
if ($eslint) {
    Write-Host "=== ESLint ===" -ForegroundColor Yellow
    Write-Host "Status: $($eslint.status)" -ForegroundColor $(if ($eslint.status -eq 'PASS') { 'Green' } else { 'Red' })
    Write-Host "Errors: $($eslint.errorCount)"
    Write-Host "Warnings: $($eslint.warningCount)"
    Write-Host ""
    
    Write-Host "--- CRITICAL ERRORS (severity=error) ---" -ForegroundColor Red
    $critErrors = @()
    foreach ($e in $eslint.errors) {
        if ($e.severity -eq "error") {
            $critErrors += $e
            Write-Host "  $($e.file):$($e.line):$($e.column) [$($e.rule)] $($e.message)"
        }
    }
    if ($critErrors.Count -eq 0) { Write-Host "  (none)" -ForegroundColor Green }
    
    Write-Host ""
    Write-Host "--- WARNING RULE BREAKDOWN (Top 30) ---" -ForegroundColor Yellow
    $warnings = $eslint.errors | Where-Object { $_.severity -eq "warning" }
    $ruleGroups = @{}
    foreach ($w in $warnings) {
        $r = $w.rule
        if (-not $ruleGroups.ContainsKey($r)) { $ruleGroups[$r] = 0 }
        $ruleGroups[$r]++
    }
    $sorted = $ruleGroups.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 30
    foreach ($kv in $sorted) {
        Write-Host "  $($kv.Value)x  $($kv.Key)"
    }
    
    Write-Host ""
    Write-Host "--- TOP 20 MOST PROBLEMATIC FILES (by warning count) ---" -ForegroundColor Yellow
    $fileGroups = @{}
    foreach ($e in $eslint.errors) {
        $f = $e.file
        if (-not $fileGroups.ContainsKey($f)) { $fileGroups[$f] = 0 }
        $fileGroups[$f]++
    }
    $topFiles = $fileGroups.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 20
    foreach ($kv in $topFiles) {
        Write-Host "  $($kv.Value)x  $($kv.Key)"
    }
}

Write-Host ""

# Ruff
$ruff = $json.checks | Where-Object { $_.tool -eq "Ruff" }
if ($ruff) {
    Write-Host "=== Ruff (Python) ===" -ForegroundColor Yellow
    Write-Host "Status: $($ruff.status)" -ForegroundColor $(if ($ruff.status -eq 'PASS') { 'Green' } else { 'Red' })
    Write-Host "Issues: $($ruff.errorCount)"
    if ($ruff.errorCount -gt 0) {
        Write-Host "--- TOP Issues ---" -ForegroundColor Red
        $ruff.errors | Select-Object -First 30 | ForEach-Object {
            Write-Host "  $($_.file):$($_.line) [$($_.rule)] $($_.message)"
        }
    }
}

Write-Host ""

# pytest
$pytest = $json.checks | Where-Object { $_.tool -eq "pytest" }
if ($pytest) {
    Write-Host "=== pytest ===" -ForegroundColor Yellow
    Write-Host "Status: $($pytest.status)" -ForegroundColor $(if ($pytest.status -eq 'PASS') { 'Green' } else { 'Red' })
    Write-Host "Passed: $($pytest.passed)"
    Write-Host "Failed: $($pytest.failed)"
    if ($pytest.output) {
        Write-Host "--- Output ---"
        Write-Host $pytest.output.Substring(0, [Math]::Min(2000, $pytest.output.Length))
    }
}

Write-Host ""
Write-Host "=== HISTORY (last 10 runs) ===" -ForegroundColor Cyan
$json.history | Select-Object -Last 10 | ForEach-Object {
    $col = if ($_.overallStatus -eq 'PASS') { 'Green' } else { 'Red' }
    Write-Host "  $($_.timestamp)  $($_.overallStatus)  trigger: $($_.changedFile)" -ForegroundColor $col
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Cyan
