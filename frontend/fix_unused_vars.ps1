$qaStatus = Get-Content 'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\qa-agent\qa-status.json' | ConvertFrom-Json
$eslint = $qaStatus.checks | Where-Object { $_.tool -eq 'ESLint' }
$unusedVarIssues = $eslint.errors | Where-Object { $_.rule -eq 'unused-imports/no-unused-vars' }
$frontendBase = 'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\frontend'

# Group by file
$byFile = $unusedVarIssues | Group-Object -Property file

$totalFixed = 0

foreach ($group in $byFile) {
    $relPath = $group.Name -replace '^\\', ''
    $fullPath = Join-Path $frontendBase $relPath
    
    if (-not (Test-Path $fullPath)) {
        Write-Host "SKIP (not found): $fullPath" -ForegroundColor Yellow
        continue
    }
    
    $lines = Get-Content $fullPath
    $modified = $false
    
    foreach ($issue in $group.Group) {
        $lineIdx = $issue.line - 1
        if ($lineIdx -lt 0 -or $lineIdx -ge $lines.Count) { continue }
        
        $lineContent = $lines[$lineIdx]
        
        # Extract var name from message like "'varName' is assigned..." or "'varName' is defined..."
        $varMatch = [regex]::Match($issue.message, "^'([^']+)'")
        if (-not $varMatch.Success) { continue }
        $varName = $varMatch.Groups[1].Value
        
        # Skip if already prefixed
        if ($varName.StartsWith('_')) { continue }
        
        $newName = "_$varName"
        
        # Try to replace the first occurrence of the exact var name on that exact line
        # Use word boundary replacement to avoid partial matches
        $newLine = [regex]::Replace($lineContent, "\b$([regex]::Escape($varName))\b", $newName, [System.Text.RegularExpressions.RegexOptions]::None)
        
        if ($newLine -ne $lineContent) {
            $lines[$lineIdx] = $newLine
            $modified = $true
            $totalFixed++
            Write-Host "  Fixed: $($group.Name):$($issue.line) — $varName -> $newName" -ForegroundColor Cyan
        }
    }
    
    if ($modified) {
        $lines | Set-Content $fullPath -Encoding UTF8
    }
}

Write-Host ""
Write-Host "Total fixes applied: $totalFixed" -ForegroundColor Green
