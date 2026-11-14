# MUSITU AXIOM Step1 Windows-only owner proposal review/sign — NOT RELEASE.
# Does not authorize database creation, export, restore, spend or release.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$KeysRoot,
      [Parameter(Mandatory=$true)][string]$NewProposalRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Deny([string]$message) { throw ('AXIOM_WINDOWS_OWNER_SIGN_NO_GO:' + $message) }
function RunNative([string]$cmd,[string[]]$arguments) {
    & $cmd @arguments
    if ($LASTEXITCODE -ne 0) { Deny ('LOCAL_COMMAND_FAILED_' + [IO.Path]::GetFileName($cmd)) }
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $env:CI -or $env:GITHUB_ACTIONS) { Deny 'WINDOWS_OFFLINE_OWNER_ONLY' }
if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { Deny 'INTERACTIVE_TERMINAL_REQUIRED' }
foreach($cmd in @('node.exe','openssl.exe')) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Deny ('LOCAL_PREREQUISITE_MISSING_' + $cmd) } }
if ($KeysRoot -notmatch '^[A-Za-z]:[\\/]' -or $NewProposalRoot -notmatch '^[A-Za-z]:[\\/]') { Deny 'ABSOLUTE_LOCAL_PATH_REQUIRED' }
foreach($p in @($KeysRoot,$NewProposalRoot)) { if ($p -match '(?i)(^|[\\/])(OneDrive[^\\/]*|Dropbox|Google Drive|iCloudDrive)([\\/]|$)') { Deny 'SYNCED_DIRECTORY_FORBIDDEN' } }
if ($env:AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256 -notmatch '^[0-9a-f]{64}$' -or $env:AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256 -notmatch '^[0-9a-f]{64}$') { Deny 'SEPARATELY_REVIEWED_PUBLIC_TRUST_PINS_REQUIRED' }
$keys = [IO.Path]::GetFullPath($KeysRoot)
$out = [IO.Path]::GetFullPath($NewProposalRoot)
foreach($localPath in @($keys,$out)) {
    if ([IO.DriveInfo]::new($localPath.Substring(0,3)).DriveType -ne [IO.DriveType]::Fixed) { Deny 'FIXED_LOCAL_DISK_REQUIRED' }
}
if ([IO.Directory]::Exists($out) -or [IO.File]::Exists($out)) { Deny 'OUTPUT_ALREADY_EXISTS' }
$tool = Join-Path $PSScriptRoot 'step1_owner_device_signed_proposal.mjs'
RunNative 'node.exe' @($tool,'prepare',$keys,$out)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
RunNative 'icacls.exe' @($out,'/inheritance:r','/grant:r',('*{0}:(OI)(CI)F' -f $sid),'/T')
# Prepared proposal JSON files require explicit OWNER FILE ACEs too.
foreach ($name in @('OWNER_PROPOSAL_PAYLOAD.json','OWNER_PREPARATION_NO_GO.json')) {
    $leaf = Join-Path $out $name
    if (-not (Test-Path -LiteralPath $leaf -PathType Leaf)) { Deny 'PREPARED_PROPOSAL_FILE_MISSING' }
    $attributes = (Get-Item -LiteralPath $leaf -Force).Attributes
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'PROPOSAL_REPARSE_FILE_REFUSED' }
    RunNative 'icacls.exe' @($leaf,'/inheritance:r','/grant:r',('*{0}:F' -f $sid))
}
$payload = Join-Path $out 'OWNER_PROPOSAL_PAYLOAD.json'
$info = Get-Item -LiteralPath $payload -ErrorAction Stop
if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Deny 'UNSAFE_PAYLOAD_FILE' }
$before = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host '----- EXACT OWNER RECOVERY PROPOSAL (PROPOSAL ONLY, NOT RELEASE) -----'
Write-Host ([IO.File]::ReadAllText($payload,[Text.Encoding]::UTF8))
Write-Host ('SHA-256: ' + $before)
Write-Host 'Inspect every field. This signature NEVER authorizes Cloudflare operations.'
$review = Read-Host 'Type the exact full SHA-256 above, or anything else to deny'
if ($review -cne $before) { Deny 'EXACT_PROPOSAL_REVIEW_NOT_CONFIRMED' }
if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant() -cne $before) { Deny 'PROPOSAL_CHANGED_AFTER_REVIEW' }
Write-Host 'Local OpenSSL will prompt for your signing key passphrase. Do not enter it in ChatGPT.'
RunNative 'openssl.exe' @('pkeyutl','-sign','-rawin','-inkey',(Join-Path $keys 'private\owner_ed25519_pkcs8_encrypted.pem'),'-in',$payload,'-out',(Join-Path $out 'OWNER_SIGNATURE.bin'))
if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant() -cne $before) { Deny 'PROPOSAL_CHANGED_DURING_SIGNING' }
RunNative 'node.exe' @($tool,'finalize',$keys,$out)
Write-Host 'AXIOM_OWNER_WINDOWS_EXACT_SIGNED_PROPOSAL_ONLY_NO_GO_NOT_RELEASE'
