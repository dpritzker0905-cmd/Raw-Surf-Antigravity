# QA Companion Agent - run-checks.ps1
# Runs ESLint + Ruff + pytest and writes results to qa-status.json

param(
    [string]$ChangedFile = ""
)

$ErrorActionPreference = "Continue"

$scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$config       = Get-Content "$scriptDir\config.json" | ConvertFrom-Json
$qaStatusPath = $config.qaStatusFile -replace '/', '\'
$frontendPath = ($config.projects[0].path) -replace '/', '\'
$backendPath  = ($config.projects[1].path) -replace '/', '\'

# --- Resolve active deploy environment (dev by default, NEVER prod unless explicitly set) ---
$activeEnv      = $config.activeEnv
if (-not $activeEnv) { $activeEnv = "dev" }
$envConfig      = $config.environments.$activeEnv
$targetFrontend = $envConfig.frontendUrl
$targetBackend  = $envConfig.backendUrl
$targetBranch   = $envConfig.branch

Write-Host "(QA) Environment: $activeEnv  |  Branch: $targetBranch" -ForegroundColor Magenta
Write-Host "(QA) Frontend target: $targetFrontend" -ForegroundColor Magenta
Write-Host "(QA) Backend target:  $targetBackend" -ForegroundColor Magenta

function Write-Status($status) {
    $status | ConvertTo-Json -Depth 10 | Set-Content -Path $qaStatusPath -Encoding UTF8
}

# --- Mark RUNNING immediately ---
Write-Status @{
    lastRun       = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    status        = "RUNNING"
    changedFile   = $ChangedFile
    overallStatus = "RUNNING"
    activeEnv     = $activeEnv
    targetFrontend = $targetFrontend
    targetBackend  = $targetBackend
    checks        = @()
    history       = @()
}

Write-Host "(QA) Triggered by: $ChangedFile" -ForegroundColor Cyan

$checks      = @()
$overallPass = $true

# =============================================================
# 1. ESLint
# =============================================================
Write-Host "(QA) Running ESLint..." -ForegroundColor Yellow

$eslintResult = @{
    tool         = "ESLint"
    status       = "PASS"
    errorCount   = 0
    warningCount = 0
    errors       = @()
}

try {
    $eslintOut = & cmd /c "cd /d `"$frontendPath`" && npx eslint src --ext .js,.jsx,.ts,.tsx --format json --max-warnings 9999 2>&1"
    $rawStr    = ($eslintOut | Where-Object { $_ -ne '' }) -join ""
    $match     = [regex]::Match($rawStr, '\[.*\]', [System.Text.RegularExpressions.RegexOptions]::Singleline)

    if ($match.Success) {
        $parsed     = $match.Value | ConvertFrom-Json
        $allErrors  = @()
        $totalErr   = 0
        $totalWarn  = 0

        foreach ($f in $parsed) {
            $totalErr  += $f.errorCount
            $totalWarn += $f.warningCount
            foreach ($msg in $f.messages) {
                if ($msg.severity -ge 1) {
                    $allErrors += @{
                        file     = ($f.filePath -replace [regex]::Escape($frontendPath), "")
                        line     = [int]$msg.line
                        column   = [int]$msg.column
                        severity = if ($msg.severity -eq 2) { "error" } else { "warning" }
                        message  = [string]$msg.message
                        rule     = [string]$msg.ruleId
                    }
                }
            }
        }

        $eslintResult.errorCount   = $totalErr
        $eslintResult.warningCount = $totalWarn
        $eslintResult.errors       = $allErrors

        if ($totalErr -gt 0) {
            $eslintResult.status = "FAIL"
            $overallPass         = $false
            Write-Host "(QA) ESLint FAIL: $totalErr errors, $totalWarn warnings" -ForegroundColor Red
        } else {
            Write-Host "(QA) ESLint PASS ($totalWarn warnings)" -ForegroundColor Green
        }
    } else {
        if ($LASTEXITCODE -ne 0) {
            $eslintResult.status = "FAIL"
            $eslintResult.errors = @(@{ file = ""; line = 0; message = $rawStr.Substring(0, [Math]::Min(500, $rawStr.Length)); rule = "" })
            $overallPass = $false
            Write-Host "(QA) ESLint FAIL (non-zero exit)" -ForegroundColor Red
        } else {
            Write-Host "(QA) ESLint PASS" -ForegroundColor Green
        }
    }
} catch {
    $eslintResult.status = "ERROR"
    $eslintResult.errors = @(@{ file = ""; line = 0; message = $_.Exception.Message; rule = "" })
    $overallPass = $false
    Write-Host "(QA) ESLint ERROR: $($_.Exception.Message)" -ForegroundColor Magenta
}

$checks += $eslintResult

# =============================================================
# 2. Ruff (Python linter)
# =============================================================
Write-Host "(QA) Running Ruff..." -ForegroundColor Yellow

$ruffResult = @{
    tool       = "Ruff"
    status     = "PASS"
    errorCount = 0
    errors     = @()
}

try {
    if (Test-Path "$backendPath\venv\Scripts\ruff.exe") {
        $ruffBin = "$backendPath\venv\Scripts\ruff.exe"
    } else {
        $ruffBin = "ruff"
    }

    $ruffOut  = & cmd /c "cd /d `"$backendPath`" && `"$ruffBin`" check . --output-format json 2>&1"
    $ruffStr  = ($ruffOut | Where-Object { $_ -ne '' }) -join ""
    $ruffMatch = [regex]::Match($ruffStr, '\[.*\]', [System.Text.RegularExpressions.RegexOptions]::Singleline)

    if ($ruffMatch.Success) {
        $parsed     = $ruffMatch.Value | ConvertFrom-Json
        $ruffErrors = @()
        foreach ($issue in $parsed) {
            $ruffErrors += @{
                file    = ($issue.filename -replace [regex]::Escape($backendPath), "")
                line    = [int]$issue.location.row
                column  = [int]$issue.location.column
                message = [string]$issue.message
                rule    = [string]$issue.code
            }
        }
        $ruffResult.errorCount = $ruffErrors.Count
        $ruffResult.errors     = $ruffErrors

        if ($ruffErrors.Count -gt 0) {
            $ruffResult.status = "FAIL"
            $overallPass       = $false
            Write-Host "(QA) Ruff FAIL: $($ruffErrors.Count) issue(s)" -ForegroundColor Red
        } else {
            Write-Host "(QA) Ruff PASS" -ForegroundColor Green
        }
    } else {
        Write-Host "(QA) Ruff PASS (no issues)" -ForegroundColor Green
    }
} catch {
    $ruffResult.status = "SKIPPED"
    $ruffResult.errors = @(@{ file = ""; line = 0; message = "ruff not found - install with: pip install ruff"; rule = "" })
    Write-Host "(QA) Ruff SKIPPED (not found)" -ForegroundColor DarkYellow
}

