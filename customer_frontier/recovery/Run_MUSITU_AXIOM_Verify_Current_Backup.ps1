#requires -Version 5.1
[CmdletBinding()]
param([string]$KeyFile = '')

$ErrorActionPreference = 'Stop'
$passSecure = $null
$passPointer = [IntPtr]::Zero
$child = $null
$childStarted = $false
function Require([bool]$Condition, [string]$Code) {
    if (-not $Condition) { throw $Code }
}
try {
    Require ($env:OS -eq 'Windows_NT' -and -not $env:CI -and -not $env:GITHUB_ACTIONS) 'OWNER_WINDOWS_PC_REQUIRED'
    Require ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) 'INTERACTIVE_OWNER_CONSOLE_REQUIRED'
    $expectedManifestSha = 'b114be86e4ed8b95f4421534eceef1aaf1c4c739b98a7eb4c91014e66b8f6b82'
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
    $node = Get-Command node.exe -CommandType Application -ErrorAction Stop
    $version = & $node.Source '--version'
    Require ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.') 'NATIVE_NODE_UNAVAILABLE'
    Require ([int]$Matches[1] -ge 20) 'NODE_20_OR_NEWER_REQUIRED'
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
    $passSecure = Read-Host 'Enter the passphrase for your existing X25519 key' -AsSecureString
    $passPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passSecure)
    $passText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passPointer)
    Require (-not [string]::IsNullOrEmpty($passText)) 'KEY_PASSPHRASE_REQUIRED'
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $node.Source
    $start.Arguments = '"' + (Join-Path $PSScriptRoot 'step2_owner_verify_current_backup_20261114.mjs') + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardInputEncoding = New-Object Text.UTF8Encoding($false)
    $start.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    [void]$start.EnvironmentVariables.Remove('NODE_OPTIONS')
    [void]$start.EnvironmentVariables.Remove('NODE_PATH')
    $child = New-Object Diagnostics.Process
    $child.StartInfo = $start
    Require ($child.Start()) 'LOCAL_VERIFIER_START_FAILED'
    $childStarted = $true
    $inputJson = @{ key_file = $KeyFile; passphrase = $passText } | ConvertTo-Json -Compress
    $child.StandardInput.WriteLine($inputJson)
    $child.StandardInput.Close()
    $inputJson = $null; $passText = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passPointer); $passPointer = [IntPtr]::Zero
    $outputTask = $child.StandardOutput.ReadToEndAsync()
    $errorTask = $child.StandardError.ReadToEndAsync()
    Require ($child.WaitForExit(30000)) 'LOCAL_VERIFIER_TIMEOUT'
    $output = $outputTask.GetAwaiter().GetResult()
    [void]$errorTask.GetAwaiter().GetResult()
    Require ($child.ExitCode -eq 0 -and $output.Length -lt 12000) 'BACKUP_DECRYPTION_DID_NOT_PASS'
    $proof = $output | ConvertFrom-Json
    Require ($proof.status -ceq 'OWNER_CURRENT_BACKUP_DECRYPTION_VERIFIED' -and $proof.authenticated_decryption_verified -eq $true) 'LOCAL_PROOF_DID_NOT_PASS'
    $proofFile = Join-Path $PSScriptRoot 'OWNER_BACKUP_DECRYPTION_PROOF.json'
    [IO.File]::WriteAllText($proofFile, $output, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'PASS - the actual backup decrypted and matched the captured SQL hash.'
    Write-Host ('Send only this result file back in chat: ' + $proofFile)
} catch {
    [Console]::Error.WriteLine('Verification stopped. Check the original packet, encrypted X25519 key path and its passphrase. No decrypted SQL was saved.')
    exit 2
} finally {
    if ($passPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passPointer) }
    if ($null -ne $passSecure) { $passSecure.Dispose() }
    if ($null -ne $child) {
        if ($childStarted -and -not $child.HasExited) { $child.Kill() }
        $child.Dispose()
    }
}
