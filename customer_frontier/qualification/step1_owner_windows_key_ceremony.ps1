# MUSITU AXIOM Step1 — Windows-only interactive owner-key ceremony, NOT RELEASE.
# Requires Windows PowerShell 5.1+ or PowerShell 7+, OpenSSL 3+, Node 20+.
# No cloud calls, no network, no generated owner secrets uploaded.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$KeysRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Deny([string]$message) { throw ('AXIOM_WINDOWS_OWNER_KEY_NO_GO:' + $message) }
function CheckInteractive {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Deny 'WINDOWS_DEVICE_REQUIRED' }
    if ($env:CI -or $env:GITHUB_ACTIONS) { Deny 'CI_OR_CLOUD_FORBIDDEN' }
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { Deny 'INTERACTIVE_OWNER_DEVICE_REQUIRED' }
}
function RunNative([string]$command,[string[]]$arguments) {
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { Deny ('NATIVE_COMMAND_FAILED_' + [IO.Path]::GetFileName($command)) }
}
CheckInteractive
if ($KeysRoot -notmatch '^[A-Za-z]:[\\/]') { Deny 'ABSOLUTE_LOCAL_DRIVE_PATH_REQUIRED' }
if ($KeysRoot -match '(?i)(^|[\\/])(OneDrive[^\\/]*|Dropbox|Google Drive|iCloudDrive)([\\/]|$)') { Deny 'SYNCED_DIRECTORY_FORBIDDEN' }
if (-not (Get-Command openssl.exe -ErrorAction SilentlyContinue)) { Deny 'OPENSSL_3_REQUIRED' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { Deny 'NODE_20_REQUIRED' }
$version = & openssl.exe version
if ($LASTEXITCODE -ne 0 -or $version -notmatch 'OpenSSL 3\.') { Deny 'OPENSSL_3_REQUIRED' }
$nodeVersion = & node.exe --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(2[0-9]|[3-9][0-9])\.') { Deny 'NODE_20_REQUIRED' }
$root = [IO.Path]::GetFullPath($KeysRoot)
if ([IO.DriveInfo]::new($root.Substring(0,3)).DriveType -ne [IO.DriveType]::Fixed) { Deny 'FIXED_LOCAL_DISK_REQUIRED' }
if ([IO.Directory]::Exists($root) -or [IO.File]::Exists($root)) { Deny 'DIRECTORY_ALREADY_EXISTS' }
$parent = [IO.Path]::GetDirectoryName($root)
if (-not [IO.Directory]::Exists($parent)) { Deny 'PARENT_DIRECTORY_NOT_PRESENT' }
$gitWalk = $parent
while ($gitWalk) {
    if ([IO.Directory]::Exists((Join-Path $gitWalk '.git')) -or [IO.File]::Exists((Join-Path $gitWalk '.git'))) { Deny 'GIT_WORKTREE_FORBIDDEN' }
    $gitUp = [IO.Path]::GetDirectoryName($gitWalk)
    if ($gitUp -eq $gitWalk) { break }
    $gitWalk = $gitUp
}
# Require non-reparse parent path to avoid known junction/symlink redirection.
$walk = $parent
while ($walk) {
    $attr = [IO.File]::GetAttributes($walk)
    if (($attr -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'PARENT_REPARSE_POINT_FORBIDDEN' }
    $up = [IO.Path]::GetDirectoryName($walk)
    if ($up -eq $walk) { break }
    $walk = $up
}
$root = (New-Item -ItemType Directory -Path $root -ErrorAction Stop).FullName
$private = (New-Item -ItemType Directory -Path (Join-Path $root 'private')).FullName
$public = (New-Item -ItemType Directory -Path (Join-Path $root 'public')).FullName
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
# Remove inherited ACLs and grant this owner only. Stop before keygen on failure.
foreach ($dir in @($root,$private,$public)) {
    RunNative 'icacls.exe' @($dir, '/inheritance:r', '/grant:r', ('*{0}:(OI)(CI)F' -f $sid))
}
$marker = Join-Path $root 'INCOMPLETE_NOT_AUTHORITY.txt'
[IO.File]::WriteAllText($marker, 'INCOMPLETE OWNER KEY CEREMONY - NOT RELEASE')
Write-Host 'Creating encrypted Ed25519 signing PEM on THIS Windows device. Enter a new passphrase locally.'
RunNative 'openssl.exe' @('genpkey','-algorithm','ED25519','-aes-256-cbc','-out',(Join-Path $private 'owner_ed25519_pkcs8_encrypted.pem'))
Write-Host 'Creating separate encrypted X25519 recovery PEM. Choose a different passphrase.'
RunNative 'openssl.exe' @('genpkey','-algorithm','X25519','-aes-256-cbc','-out',(Join-Path $private 'owner_x25519_pkcs8_encrypted.pem'))
Write-Host 'Extracting PUBLIC signing key; OpenSSL prompts for the local signing passphrase.'
RunNative 'openssl.exe' @('pkey','-in',(Join-Path $private 'owner_ed25519_pkcs8_encrypted.pem'),'-pubout','-out',(Join-Path $public 'owner_ed25519_spki.pem'))
Write-Host 'Extracting PUBLIC recovery key; OpenSSL prompts for the local recovery passphrase.'
RunNative 'openssl.exe' @('pkey','-in',(Join-Path $private 'owner_x25519_pkcs8_encrypted.pem'),'-pubout','-out',(Join-Path $public 'owner_x25519_spki.pem'))
RunNative 'openssl.exe' @('pkey','-pubin','-in',(Join-Path $public 'owner_ed25519_spki.pem'),'-outform','DER','-out',(Join-Path $public 'owner_ed25519_spki.der'))
RunNative 'openssl.exe' @('pkey','-pubin','-in',(Join-Path $public 'owner_x25519_spki.pem'),'-outform','DER','-out',(Join-Path $public 'owner_x25519_spki.der'))
$helper = Join-Path $PSScriptRoot 'step1_owner_windows_public_receipt.mjs'
RunNative 'node.exe' @($helper,$public)
# Restrict permissions on all new files, not just on the directories.
RunNative 'icacls.exe' @($root,'/inheritance:r','/grant:r',('*{0}:(OI)(CI)F' -f $sid),'/T')
Remove-Item -LiteralPath $marker -Force
Write-Host 'AXIOM_OWNER_KEYS_CREATED_ON_WINDOWS_OWNER_DEVICE_REPORTED_ONLY_NO_GO_NOT_RELEASE'
Write-Host 'Keep private keys/passphrases OFFLINE. Do not upload private/ or key material to any cloud.'
Write-Host 'The public/ folder is NOT yet independently approved as a runtime trust root.'
