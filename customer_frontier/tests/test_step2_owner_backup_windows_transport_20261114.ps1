#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ownerScript = Join-Path $root 'customer_frontier/recovery/Run_MUSITU_AXIOM_Verify_Current_Backup.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($ownerScript, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw 'OWNER_SCRIPT_PARSE_FAILED' }
# Import only the actual transport functions, leaving the interactive/CI guard intact.
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    if (@('Require','Invoke-AxiomBackupNode') -ccontains $definition.Name) {
        . ([scriptblock]::Create($definition.Extent.Text))
    }
}
$nodeExe = (Get-Command node.exe -CommandType Application).Source
$tempRoot = Join-Path $env:TEMP ('AXIOM synthetic owner space ' + [char]0x00E9 + ' ' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($tempRoot)
try {
    $runtime = New-Object Diagnostics.ProcessStartInfo
    if ($PSVersionTable.PSVersion.Major -eq 5) {
        if ($null -ne $runtime.PSObject.Properties['StandardInputEncoding']) { throw 'LEGACY_REPRODUCTION_ENVIRONMENT_CHANGED' }
        $failed = $false
        try { $runtime.StandardInputEncoding = New-Object Text.UTF8Encoding($false) } catch { $failed = $true }
        if (-not $failed) { throw 'LEGACY_FAILURE_NOT_REPRODUCED' }
        Write-Host 'LEGACY_STANDARD_INPUT_PROPERTY_FAILURE_REPRODUCED'
    }
    $fixtureSource = Join-Path $root 'customer_frontier/tests/step2_owner_backup_windows_fixture_20261114.mjs'
    & $nodeExe $fixtureSource prepare $tempRoot
    if ($LASTEXITCODE -ne 0) { throw 'SYNTHETIC_FIXTURE_PREPARATION_FAILED' }
    # Relocate the fixture entry point beside its own synthetic data. All imports
    # remain the exact checked repository source; no owner CLI guard is disabled.
    $entry = Join-Path $tempRoot 'synthetic verifier with spaces.mjs'
    $text = [IO.File]::ReadAllText($fixtureSource)
    $recovery = (Join-Path $root 'customer_frontier/recovery/step1_encrypted_sql_export_transport.mjs')
    $verify = (Join-Path $root 'customer_frontier/recovery/step2_owner_verify_current_backup_20261114.mjs')
    $text = $text.Replace('../recovery/step1_encrypted_sql_export_transport.mjs', ([uri]$recovery).AbsoluteUri)
    $text = $text.Replace('../recovery/step2_owner_verify_current_backup_20261114.mjs', ([uri]$verify).AbsoluteUri)
    $text = $text.Replace('const [action, folder] = process.argv.slice(2);', "const action = 'verify'; const folder = undefined;")
    [IO.File]::WriteAllText($entry, $text, (New-Object Text.UTF8Encoding($false)))
    $fixture = [IO.File]::ReadAllText((Join-Path $tempRoot 'synthetic-fixture.json')) | ConvertFrom-Json
    $fixtureJson = @{ key_file = $fixture.key_file; passphrase = $fixture.passphrase } | ConvertTo-Json -Compress
    $result = Invoke-AxiomBackupNode -NodePath $nodeExe -VerifierPath $entry -InputJson $fixtureJson
    if ($result.ExitCode -ne 0) { throw 'SYNTHETIC_ENCRYPTED_PEM_PIPE_ROUNDTRIP_FAILED' }
    $proof = $result.Output | ConvertFrom-Json
    if ($proof.status -cne 'OWNER_CURRENT_BACKUP_DECRYPTION_VERIFIED' -or $proof.source_sql_sha256 -cne $fixture.receipt.source_sql_sha256) { throw 'SYNTHETIC_DECRYPTION_HASH_MISMATCH' }
    if ($result.Output.Contains($fixture.passphrase) -or $result.Output.Contains($fixture.key_file) -or $result.Output.Contains('SYNTHETIC_DATA_ONLY')) { throw 'SYNTHETIC_OUTPUT_LEAK' }
    Write-Host 'UTF8_UNICODE_PASSPHRASE_AND_SPACED_PATH_ENCRYPTED_BACKUP_ROUNDTRIP_PASS'
    $wrong = @{ key_file = $fixture.key_file; passphrase = 'WRONG_SYNTHETIC_PASSWORD_SENTINEL' } | ConvertTo-Json -Compress
    $denied = Invoke-AxiomBackupNode -NodePath $nodeExe -VerifierPath $entry -InputJson $wrong
    if ($denied.ExitCode -ne 2 -or ($denied.Output | ConvertFrom-Json).error_code -cne 'KEY_PASSPHRASE_OR_FORMAT_REJECTED') { throw 'SYNTHETIC_WRONG_PASSWORD_NOT_DENIED' }
    if ($denied.Output.Contains('WRONG_SYNTHETIC_PASSWORD_SENTINEL')) { throw 'SYNTHETIC_PASSWORD_LEAK' }
    Write-Host 'WRONG_PASSWORD_FIXED_SAFE_DIAGNOSTIC_PASS'
    $hang = Join-Path $tempRoot 'synthetic timeout.mjs'
    [IO.File]::WriteAllText($hang, 'setTimeout(()=>{},60000);')
    $timedOut = $false
    try { [void](Invoke-AxiomBackupNode -NodePath $nodeExe -VerifierPath $hang -InputJson '{}' -TimeoutMilliseconds 300) }
    catch { $timedOut = $_.Exception.Message -ceq 'LOCAL_VERIFIER_TIMEOUT' }
    if (-not $timedOut) { throw 'SYNTHETIC_TIMEOUT_NOT_ENFORCED' }
    Write-Host 'PROCESS_TIMEOUT_AND_CLEANUP_PASS'
    Write-Host ('WINDOWS_' + $PSVersionTable.PSVersion.ToString() + '_REAL_TRANSPORT_SYNTHETIC_DECRYPTION_PASS')
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
