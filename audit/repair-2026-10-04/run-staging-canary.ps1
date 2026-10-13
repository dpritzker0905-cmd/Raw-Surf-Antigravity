# Run from a regular PowerShell terminal. The existing Dev credential is entered hidden,
# passed only to a child process and then removed from this process. Never put it in chat.
# Default is read-only preflight; -Execute performs the previously prepared tiny Dev canary.
param(
    [switch]$Execute,
    [string]$PythonExecutable
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$taskCanary = Join-Path $PSScriptRoot 'manifest_staging_canary.py'
# Refuse another session's uncommitted source before asking for a privileged credential.
# A clean HEAD is necessary, not proof of hosted qualification; use the qualified commit.
$taskCanaryRelative = 'audit/repair-2026-10-04/manifest_staging_canary.py'
if (-not (Test-Path -LiteralPath $taskCanary -PathType Leaf)) {
    throw 'Staging canary source is missing; no credential was requested.'
}
& git -C $taskRoot cat-file -e ('HEAD:' + $taskCanaryRelative) 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'Staging canary must exist in committed HEAD; no credential was requested.'
}
& git -C $taskRoot diff --quiet HEAD -- $taskCanaryRelative
if ($LASTEXITCODE -eq 1) {
    throw 'Staging canary differs from committed HEAD. Use a clean checkout of the qualified commit; uncommitted work was preserved. No credential was requested.'
}
if ($LASTEXITCODE -ne 0) {
    throw 'Could not verify staging canary source; no credential was requested.'
}
# Fixed verified isolated target; this launcher cannot select the shared application project.
$taskProjectRef = 'weewaulkwfwlbhqemxma'
$taskStagingUrl = 'https://' + $taskProjectRef + '.supabase.co'
if (-not $PythonExecutable) {
    $taskBundled = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    if (Test-Path -LiteralPath $taskBundled) {
        $PythonExecutable = $taskBundled
    } else {
        $PythonExecutable = (Get-Command python -ErrorAction Stop).Source
    }
}
if (-not (Test-Path -LiteralPath $PythonExecutable -PathType Leaf)) {
    throw 'PythonExecutable must identify an existing Python executable.'
}
$taskOriginalUrl = [Environment]::GetEnvironmentVariable('STAGING_SUPABASE_URL', 'Process')
$taskOriginalKey = [Environment]::GetEnvironmentVariable('STAGING_SUPABASE_SERVICE_ROLE_KEY', 'Process')
$taskOriginalPath = [Environment]::GetEnvironmentVariable('PYTHONPATH', 'Process')
$taskSecureKey = $null
$taskKeyPointer = [IntPtr]::Zero
$taskExitCode = 1
try {
    Write-Host 'Target: Raw Surf App Dev. Default mode only checks the empty private bucket and pointer table.'
    if ($Execute) {
        Write-Host 'Execute mode: three tiny synthetic objects, one pointer, two-writer CAS/readback and owned-data cleanup.'
    }
    $taskSecureKey = Read-Host 'Enter the EXISTING Dev service-role key (hidden; do not use a production key)' -AsSecureString
    if ($taskSecureKey.Length -eq 0) { throw 'No staging credential supplied.' }
    $taskKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecureKey)
    [Environment]::SetEnvironmentVariable('STAGING_SUPABASE_URL', $taskStagingUrl, 'Process')
    [Environment]::SetEnvironmentVariable('STAGING_SUPABASE_SERVICE_ROLE_KEY',
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskKeyPointer), 'Process')
    # Use the already-installed dependencies if this workstation has the original checkout's venv.
    $taskSitePackages = Join-Path $env:USERPROFILE 'App/raw-surf/backend/.venv/Lib/site-packages'
    if (Test-Path -LiteralPath $taskSitePackages -PathType Container) {
        $taskSearchPath = $taskSitePackages
        if ($taskOriginalPath) { $taskSearchPath += [IO.Path]::PathSeparator + $taskOriginalPath }
        [Environment]::SetEnvironmentVariable('PYTHONPATH', $taskSearchPath, 'Process')
    }
    $taskArguments = @($taskCanary, '--project-ref', $taskProjectRef)
    if ($Execute) { $taskArguments += '--execute' }
    & $PythonExecutable @taskArguments
    $taskExitCode = $LASTEXITCODE
} finally {
    [Environment]::SetEnvironmentVariable('STAGING_SUPABASE_URL', $taskOriginalUrl, 'Process')
    [Environment]::SetEnvironmentVariable('STAGING_SUPABASE_SERVICE_ROLE_KEY', $taskOriginalKey, 'Process')
    [Environment]::SetEnvironmentVariable('PYTHONPATH', $taskOriginalPath, 'Process')
    if ($taskKeyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskKeyPointer)
    }
    if ($taskSecureKey) { $taskSecureKey.Dispose() }
    $taskOriginalKey = $null
}
if ($taskExitCode -ne 0) { throw "Staging canary exited with status $taskExitCode; no success is claimed." }