$checks += $ruffResult

# =============================================================
# 3. pytest
# =============================================================
Write-Host "(QA) Running pytest..." -ForegroundColor Yellow

$pytestResult = @{
    tool   = "pytest"
    status = "PASS"
    passed = 0
    failed = 0
    errors = @()
    output = ""
}

try {
    if (Test-Path "$backendPath\venv\Scripts\pytest.exe") {
        $pytestBin = "$backendPath\venv\Scripts\pytest.exe"
    } else {
        $pytestBin = "pytest"
    }

    # Collect test files (root-level test_*.py + tests/ folder)
    $rootTests = @(Get-ChildItem $backendPath -Filter "test_*.py" -ErrorAction SilentlyContinue)
    $subTests  = @(Get-ChildItem "$backendPath\tests" -Filter "test_*.py" -Recurse -ErrorAction SilentlyContinue)
    $allTests  = $rootTests + $subTests

    if ($allTests.Count -eq 0) {
        $pytestResult.status = "SKIPPED"
        $pytestResult.output = "No test_*.py files found"
        Write-Host "(QA) pytest SKIPPED (no test files)" -ForegroundColor DarkYellow
    } else {
        $pytestOut  = & cmd /c "cd /d `"$backendPath`" && `"$pytestBin`" --tb=short -q 2>&1"
        $pytestText = $pytestOut -join "`n"
        $pytestResult.output = $pytestText.Substring(0, [Math]::Min(3000, $pytestText.Length))

        if ($pytestText -match "(\d+) passed") { $pytestResult.passed = [int]$Matches[1] }
        if ($pytestText -match "(\d+) failed") {
            $pytestResult.failed = [int]$Matches[1]
            $pytestResult.status = "FAIL"
            $overallPass         = $false
            Write-Host "(QA) pytest FAIL: $($pytestResult.passed) passed, $($pytestResult.failed) failed" -ForegroundColor Red
        } else {
            Write-Host "(QA) pytest PASS: $($pytestResult.passed) passed" -ForegroundColor Green
        }
    }
} catch {
    $pytestResult.status = "SKIPPED"
    $pytestResult.output = "pytest not found - install with: pip install pytest"
    Write-Host "(QA) pytest SKIPPED (not found)" -ForegroundColor DarkYellow
}

$checks += $pytestResult

# =============================================================
# Write final qa-status.json
# =============================================================
$finalStatus = if ($overallPass) { "PASS" } else { "FAIL" }

