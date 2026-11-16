#requires -Version 5.1
# Source-only SHA-256 manifest verification. No network or provider calls.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
try {
    $manifest=Join-Path $PSScriptRoot 'MANIFEST_SHA256_GATE1_ONLY.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'MANIFEST_NOT_FOUND' }
    $doc=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($doc.release -cne 'NOT_RELEASE') { throw 'MANIFEST_RELEASE_STATUS_DRIFT' }
    $keys=@($doc.files.PSObject.Properties)
    if ($keys.Count -lt 7) { throw 'INCOMPLETE_MANIFEST' }
    foreach($entry in $keys) {
        $name=[string]$entry.Name
        if ($name -match '^[\\/]' -or $name.Contains('..') -or $name -notmatch '^[A-Za-z0-9_./-]+$') { throw 'UNSAFE_SOURCE_RELATIVE_PATH' }
        $path=Join-Path $PSScriptRoot ($name.Replace('/','\'))
        $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'UNSAFE_SOURCE_FILE' }
        $sha=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($sha -cne [string]$entry.Value) { throw 'SOURCE_HASH_MISMATCH' }
    }
    Write-Host ('AXIOM_GATE1_WINDOWS_PACKAGE_SHA256_PASS_NOT_RELEASE files='+$keys.Count)
    exit 0
}
catch {
    [Console]::Error.WriteLine('AXIOM_GATE1_WINDOWS_PACKAGE_NO_GO:'+ $_.Exception.Message)
    exit 2
}
