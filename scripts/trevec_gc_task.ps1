<#
.SYNOPSIS
    What the hourly scheduled task actually runs. Prunes stale Lance index versions and logs it.

.DESCRIPTION
    Kept as a readable script rather than an inline -EncodedCommand on the task itself. A base64
    blob in a task action cannot be reviewed, diffed, or run by hand to see why it failed -- and the
    first version of this schedule failed silently with a 0-byte log, which is exactly the situation
    where you want to be able to just run the thing.

    Registered by scripts/install_trevec_gc_schedule.ps1. Safe to run directly:
        pwsh -File scripts/trevec_gc_task.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),
    [string]$Python,
    # Overrides the GC's own DEFAULT_OLDER_THAN. Left empty the python default (30m) applies, which is
    # correct at the churn that default was sized against (~22 versions/hour). It is NOT correct at
    # every churn: the steady-state floor is (churn rate x this window), because versions younger than
    # the window always survive the prune. Measured 2026-08-16 with two `trevec serve` writers live,
    # churn was ~268 versions/hour and the hourly run left 134 versions / 2,477 MB -- exactly what that
    # product predicts. Shortening the schedule does NOT move that floor; only this does.
    # LOWER BOUND: must stay well above the longest-running transaction (a full index run is ~6 min) or
    # a live reader can have its version deleted underneath it. Do not go below ~8m.
    [string]$OlderThan
)

$ErrorActionPreference = 'Stop'

$logDir = Join-Path $RepoRoot '.trevec'
$log = Join-Path $logDir 'gc.log'
# `.trevec` is deleted as part of the documented rebuild remedy, so create it every run rather than
# once at registration. Out-File to a path with no parent directory fails, and Task Scheduler still
# reports success -- a silent hourly no-op.
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$Message) {
    "[{0}] {1}" -f (Get-Date -Format s), $Message | Out-File -FilePath $log -Append -Encoding utf8
}

try {
    if (-not $Python) {
        $candidates = @(
            "$env:LOCALAPPDATA\Python\bin\python3.exe",
            (Get-Command python3 -ErrorAction SilentlyContinue).Source,
            (Get-Command python  -ErrorAction SilentlyContinue).Source
        ) | Where-Object { $_ -and (Test-Path $_) }
        if (-not $candidates) { throw "no python interpreter found" }
        $Python = $candidates[0]
    }

    $script = Join-Path $RepoRoot 'scripts\trevec_index_gc.py'
    if (-not (Test-Path $script)) { throw "GC script not found at $script" }

    $gcArgs = @('--apply', '--path', $RepoRoot)
    if ($OlderThan) { $gcArgs += @('--older-than', $OlderThan) }
    & $Python $script @gcArgs 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "GC exited $LASTEXITCODE" }
}
catch {
    # Log the failure. An hourly guard that dies quietly is indistinguishable from one that is
    # working, and the whole incident this exists for was a problem nobody noticed for two months.
    Write-Log "FAILED: $($_.Exception.Message)"
    exit 1
}