$existing = @{ history = @() }
if (Test-Path $qaStatusPath) {
    try { $existing = Get-Content $qaStatusPath | ConvertFrom-Json } catch {}
}

$history = @($existing.history) + @(@{
    timestamp      = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    overallStatus  = $finalStatus
    changedFile    = $ChangedFile
    activeEnv      = $activeEnv
    targetFrontend = $targetFrontend
})
if ($history.Count -gt 20) { $history = $history[-20..-1] }

Write-Status @{
    lastRun        = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    status         = "IDLE"
    changedFile    = $ChangedFile
    overallStatus  = $finalStatus
    activeEnv      = $activeEnv
    targetFrontend = $targetFrontend
    targetBackend  = $targetBackend
    targetBranch   = $targetBranch
    checks         = $checks
    history        = $history
}

# --- Also update the cross-agent report in test_reports/ ---
$reportPath = "$backendPath\..\test_reports\qa_companion_report.md"
$timestamp  = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
$eslintCheck = $checks | Where-Object { $_.tool -eq "ESLint" }
$ruffCheck   = $checks | Where-Object { $_.tool -eq "Ruff" }
$pytestCheck = $checks | Where-Object { $_.tool -eq "pytest" }

$errCount  = if ($eslintCheck) { $eslintCheck.errorCount } else { 0 }
$warnCount = if ($eslintCheck) { $eslintCheck.warningCount } else { 0 }
$ruffStat  = if ($ruffCheck)   { $ruffCheck.status } else { "UNKNOWN" }
$pytestStat = if ($pytestCheck) { $pytestCheck.status } else { "UNKNOWN" }
$pytestPassed = if ($pytestCheck) { $pytestCheck.passed } else { 0 }
$pytestFailed = if ($pytestCheck) { $pytestCheck.failed } else { 0 }

# Build top-3 critical errors for the report
$criticalErrors = ($eslintCheck.errors | Where-Object { $_.severity -eq "error" } | Select-Object -First 10)
$criticalBlock  = ($criticalErrors | ForEach-Object {
    "- ``$($_.file):$($_.line)`` [$($_.rule)] $($_.message)"
}) -join "`n"

$reportContent = @"
# QA Companion Report (Auto-Updated)
**Generated:** $timestamp
**Trigger:** $ChangedFile
**Environment:** $activeEnv (branch: $targetBranch)
**Frontend Under Test:** $targetFrontend
**Backend Under Test:** $targetBackend
**Dashboard:** http://localhost:7734

> ⚠️ All integration tests target the **$activeEnv** deploy. To change, edit ``activeEnv`` in ``qa-agent/config.json``.

---

## Overall: $finalStatus

| Tool | Status | Detail |
|------|--------|--------|
| ESLint | $($eslintCheck.status) | $errCount errors, $warnCount warnings |
| Ruff | $ruffStat | Python backend lint |
| pytest | $pytestStat | $pytestPassed passed, $pytestFailed failed |

---

## Critical ESLint Errors (severity=error)

$criticalBlock

---

## Action Required

Before marking any task complete, verify: **http://localhost:7734**

Run manually: ``cd qa-agent && powershell -ExecutionPolicy Bypass -File run-checks.ps1``
"@

$reportContent | Set-Content -Path $reportPath -Encoding UTF8 -ErrorAction SilentlyContinue

# Update AUDIT.md status line
$auditPath = "$backendPath\..\memory\AUDIT.md"
if (Test-Path $auditPath) {
    $auditContent = Get-Content $auditPath -Raw
    $oldBlock = [regex]::Match($auditContent, '> ## LIVE QA STATUS.*?---\r?\n\r?\n', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($oldBlock.Success) {
        $newBlock = @"
> ## LIVE QA STATUS — Updated $timestamp
> **QA Companion Agent is running.** Fresh lint + test results:
> - **Dashboard:** http://localhost:7734
> - **Report:** ``test_reports/qa_companion_report.md``
>
> **Current status:** $finalStatus — ESLint: $errCount errors / Ruff: $ruffStat / pytest: $pytestStat
> Last triggered by: $ChangedFile

---

"@
        $auditContent = $auditContent.Replace($oldBlock.Value, $newBlock)
        $auditContent | Set-Content -Path $auditPath -Encoding UTF8 -ErrorAction SilentlyContinue
    }
}


Write-Host ""
Write-Host "--------------------------------------------" -ForegroundColor DarkGray
if ($overallPass) {
    Write-Host "(QA) ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "(QA) CHECKS FAILED - see dashboard or qa-status.json" -ForegroundColor Red
}
Write-Host "--------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
