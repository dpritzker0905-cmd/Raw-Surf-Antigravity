$srcPath = 'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\frontend\src'
$files = Get-ChildItem $srcPath -Recurse -Include '*.js','*.jsx'
$fixedCount = 0
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $original = $content
    $content = $content -replace '\} catch \(_e\) \{', '} catch (e) {'
    $content = $content -replace '\} catch\(_e\) \{', '} catch (e) {'
    if ($content -ne $original) {
        Set-Content $file.FullName $content -NoNewline
        $fixedCount++
    }
}
Write-Host "Reverted catch(_e) to catch(e) in $fixedCount files"
