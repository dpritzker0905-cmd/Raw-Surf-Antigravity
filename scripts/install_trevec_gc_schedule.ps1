<#
.SYNOPSIS
    Register (or remove) the hourly trevec index GC. This is what actually bounds `.trevec/lance`.

.DESCRIPTION
    On 2026-07-29 `.trevec/lance` reached 437 GB indexing a 0.46 GB repo -- 52,023 versions of a
    13.4 MB index, one live -- and filled a 936 GB volume to zero twice in a day. It presented as
    96 "flaky" test failures once and an empty log the other time.

    trevec has no compact/vacuum/prune/gc and no index retention setting. Lance's own dataset-level
    auto-cleanup WOULD fix it but trevec's writer was measured to ignore it (installed at 15
    versions; the store then went 15 -> 22 -> 42 -> 66 with the config untouched). So nothing
    preventive is available and the only thing that bounds the store is this GC on a timer.

    Checked in rather than hand-made on purpose: a task created once by hand is invisible six months
    later and nobody can tell what it runs or whether it is still right.

    ⚠️ USES schtasks, NOT the ScheduledTasks cmdlets, and that is deliberate. Two cmdlet approaches
    were measured to fail:
      - `-Once` + `-RepetitionInterval` + `-RepetitionDuration ([TimeSpan]::MaxValue)` is REJECTED:
        serialises to P99999999DT23H59M59S, "value which is incorrectly formatted or out of range".
      - A `-Daily` trigger with a `-Once` trigger's `.Repetition` grafted on registers and verifies
        clean, then **DELETES ITSELF THE FIRST TIME IT RUNS** (reproduced twice; task absent 30s
        after Start-ScheduledTask, log 0 bytes, with DeleteExpiredTaskAfter and EndBoundary both
        empty). A guard that vanishes on first run is worse than none: it reads as installed.
    `schtasks /SC HOURLY` has no repetition window to expire and no trigger object to graft.

.PARAMETER Remove
    Unregister the task and exit.

.PARAMETER IntervalHours
    How often to prune. Default 1.

.EXAMPLE
    pwsh -File scripts/install_trevec_gc_schedule.ps1
    pwsh -File scripts/install_trevec_gc_schedule.ps1 -Remove
    schtasks /query /tn "Raw-Surf trevec index GC" /v /fo LIST
#>
[CmdletBinding()]
param(
    [switch]$Remove,
    [int]$IntervalHours = 1,
    [string]$RepoRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Raw-Surf trevec index GC'

function Test-TaskExists {
    schtasks /query /tn $TaskName *>$null
    return ($LASTEXITCODE -eq 0)
}

if ($Remove) {
    if (Test-TaskExists) {
        schtasks /delete /tn $TaskName /f | Out-Null
        Write-Output "removed scheduled task: $TaskName"
    } else {
        Write-Output "no such scheduled task: $TaskName"
    }
    return
}

$launcher = Join-Path $RepoRoot 'scripts\trevec_gc_task.ps1'
if (-not (Test-Path $launcher)) { throw "launcher not found at $launcher" }

$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = (Get-Command powershell).Source }

# Fail at registration, not hourly for the next year, if the interpreter cannot do the work.
$py = @("$env:LOCALAPPDATA\Python\bin\python3.exe",
        (Get-Command python3 -EA SilentlyContinue).Source,
        (Get-Command python  -EA SilentlyContinue).Source) |
      Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $py) { throw "no python interpreter found" }
& $py -c "import lance" 2>$null
if ($LASTEXITCODE -ne 0) { throw "$py cannot import lance. Run: & '$py' -m pip install pylance" }

if (Test-TaskExists) { schtasks /delete /tn $TaskName /f | Out-Null }   # idempotent re-register

$action = "`"$pwsh`" -NoProfile -NonInteractive -WindowStyle Hidden -File `"$launcher`""
schtasks /create /tn $TaskName /tr $action /sc HOURLY /mo $IntervalHours /f | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks /create failed with $LASTEXITCODE" }

# Read the schedule back off the REGISTERED task. Registration succeeding has already proven not to
# mean the schedule survived -- that is the exact failure this guards.
if (-not (Test-TaskExists)) { throw "task did not persist after /create" }
$info = schtasks /query /tn $TaskName /v /fo LIST 2>$null
$repeat = ($info | Select-String -Pattern 'Repeat: Every|Schedule Type').Line -join '; '
# `-not ($array -match ...)`, NOT `($array -notmatch ...)`. Against an ARRAY these operators FILTER
# rather than return a boolean, so `$info -notmatch 'Hourly'` yields every line lacking the word --
# a non-empty, truthy array -- and this guard failed on a task that was registered correctly. A
# verification step with a false-positive failure is its own kind of broken.
if (-not ($info -match 'Hourly')) {
    throw "task registered but is not hourly. Inspect: schtasks /query /tn `"$TaskName`" /v /fo LIST"
}

Write-Output "registered: $TaskName"
Write-Output "  schedule : hourly (every $IntervalHours h)  [$($repeat.Trim())]"
Write-Output "  runs     : $launcher"
Write-Output "  python   : $py"
Write-Output "  log      : $(Join-Path $RepoRoot '.trevec\gc.log')"
Write-Output ""
Write-Output "verify : schtasks /query /tn `"$TaskName`" /v /fo LIST"
Write-Output "run now: schtasks /run /tn `"$TaskName`""
Write-Output "remove : pwsh -File scripts/install_trevec_gc_schedule.ps1 -Remove"
