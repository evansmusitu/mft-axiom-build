#requires -Version 5.1
[CmdletBinding()]
param([string]$KeyFile = '')

$ErrorActionPreference = 'Stop'
$passSecure = $null
$passPointer = [IntPtr]::Zero
$stage = 'DEVICE_CHECK'
$allowDiagnostic = $false
$inputJson = $null
$passText = $null
$nodeVersion = $null
$safeNodeError = $null
function Require([bool]$Condition, [string]$Code) {
    if (-not $Condition) { throw $Code }
}

# This same transport is exercised with synthetic keys in both Windows shells.
# Keep the owner-device guard in the main program; tests import only functions.
function Invoke-AxiomBackupNode {
    param([string]$NodePath, [string]$VerifierPath, [string]$InputJson,
          [int]$TimeoutMilliseconds = 30000)
    $process = $null
    $started = $false
    $inputBytes = $null
    try {
        Require ($TimeoutMilliseconds -ge 100 -and $TimeoutMilliseconds -le 30000) 'LOCAL_VERIFIER_TIMEOUT_INVALID'
        $utf8 = New-Object Text.UTF8Encoding($false)
        $inputBytes = $utf8.GetBytes($InputJson + "`n")
        Require ($inputBytes.Length -le 16000) 'INPUT_OVER_BUDGET'
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $NodePath
        $start.Arguments = '"' + $VerifierPath + '"'
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardInput = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.StandardOutputEncoding = $utf8
        [void]$start.EnvironmentVariables.Remove('NODE_OPTIONS')
        [void]$start.EnvironmentVariables.Remove('NODE_PATH')
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $start
        Require ($process.Start()) 'LOCAL_VERIFIER_START_FAILED'
        $started = $true
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        # StandardInputEncoding does not exist in Windows PowerShell 5.1's .NET.
        # Write exact UTF-8 bytes directly to the anonymous pipe in both shells.
        $pipe = $process.StandardInput.BaseStream
        $pipe.Write($inputBytes, 0, $inputBytes.Length)
        $pipe.Flush()
        $pipe.Close()
        Require ($process.WaitForExit($TimeoutMilliseconds)) 'LOCAL_VERIFIER_TIMEOUT'
        $output = $outputTask.GetAwaiter().GetResult()
        [void]$errorTask.GetAwaiter().GetResult()
        Require ($output.Length -lt 12000) 'LOCAL_VERIFIER_OUTPUT_OVER_BUDGET'
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output }
    } finally {
        if ($null -ne $inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
        if ($null -ne $process) {
            if ($started -and -not $process.HasExited) { $process.Kill() }
            $process.Dispose()
        }
    }
}
try {
    Require ($env:OS -eq 'Windows_NT' -and -not $env:CI -and -not $env:GITHUB_ACTIONS) 'OWNER_WINDOWS_PC_REQUIRED'
    Require ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) 'INTERACTIVE_OWNER_CONSOLE_REQUIRED'
    $allowDiagnostic = $true
    $stage = 'PACKET_CHECK'
    $expectedManifestSha = '975641cfeefd392dd4fa6e440933d2ab7c695c9b2d0b7dac04d99dcefa92cc38'
    $manifestFile = Join-Path $PSScriptRoot 'BACKUP_PACKET_MANIFEST.json'
    Require ((Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $expectedManifestSha) 'PACKET_MANIFEST_HASH_MISMATCH'
    $manifest = [IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
    $requiredFiles = @('step2_owner_verify_current_backup_20261114.mjs', 'step1_encrypted_sql_export_transport.mjs', 'hosted_restore_parity_20261114.json', 'owner_encrypted_current_d1_20261114.json')
    Require (@($manifest.files.PSObject.Properties).Count -eq 4) 'PACKET_FILE_LIST_MISMATCH'
    foreach ($name in $requiredFiles) {
        $path = Join-Path $PSScriptRoot $name
        Require (-not ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PACKET_LINK_FORBIDDEN'
        $expected = [string]$manifest.files.$name
        Require ($expected -cmatch '^[a-f0-9]{64}$') 'PACKET_FILE_PIN_MISSING'
        Require ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $expected) 'PACKET_FILE_HASH_MISMATCH'
    }
    $stage = 'NODE_CHECK'
    $node = Get-Command node.exe -CommandType Application -ErrorAction Stop
    $version = & $node.Source '--version'
    Require ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.') 'NATIVE_NODE_UNAVAILABLE'
    Require ([int]$Matches[1] -ge 20) 'NODE_20_OR_NEWER_REQUIRED'
    $nodeVersion = [string]$version
    $stage = 'KEY_FILE_SELECTION'
    if ([string]::IsNullOrWhiteSpace($KeyFile)) {
        $candidates = @(
            (Join-Path $env:LOCALAPPDATA 'AXIOM_PRIVATE_KEYS_NOV2026_RETRY_20261113_135446\private\owner_x25519_pkcs8_encrypted.pem'),
            (Join-Path $env:LOCALAPPDATA 'AXIOM_PRIVATE_KEYS_NOV2026\private\owner_x25519_pkcs8_encrypted.pem')
        )
        foreach ($candidate in $candidates) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $KeyFile = $candidate; break }
        }
    }
    if ([string]::IsNullOrWhiteSpace($KeyFile)) {
        $KeyFile = Read-Host 'Full path to your existing encrypted owner X25519 private PEM'
    }
    $KeyFile = [IO.Path]::GetFullPath($KeyFile.Trim().Trim('"'))
    Require (Test-Path -LiteralPath $KeyFile -PathType Leaf) 'OWNER_ENCRYPTED_KEY_FILE_MISSING'
    Require (-not ((Get-Item -LiteralPath $KeyFile).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'OWNER_KEY_LINK_FORBIDDEN'
    Write-Host 'Verifying the actual encrypted D1 backup on this Windows PC.'
    Write-Host 'Expected X25519 public fingerprint: 704A7351DA66A21E0B35DF4880DF194F1CF0E17B161246671288141BEAE7262C'
    $stage = 'LOCAL_PASSPHRASE_INPUT'
    $passSecure = Read-Host 'Enter the passphrase for your existing X25519 key' -AsSecureString
    $passPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passSecure)
    $passText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passPointer)
    Require (-not [string]::IsNullOrEmpty($passText)) 'KEY_PASSPHRASE_REQUIRED'
    $inputJson = @{ key_file = $KeyFile; passphrase = $passText } | ConvertTo-Json -Compress
    $passText = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passPointer); $passPointer = [IntPtr]::Zero
    $stage = 'LOCAL_VERIFIER_TRANSPORT'
    $run = Invoke-AxiomBackupNode -NodePath $node.Source -VerifierPath (Join-Path $PSScriptRoot 'step2_owner_verify_current_backup_20261114.mjs') -InputJson $inputJson
    $inputJson = $null
    $stage = 'LOCAL_DECRYPTION_RESULT'
    $output = $run.Output
    $failureCodes = @('KEY_PASSPHRASE_OR_FORMAT_REJECTED','INCORRECT_CUSTODIAN_PRIVATE_KEY','CUSTODIAN_PRIVATE_KEY_NOT_X25519',
        'CIPHERTEXT_OR_METADATA_NOT_AUTHENTIC','BACKUP_OR_RECEIPT_PIN_MISMATCH','DECRYPTED_SQL_MISMATCH',
        'INPUT_JSON_INVALID','KEY_FILE_NOT_READABLE','ENCRYPTED_PKCS8_REQUIRED','ENCRYPTED_OWNER_KEY_FILE_REQUIRED',
        'OWNER_KEY_INPUT_UNAVAILABLE','LOCAL_VERIFIER_FAILED','INPUT_OVER_BUDGET','PACKET_FILE_NOT_READABLE',
        'INTERACTIVE_OWNER_WINDOWS_PC_REQUIRED')
    if ($run.ExitCode -ne 0) {
        try { $failure = $output | ConvertFrom-Json; if ($failureCodes -ccontains [string]$failure.error_code) { $safeNodeError = [string]$failure.error_code } } catch { }
        throw 'BACKUP_DECRYPTION_DID_NOT_PASS'
    }
    $proof = $output | ConvertFrom-Json
    Require ($proof.status -ceq 'OWNER_CURRENT_BACKUP_DECRYPTION_VERIFIED' -and $proof.authenticated_decryption_verified -eq $true) 'LOCAL_PROOF_DID_NOT_PASS'
    $proofFile = Join-Path $PSScriptRoot 'OWNER_BACKUP_DECRYPTION_PROOF.json'
    [IO.File]::WriteAllText($proofFile, $output, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'PASS - the actual backup decrypted and matched the captured SQL hash.'
    Write-Host ('Send only this result file back in chat: ' + $proofFile)
} catch {
    $knownCodes = @('OWNER_WINDOWS_PC_REQUIRED','INTERACTIVE_OWNER_CONSOLE_REQUIRED','PACKET_MANIFEST_HASH_MISMATCH',
        'PACKET_FILE_LIST_MISMATCH','PACKET_LINK_FORBIDDEN','PACKET_FILE_PIN_MISSING','PACKET_FILE_HASH_MISMATCH',
        'NATIVE_NODE_UNAVAILABLE','NODE_20_OR_NEWER_REQUIRED','OWNER_ENCRYPTED_KEY_FILE_MISSING','OWNER_KEY_LINK_FORBIDDEN',
        'KEY_PASSPHRASE_REQUIRED','LOCAL_VERIFIER_START_FAILED','LOCAL_VERIFIER_TIMEOUT','LOCAL_VERIFIER_TIMEOUT_INVALID',
        'LOCAL_VERIFIER_OUTPUT_OVER_BUDGET','INPUT_OVER_BUDGET','BACKUP_DECRYPTION_DID_NOT_PASS','LOCAL_PROOF_DID_NOT_PASS')
    $code = 'WINDOWS_RUNTIME_FAILED'
    if ($knownCodes -ccontains $_.Exception.Message) { $code = $_.Exception.Message }
    if ($null -ne $safeNodeError) { $code = $safeNodeError }
    [Console]::Error.WriteLine('Verification stopped. Code: ' + $code + '. Stage: ' + $stage + '. No decrypted SQL was saved.')
    if ($allowDiagnostic) {
        try {
            $diagnostic = @{ schema = 'musitu.axiom.owner-backup-safe-diagnostic.v1'; status = 'VERIFICATION_FAILED';
                error_code = $code; stage = $stage; powershell_version = $PSVersionTable.PSVersion.ToString();
                node_version = $nodeVersion; observed_at_utc = [DateTime]::UtcNow.ToString('o');
                private_key_path_recorded = $false; passphrase_recorded = $false; plaintext_sql_written = $false;
                release_status = 'NOT_RELEASE' } | ConvertTo-Json
            [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'OWNER_BACKUP_DIAGNOSTIC.json'), $diagnostic, (New-Object Text.UTF8Encoding($false)))
            [Console]::Error.WriteLine('Send OWNER_BACKUP_DIAGNOSTIC.json if this verification does not pass.')
        } catch { }
    }
    exit 2
} finally {
    if ($passPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passPointer) }
    if ($null -ne $passSecure) { $passSecure.Dispose() }
    $inputJson = $null; $passText = $null
}
