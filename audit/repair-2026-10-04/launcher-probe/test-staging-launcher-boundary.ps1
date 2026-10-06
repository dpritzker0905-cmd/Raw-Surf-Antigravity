$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$taskLauncher = Join-Path $taskRepo 'audit/repair-2026-10-04/run-staging-canary.ps1'
$taskPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
# Replaces the prompt: no credential entry, Python execution or cloud request.
function Read-Host { throw 'TEST_PROMPT_REACHED' }
function Invoke-Test($taskPath, $taskExpected, $taskName, [switch]$Execute) {
    try { & $taskPath -PythonExecutable $taskPython -Execute:$Execute; throw 'TEST_UNEXPECTED_SUCCESS' }
    catch {
        if ($_.Exception.Message -notlike ('*' + $taskExpected + '*')) {
            Write-Host ('FAIL ' + $taskName + ': ' + $_.Exception.Message)
            return $false
        }
        Write-Host ('PASS ' + $taskName)
        return $true
    }
}
$taskResults = @()
& git -C $taskRepo diff --quiet HEAD -- audit/repair-2026-10-04/manifest_staging_canary.py
if ($LASTEXITCODE -notin @(0, 1)) { throw 'Could not inspect real canary source' }
$taskExpected = if ($LASTEXITCODE -eq 1) { 'differs from committed HEAD' } else { 'TEST_PROMPT_REACHED' }
$taskResults += Invoke-Test $taskLauncher $taskExpected 'real source boundary'
$taskResults += Invoke-Test $taskLauncher $taskExpected 'real execute source boundary' -Execute
$taskFixture = Join-Path $PSScriptRoot ('launcher-fixture-' + [Guid]::NewGuid().ToString('N'))
try {
    $taskFolder = Join-Path $taskFixture 'audit/repair-2026-10-04'
    New-Item -ItemType Directory -Path $taskFolder -Force | Out-Null
    $taskCopy = Join-Path $taskFolder 'run-staging-canary.ps1'
    $taskSource = Join-Path $taskFolder 'manifest_staging_canary.py'
    Copy-Item -LiteralPath $taskLauncher -Destination $taskCopy
    Set-Content -LiteralPath $taskSource -Value '# Offline fixture, never executed.' -Encoding utf8
    & git -C $taskFixture init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Fixture git init failed' }
    & git -C $taskFixture add -- audit/repair-2026-10-04/manifest_staging_canary.py
    & git -C $taskFixture -c user.name=OfflineTest -c user.email=offline@example.invalid commit --quiet -m fixture
    if ($LASTEXITCODE -ne 0) { throw 'Fixture commit failed' }
    $taskResults += Invoke-Test $taskCopy 'TEST_PROMPT_REACHED' 'clean committed source reaches prompt sentinel'
    $taskResults += Invoke-Test $taskCopy 'TEST_PROMPT_REACHED' 'clean execute source reaches prompt sentinel' -Execute
    Add-Content -LiteralPath $taskSource -Value '# Changed fixture.' -Encoding utf8
    $taskResults += Invoke-Test $taskCopy 'differs from committed HEAD' 'unstaged fixture before prompt'
    & git -C $taskFixture add -- audit/repair-2026-10-04/manifest_staging_canary.py
    $taskResults += Invoke-Test $taskCopy 'differs from committed HEAD' 'staged fixture before prompt'
} finally {
    if (Test-Path -LiteralPath $taskFixture) {
        $taskResolvedFixture = (Resolve-Path -LiteralPath $taskFixture).Path
        $taskResolvedRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
        if (-not $taskResolvedFixture.StartsWith($taskResolvedRoot + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture cleanup outside intended root' }
        if ((Split-Path -Leaf $taskResolvedFixture) -notmatch '^launcher-fixture-[0-9a-f]{32}$') {
            throw 'Unexpected fixture cleanup target'
        }
        Remove-Item -LiteralPath $taskResolvedFixture -Recurse -Force
    }
}
Write-Host ('Results: ' + ($taskResults | Where-Object { $_ }).Count + '/' + $taskResults.Count)
if ($taskResults -contains $false) { exit 1 }
exit 0
