# QA Companion Agent - watcher.ps1
# Watches the Raw Surf project for file changes and triggers run-checks.ps1

$ErrorActionPreference = "Continue"

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$config     = Get-Content "$scriptDir\config.json" | ConvertFrom-Json
$runChecks  = "$scriptDir\run-checks.ps1"
$debounceMs = $config.debounceMs
$extensions = $config.watchExtensions

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "       RAW SURF QA COMPANION AGENT                    " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Watching: RawSurf Frontend (JS/JSX/TS)"              -ForegroundColor Cyan
Write-Host "  Watching: RawSurf Backend  (Python)"                  -ForegroundColor Cyan
Write-Host "  Dashboard: http://localhost:$($config.dashboardPort)" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop"                                 -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# --- Start dashboard HTTP server as a background job ---
$dashboardPath = "$scriptDir\dashboard"
$qaStatusPath  = ($config.qaStatusFile -replace '/', '\')
$dashPort      = $config.dashboardPort

$dashboardJob = Start-Job -ScriptBlock {
    param($port, $dashPath, $statusPath)
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()

    while ($listener.IsListening) {
        try {
            $ctx = $listener.GetContext()
            $req = $ctx.Request
            $res = $ctx.Response

            $urlPath = $req.Url.LocalPath.TrimStart('/')

            if ($urlPath -eq "qa-status.json") {
                $filePath = $statusPath
            } elseif ($urlPath -eq "" -or $urlPath -eq "index.html") {
                $filePath = "$dashPath\index.html"
            } else {
                $filePath = "$dashPath\$urlPath"
            }

            if (Test-Path $filePath) {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $ext   = [System.IO.Path]::GetExtension($filePath)
                $mime  = switch ($ext) {
                    ".html" { "text/html; charset=utf-8" }
                    ".css"  { "text/css" }
                    ".js"   { "application/javascript" }
                    ".json" { "application/json" }
                    default { "text/plain" }
                }
                $res.ContentType = $mime
                $res.AddHeader("Access-Control-Allow-Origin", "*")
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $res.StatusCode = 404
                $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
                $res.OutputStream.Write($body, 0, $body.Length)
            }
            $res.OutputStream.Close()
        } catch { }
    }
} -ArgumentList $dashPort, $dashboardPath, $qaStatusPath

Start-Sleep -Milliseconds 1000
Write-Host "(QA) Dashboard running at http://localhost:$dashPort" -ForegroundColor Green
Start-Process "http://localhost:$dashPort"

# --- Run initial check on startup ---
Write-Host "(QA) Running initial check on startup..." -ForegroundColor Yellow
& powershell -ExecutionPolicy Bypass -NonInteractive -File $runChecks -ChangedFile "(startup)"

# --- Set up FileSystemWatcher for each project ---
$watchers = @()
foreach ($project in $config.projects) {
    $watchPath = ($project.path -replace '/', '\')
    Write-Host "(QA) Watching: $watchPath" -ForegroundColor DarkCyan
    $w = New-Object System.IO.FileSystemWatcher
    $w.Path                  = $watchPath
    $w.IncludeSubdirectories = $true
    $w.EnableRaisingEvents   = $true
    $w.NotifyFilter          = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName
    $watchers += $w
}

Write-Host "(QA) Watching for changes. Edit any .js/.jsx/.ts/.tsx/.py to trigger checks." -ForegroundColor Green
Write-Host ""

# --- Main polling loop with debounce ---
$lastRunTime = [System.DateTime]::MinValue

while ($true) {
    foreach ($w in $watchers) {
        $changed = $w.WaitForChanged([System.IO.WatcherChangeTypes]::All, 300)
        if (-not $changed.TimedOut) {
            $fileName = $changed.Name
            $ext      = [System.IO.Path]::GetExtension($fileName)
            if ($extensions -contains $ext) {
                $now     = [System.DateTime]::Now
                $elapsed = ($now - $lastRunTime).TotalMilliseconds
                if ($elapsed -gt $debounceMs) {
                    $lastRunTime = $now
                    Write-Host "(QA) Change detected: $fileName" -ForegroundColor White
                    & powershell -ExecutionPolicy Bypass -NonInteractive -File $runChecks -ChangedFile $fileName
                }
            }
        }
    }
}
