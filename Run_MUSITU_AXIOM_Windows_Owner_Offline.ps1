#requires -Version 5.1
<#
  MUSITU AXIOM Step 1 - governed owner Windows offline orchestration.
  Works with the original verified 13-Nov-2026 Windows Owner Offline Package.
  NO Ubuntu, WSL, Internet, GitHub Actions, production D1 access or cloud uploads.
  This script deliberately cannot qualify owner MFA, external spend caps, hosted
  D1 restore, independent evidence, Step 2, or product release.
  NEVER copy private keys/passphrases into a chat, GitHub, Drive or CI.
#>
[CmdletBinding()]
param(
    [string]$KeysRoot = (Join-Path $env:LOCALAPPDATA 'AXIOM_PRIVATE_KEYS_NOV2026'),
    [string]$BackupRoot,
    [string]$RestoredRoot,
    [string]$ProofRoot,
    [string]$ProposalRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256 = ''
$env:AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256 = ''

function Deny([string]$why) { throw ('AXIOM_OWNER_OFFLINE_NO_GO:' + $why) }
function Require([bool]$ok, [string]$why) { if (-not $ok) { Deny $why } }
function Announce([string]$message) { Write-Host ('[AXIOM] ' + $message) }
function Invoke-Local([string]$exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { Deny ('LOCAL_COMMAND_FAILED_' + [IO.Path]::GetFileName($exe)) }
}
function Ensure-InteractiveOwner {
    Require ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) 'WINDOWS_REQUIRED_NO_WSL'
    Require (-not ($env:CI -or $env:GITHUB_ACTIONS -or $env:TF_BUILD)) 'CLOUD_RUNNER_FORBIDDEN'
    Require ([Environment]::UserInteractive) 'OWNER_CONSOLE_REQUIRED'
    Require (-not ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected)) 'REAL_INTERACTIVE_CONSOLE_REQUIRED'
}
function Canonical-DrivePath([string]$given, [string]$label) {
    Require ($given -match '^[A-Za-z]:[\\/]') ($label + '_ABSOLUTE_DRIVE_PATH_REQUIRED')
    $clean = [IO.Path]::GetFullPath($given).TrimEnd('\', '/')
    Require ($clean -match '^[A-Za-z]:\\') ($label + '_INVALID_FULL_PATH')
    Require ($clean -notmatch '(?i)(^|[\\/])(OneDrive[^\\/]*|Dropbox|Google Drive|iCloudDrive)([\\/]|$)') ($label + '_CLOUD_SYNC_FORBIDDEN')
    $drive = [IO.DriveInfo]::new($clean.Substring(0,3))
    Require ($drive.IsReady) ($label + '_DRIVE_NOT_READY')
    Require ($drive.DriveType -ne [IO.DriveType]::Network) ($label + '_NETWORK_DRIVE_FORBIDDEN')
    Require ($drive.DriveType -ne [IO.DriveType]::CDRom) ($label + '_NONWRITABLE_DRIVE_FORBIDDEN')
    return $clean
}
function Guard-Ancestors([string]$target, [string]$label) {
    $parent = [IO.Path]::GetDirectoryName($target)
    Require (-not [string]::IsNullOrWhiteSpace($parent)) ($label + '_PARENT_REQUIRED')
    Require ([IO.Directory]::Exists($parent)) ($label + '_PARENT_NOT_FOUND')
    $walk = $parent
    while ($walk) {
        $item = Get-Item -LiteralPath $walk -Force
        Require (-not (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) ($label + '_REPARSE_PARENT_REFUSED')
        Require (-not ([IO.Directory]::Exists((Join-Path $walk '.git')) -or [IO.File]::Exists((Join-Path $walk '.git')))) ($label + '_GIT_WORKTREE_REFUSED')
        $up = [IO.Path]::GetDirectoryName($walk)
        if (-not $up -or $up -eq $walk) { break }
        $walk = $up
    }
}
function Lock-OwnerAcl([string]$path) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Invoke-Local 'icacls.exe' @($path, '/inheritance:r', '/grant:r', ('*{0}:(OI)(CI)F' -f $sid), '/T')
    $acl = Get-Acl -LiteralPath $path
    Require ($acl.AreAccessRulesProtected) 'OWNER_ONLY_NTFS_ACL_REQUIRED'
}
function New-PrivateFolder([string]$path) {
    Require (-not (Test-Path -LiteralPath $path)) 'REFUSE_OVERWRITE_EXISTING_DIRECTORY'
    Guard-Ancestors $path 'NEW_PRIVATE_FOLDER'
    [void][IO.Directory]::CreateDirectory($path)
    Lock-OwnerAcl $path
}
function Assert-RegularFile([string]$path, [string]$label) {
    Require (Test-Path -LiteralPath $path -PathType Leaf) ($label + '_MISSING')
    $file = Get-Item -LiteralPath $path -Force
    Require (-not (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) ($label + '_REPARSE_FORBIDDEN')
}
function Sha([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Check-SourceManifest {
    $manifestPath = Join-Path $PSScriptRoot 'MANIFEST_SHA256.json'
    Assert-RegularFile $manifestPath 'SOURCE_MANIFEST'
    # Expected digest is pinned to the immutable 13-Nov-2026 Windows package.
    # This prevents a replacement manifest from silently validating modified code.
    Require ((Sha $manifestPath) -eq '3eb99c73145fae2934951916a2c66e98689be946071561e6d8d45d87fde8f7d3') 'ORIGINAL_PACKAGE_MANIFEST_CHANGED'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $files = @($manifest.files_sha256.PSObject.Properties)
    Require ($files.Count -eq 8) 'EXPECTED_EIGHT_SOURCE_FILES'
    $base = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $files) {
        $rel = [string]$entry.Name
        Require ($rel -match '^customer_frontier/(qualification|tests)/[A-Za-z0-9_.-]+$') 'UNEXPECTED_MANIFEST_PATH'
        $resolved = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ($rel.Replace('/', [IO.Path]::DirectorySeparatorChar))))
        Require ($resolved.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) 'MANIFEST_PATH_ESCAPE'
        Assert-RegularFile $resolved 'VERIFIED_SOURCE'
        Require ((Sha $resolved) -ceq ([string]$entry.Value).ToLowerInvariant()) ('FILE_HASH_MISMATCH_' + $rel)
    }
    Announce 'Eight original package files match the pinned SHA-256 manifest.'
}
function Check-Programs {
    foreach($program in @('openssl.exe','node.exe','icacls.exe')) {
        Require ([bool](Get-Command $program -ErrorAction SilentlyContinue)) ('INSTALL_LOCALLY_FIRST_' + $program)
    }
    $opensslVersion = (& openssl.exe version | Out-String)
    Require ($LASTEXITCODE -eq 0 -and $opensslVersion -match '^OpenSSL 3\.') 'OPENSSL_3_REQUIRED'
    $nodeVersion = (& node.exe --version | Out-String).Trim()
    Require ($LASTEXITCODE -eq 0 -and $nodeVersion -match '^v(2[0-9]|[3-9][0-9])\.') 'NODE_20_PLUS_REQUIRED'
    Announce ('Native prerequisites verified: ' + $nodeVersion + ', ' + $opensslVersion.Trim())
}
function Verify-EncryptedKeys([string]$dir) {
    Require (Test-Path -LiteralPath $dir -PathType Container) 'MISSING_ENCRYPTED_PRIVATE_DIRECTORY'
    foreach($file in @('owner_ed25519_pkcs8_encrypted.pem','owner_x25519_pkcs8_encrypted.pem')) {
        $path = Join-Path $dir $file
        Assert-RegularFile $path 'ENCRYPTED_KEY'
        $first = Get-Content -LiteralPath $path -TotalCount 1 -Encoding ASCII
        Require ($first -ceq '-----BEGIN ENCRYPTED PRIVATE KEY-----') 'NOT_AN_ENCRYPTED_PKCS8_PRIVATE_KEY'
    }
}
function Verified-Pins([string]$root) {
    $receiptPath = Join-Path (Join-Path $root 'public') 'OWNER_PUBLIC_PINS_NOT_ATTESTATION.json'
    Assert-RegularFile $receiptPath 'PUBLIC_RECEIPT'
    $r = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $s = [string]$r.owner_ed25519_spki_sha256
    $x = [string]$r.owner_x25519_spki_sha256
    Require ($s -match '^[a-f0-9]{64}$' -and $x -match '^[a-f0-9]{64}$' -and $s -cne $x) 'INVALID_PUBLIC_PIN_RECEIPT'
    Require ($r.step1_closed -eq $false -and $r.release -ceq 'NOT_RELEASE') 'PUBLIC_RECEIPT_AUTHORITY_VIOLATION'
    Require ((Sha (Join-Path $root 'public\owner_ed25519_spki.der')) -ceq $s) 'SIGNING_PUBLIC_DER_HASH_MISMATCH'
    Require ((Sha (Join-Path $root 'public\owner_x25519_spki.der')) -ceq $x) 'ENCRYPTION_PUBLIC_DER_HASH_MISMATCH'
    Write-Host ''
    Announce 'PUBLIC signing SPKI SHA-256:'
    Write-Host $s
    Announce 'PUBLIC recovery SPKI SHA-256:'
    Write-Host $x
    Write-Host 'These are NOT yet independently approved trust pins.'
    Write-Host 'Review and record them on a separate trusted owner-controlled record before continuing.'
    $approvedSign = (Read-Host 'Type the FULL separately reviewed Ed25519 public fingerprint').Trim()
    $approvedEnc = (Read-Host 'Type the FULL separately reviewed X25519 public fingerprint').Trim()
    Require ($approvedSign -ceq $s -and $approvedEnc -ceq $x) 'OWNER_PUBLIC_TRUST_PINS_NOT_CONFIRMED'
    $env:AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256 = $s
    $env:AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256 = $x
    return @($s,$x)
}
function Copy-EncryptedBackup([string]$original, [string]$external, [string]$keysDrive) {
    $backupDrive = [IO.Path]::GetPathRoot($external)
    Require (-not $backupDrive.Equals($keysDrive,[StringComparison]::OrdinalIgnoreCase)) 'BACKUP_MUST_BE_ON_DIFFERENT_DRIVE'
    Guard-Ancestors $external 'OFFLINE_BACKUP'
    $a = Join-Path $original 'private'
    Verify-EncryptedKeys $a
    if (-not (Test-Path -LiteralPath $external)) {
        Announce 'Copying only already-encrypted private PEM files to the separate offline backup drive.'
        [void][IO.Directory]::CreateDirectory($external)
        [void][IO.Directory]::CreateDirectory((Join-Path $external 'private'))
        Copy-Item -LiteralPath (Join-Path $a 'owner_ed25519_pkcs8_encrypted.pem') -Destination (Join-Path $external 'private')
        Copy-Item -LiteralPath (Join-Path $a 'owner_x25519_pkcs8_encrypted.pem') -Destination (Join-Path $external 'private')
    }
    $b = Join-Path $external 'private'
    Verify-EncryptedKeys $b
    foreach($name in @('owner_ed25519_pkcs8_encrypted.pem','owner_x25519_pkcs8_encrypted.pem')) {
        Require ((Sha (Join-Path $a $name)) -ceq (Sha (Join-Path $b $name))) ('BACKUP_COPY_MISMATCH_' + $name)
    }
    Announce 'Encrypted backup file hashes match. This alone does NOT prove physical separation or media encryption.'
    Write-Host 'Keep both passphrases off the backup drive. Protect the physical drive with device encryption.'
    $confirm = Read-Host 'Type I CONTROL THIS SEPARATE OFFLINE BACKUP to acknowledge'
    Require ($confirm -ceq 'I CONTROL THIS SEPARATE OFFLINE BACKUP') 'OFFLINE_BACKUP_OWNER_ACKNOWLEDGEMENT_REQUIRED'
    Write-Host 'DISCONNECT or unmount your backup drive now, then press Enter.'
    [void](Read-Host 'After disconnecting, press Enter')
    Require (-not (Test-Path -LiteralPath $external)) 'EXTERNAL_BACKUP_NOT_DISCONNECTED'
    Write-Host 'Reconnect or remount your backup drive, then press Enter.'
    [void](Read-Host 'After reconnecting, press Enter')
    Require (Test-Path -LiteralPath $external -PathType Container) 'EXTERNAL_BACKUP_NOT_RESTORED'
    Verify-EncryptedKeys $b
    foreach($name in @('owner_ed25519_pkcs8_encrypted.pem','owner_x25519_pkcs8_encrypted.pem')) {
        Require ((Sha (Join-Path $a $name)) -ceq (Sha (Join-Path $b $name))) ('RECONNECTED_BACKUP_MISMATCH_' + $name)
    }
    Announce 'Backup returned after disconnect and its encrypted file hashes match.'
}
function Restore-EncryptedBackup([string]$external, [string]$localRoot) {
    New-PrivateFolder $localRoot
    $private = Join-Path $localRoot 'private'
    [void][IO.Directory]::CreateDirectory($private)
    Lock-OwnerAcl $private
    foreach($name in @('owner_ed25519_pkcs8_encrypted.pem','owner_x25519_pkcs8_encrypted.pem')) {
        Copy-Item -LiteralPath (Join-Path (Join-Path $external 'private') $name) -Destination (Join-Path $private $name)
    }
    Lock-OwnerAcl $localRoot
    Verify-EncryptedKeys $private
}
function Prove-RestoredKeys([string]$keys, [string]$restored, [string]$proof, [string[]]$pins) {
    New-PrivateFolder $proof
    $scratch = Join-Path $proof '_VOLATILE_CRYPTO_DATA_DELETE_AFTER_USE'
    [void][IO.Directory]::CreateDirectory($scratch)
    Lock-OwnerAcl $scratch
    try {
        $ed = Join-Path $restored 'private\owner_ed25519_pkcs8_encrypted.pem'
        $enc = Join-Path $restored 'private\owner_x25519_pkcs8_encrypted.pem'
        $signDer = Join-Path $scratch 'sign.der'
        $encDer = Join-Path $scratch 'enc.der'
        Announce 'OpenSSL will request your signing passphrase locally to check RESTORED key identity.'
        Invoke-Local 'openssl.exe' @('pkey','-in',$ed,'-pubout','-outform','DER','-out',$signDer)
        Announce 'OpenSSL will request your recovery passphrase locally to check RESTORED key identity.'
        Invoke-Local 'openssl.exe' @('pkey','-in',$enc,'-pubout','-outform','DER','-out',$encDer)
        Require ((Sha $signDer) -ceq $pins[0]) 'RESTORED_SIGNING_KEY_DOES_NOT_MATCH_TRUSTED_PIN'
        Require ((Sha $encDer) -ceq $pins[1]) 'RESTORED_RECOVERY_KEY_DOES_NOT_MATCH_TRUSTED_PIN'
        $challenge = Join-Path $scratch 'random_challenge.bin'
        $challengeBytes = New-Object byte[] 64
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($challengeBytes) } finally { $rng.Dispose() }
        [IO.File]::WriteAllBytes($challenge,$challengeBytes)
        $signature = Join-Path $scratch 'signature.bin'
        Invoke-Local 'openssl.exe' @('pkeyutl','-sign','-rawin','-inkey',$ed,'-in',$challenge,'-out',$signature)
        Require ((Get-Item -LiteralPath $signature).Length -eq 64) 'RESTORED_ED25519_SIGNATURE_INVALID'
        Invoke-Local 'openssl.exe' @('pkeyutl','-verify','-rawin','-pubin','-inkey',(Join-Path $keys 'public\owner_ed25519_spki.pem'),'-in',$challenge,'-sigfile',$signature)
        $ephemeral = Join-Path $scratch 'ephemeral_x25519_key.pem'
        $ephemPublic = Join-Path $scratch 'ephemeral_x25519_public.pem'
        $shared1 = Join-Path $scratch 'shared_from_restored.bin'
        $shared2 = Join-Path $scratch 'shared_from_ephemeral.bin'
        Invoke-Local 'openssl.exe' @('genpkey','-algorithm','X25519','-out',$ephemeral)
        Invoke-Local 'openssl.exe' @('pkey','-in',$ephemeral,'-pubout','-out',$ephemPublic)
        Announce 'OpenSSL will request your recovery passphrase to test X25519 agreement locally.'
        Invoke-Local 'openssl.exe' @('pkeyutl','-derive','-inkey',$enc,'-peerkey',$ephemPublic,'-out',$shared1)
        Invoke-Local 'openssl.exe' @('pkeyutl','-derive','-inkey',$ephemeral,'-peerkey',(Join-Path $keys 'public\owner_x25519_spki.pem'),'-out',$shared2)
        Require ((Get-Item -LiteralPath $shared1).Length -eq 32) 'X25519_SHARED_SECRET_SIZE_MISMATCH'
        Require ((Sha $shared1) -ceq (Sha $shared2)) 'X25519_SHARED_SECRET_MISMATCH'
        $report = [ordered]@{
            schema='musitu.axiom.step1.windows-owner-offline-orchestrator.v1'
            status='LOCAL_OWNER_RECOVERY_AND_PROPOSAL_ONLY_NO_GO'
            verified_at_utc=[DateTime]::UtcNow.ToString('o')
            signing_public_spki_sha256=$pins[0]
            encryption_public_spki_sha256=$pins[1]
            encrypted_backup_reconnected_and_hash_matched_owner_reported=$true
            restored_encrypted_key_ed25519_signature_verified_locally=$true
            restored_x25519_key_agreement_verified_locally=$true
            owner_identity_and_mfa_independently_qualified=$false
            physical_media_separation_independently_attested=$false
            public_trust_roots_independently_activated=$false
            current_customer_encrypted_sql_backup_qualified=$false
            provider_zero_additional_spend_qualified=$false
            hosted_d1_restore_parity_qualified=$false
            existing_pr216_authority_gate_changed=$false
            step1_closed=$false
            step2_authorized=$false
            release_authorized=$false
            release_status='NOT_RELEASE'
        }
        $reportPath = Join-Path $proof 'AXIOM_OWNER_OFFLINE_PROOF_NOT_RELEASE.json'
        [IO.File]::WriteAllText($reportPath,($report | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
    } finally {
        if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Announce 'Restored encrypted keys passed local Ed25519 and X25519 challenge tests.'
}

try {
    Ensure-InteractiveOwner
    Check-SourceManifest
    Check-Programs
    $keys = Canonical-DrivePath $KeysRoot 'OWNER_KEYS'
    Require ([IO.DriveInfo]::new($keys.Substring(0,3)).DriveType -eq [IO.DriveType]::Fixed) 'OWNER_KEYS_MUST_BE_ON_LOCAL_FIXED_DRIVE'
    $keysDrive = [IO.Path]::GetPathRoot($keys)
    if (-not $BackupRoot) {
        Write-Host 'Enter the new folder on a SEPARATE physical offline backup drive (for example E:\AXIOM_BACKUP_NOV2026).'
        $BackupRoot = Read-Host 'Backup directory on separate offline drive'
    }
    $backup = Canonical-DrivePath $BackupRoot 'OFFLINE_BACKUP'
    Require (-not ([IO.Path]::GetPathRoot($backup)).Equals($keysDrive,[StringComparison]::OrdinalIgnoreCase)) 'BACKUP_ON_SAME_DRIVE_FORBIDDEN'
    $id = [DateTime]::UtcNow.ToString('yyyyMMdd_HHmmssfff')
    if (-not $RestoredRoot) { $RestoredRoot = Join-Path ([IO.Path]::GetDirectoryName($keys)) ('AXIOM_RESTORED_ENCRYPTED_KEYS_' + $id) }
    if (-not $ProofRoot) { $ProofRoot = Join-Path ([IO.Path]::GetDirectoryName($keys)) ('AXIOM_OWNER_OFFLINE_PROOF_' + $id) }
    if (-not $ProposalRoot) { $ProposalRoot = Join-Path ([IO.Path]::GetDirectoryName($keys)) ('AXIOM_OWNER_SIGNED_PROPOSAL_' + $id) }
    $restored = Canonical-DrivePath $RestoredRoot 'RESTORED_KEYS'
    $proof = Canonical-DrivePath $ProofRoot 'OFFLINE_PROOF'
    $proposal = Canonical-DrivePath $ProposalRoot 'OFFLINE_PROPOSAL'
    Require (($keys -cne $restored) -and ($keys -cne $backup) -and ($restored -cne $proof) -and ($proof -cne $proposal) -and ($restored -cne $proposal)) 'DIRECTORY_COLLISION_FORBIDDEN'
    foreach($path in @($restored,$proof,$proposal)) { Require ([IO.Path]::GetPathRoot($path) -eq $keysDrive) 'RECOVERY_PROOF_AND_PROPOSAL_MUST_BE_ON_OWNER_LOCAL_DRIVE' }
    Require (-not (Test-Path -LiteralPath $restored)) 'RESTORED_FOLDER_ALREADY_EXISTS'
    Require (-not (Test-Path -LiteralPath $proof)) 'PROOF_FOLDER_ALREADY_EXISTS'
    Require (-not (Test-Path -LiteralPath $proposal)) 'PROPOSAL_FOLDER_ALREADY_EXISTS'
    if (-not (Test-Path -LiteralPath $keys)) {
        Guard-Ancestors $keys 'OWNER_KEY'
        Announce 'Running the existing verified Windows owner-key ceremony (no key material leaves this PC).'
        & (Join-Path $PSScriptRoot 'customer_frontier\qualification\step1_owner_windows_key_ceremony.ps1') -KeysRoot $keys
    } else {
        Announce 'Existing owner key directory found. Never overwriting or regenerating it.'
    }
    Require (-not (Test-Path -LiteralPath (Join-Path $keys 'INCOMPLETE_NOT_AUTHORITY.txt'))) 'KEY_CEREMONY_INCOMPLETE_STOP_FOR_OWNER_REVIEW'
    Verify-EncryptedKeys (Join-Path $keys 'private')
    $pins = Verified-Pins $keys
    Copy-EncryptedBackup $keys $backup $keysDrive
    Restore-EncryptedBackup $backup $restored
    Prove-RestoredKeys $keys $restored $proof $pins
    Announce 'Preparing one short-lived owner-signed PROPOSAL only; this is NEVER D1 authorization.'
    & (Join-Path $PSScriptRoot 'customer_frontier\qualification\step1_owner_windows_signed_proposal.ps1') -KeysRoot $keys -NewProposalRoot $proposal
    Require (Test-Path -LiteralPath (Join-Path $proposal 'OWNER_SIGNATURE_PROPOSAL_ONLY_NO_GO.json')) 'OWNER_SIGNED_PROPOSAL_NOT_VERIFIED'
    $signed = Get-Content -LiteralPath (Join-Path $proposal 'OWNER_SIGNATURE_PROPOSAL_ONLY_NO_GO.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Require ($signed.release_authorized -eq $false -and $signed.step_1_closed -eq $false -and $signed.release_status -ceq 'NOT_RELEASE') 'SIGNED_PROPOSAL_AUTHORITY_VIOLATION'
    Write-Host ''
    Announce 'Local owner ceremony, external encrypted backup, restoration rehearsal and proposal completed with NO_GO controls.'
    Write-Host ('Local proof: ' + $proof)
    Write-Host ('Signed proposal: ' + $proposal)
    Write-Host 'Step 1 remains OPEN. Do not upload encrypted private keys or backup drive contents to cloud or chat.'
    Write-Host 'No production OAuth migration, D1 import, spend, Step2 or release was performed.'
    exit 0
} catch {
    [Console]::Error.WriteLine('AXIOM_WINDOWS_OWNER_OFFLINE_NO_GO:' + $_.Exception.Message)
    [Console]::Error.WriteLine('Stopped without granting D1, production, spending or release authority. Existing private data will NOT be overwritten.')
    exit 2
} finally {
    $env:AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256 = ''
    $env:AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256 = ''
}
