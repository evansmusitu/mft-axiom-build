#requires -Version 5.1
<#
 AXIOM Step1 Windows owner encrypted key RESTORE rehearsal only. NOT RELEASE.
 The existing PR241 Windows OpenSSL ceremony/sign tools remain unchanged.
 Requires Node 20+, PowerShell 5.1+, local NTFS and a live owner console.
 No WSL/Ubuntu, Python or OpenSSL is required for THIS restored-key check.
 Never run with real owner keys in CI, GitHub, cloud browser or ChatGPT.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$KeysRoot,
  [Parameter(Mandatory=$true)][string]$RestoredRoot,
  [Parameter(Mandatory=$true)][string]$NewProofRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Deny([string]$message) { throw ('AXIOM_STEP1_WINDOWS_RESTORE_NO_GO:' + $message) }
$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
function LocalPath([string]$value) {
  if (-not $value -or $value -notmatch '^[A-Za-z]:[\\/]') { Deny 'ABSOLUTE_LOCAL_DRIVE_REQUIRED' }
  $p=[IO.Path]::GetFullPath($value)
  if ($p -match '(?i)(^|[\\/])(OneDrive[^\\/]*|Dropbox|Google Drive|iCloudDrive)([\\/]|$)') { Deny 'CLOUD_SYNC_PATH_REFUSED' }
  $drive=[IO.DriveInfo]::new($p.Substring(0,3))
  if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') {
    Deny 'LOCAL_FIXED_NTFS_REQUIRED'
  }
  return $p
}
function ValidateNoReparse([string]$p) {
  $item=Get-Item -LiteralPath $p -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny 'REPARSE_OR_JUNCTION_REFUSED' }
}
function ValidateAcl([string]$p,[bool]$protected) {
  ValidateNoReparse $p
  $acl=Get-Acl -LiteralPath $p
  if($protected -and -not $acl.AreAccessRulesProtected){Deny 'OWNER_NTFS_ACL_NOT_PROTECTED'}
  $aces=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
  $ownerAllowed=$false
  foreach($ace in $aces){
    if($ace.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow){
      if($ace.IdentityReference.Value -ne $ownerSid.Value){Deny 'UNAPPROVED_NTFS_ACCESS_PRINCIPAL'}
      $ownerAllowed=$true
    }
  }
  if(-not $ownerAllowed){Deny 'OWNER_NTFS_ACL_MISSING'}
}
function ValidateOwnerKeyRoot([string]$root,[bool]$requirePublic) {
  if(-not (Test-Path -LiteralPath $root -PathType Container)){Deny 'KEY_DIRECTORY_MISSING'}
  ValidateAcl $root $true
  $private=Join-Path $root 'private'
  if(-not (Test-Path -LiteralPath $private -PathType Container)){Deny 'ENCRYPTED_PRIVATE_DIRECTORY_REQUIRED'}
  ValidateAcl $private $true
  foreach($n in @('owner_ed25519_pkcs8_encrypted.pem','owner_x25519_pkcs8_encrypted.pem')){
    $p=Join-Path $private $n
    if(-not (Test-Path -LiteralPath $p -PathType Leaf)){Deny 'ENCRYPTED_OWNER_PEM_MISSING'}
    ValidateAcl $p $false
  }
  if($requirePublic){
    $public=Join-Path $root 'public'
    if(-not (Test-Path -LiteralPath $public -PathType Container)){Deny 'ORIGINAL_PUBLIC_DIRECTORY_REQUIRED'}
    ValidateAcl $public $true
    foreach($n in @('owner_ed25519_spki.der','owner_x25519_spki.der')){
      $p=Join-Path $public $n
      if(-not (Test-Path -LiteralPath $p -PathType Leaf)){Deny 'ORIGINAL_PUBLIC_KEY_MISSING'}
      ValidateAcl $p $false
    }
  }
}
function LockOwnerAcl([string]$p) {
  $acl=Get-Acl -LiteralPath $p
  $acl.SetAccessRuleProtection($true,$false)
  foreach($r in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($r)}
  $flags=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($ownerSid,
    [Security.AccessControl.FileSystemRights]::FullControl,$flags,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
  $acl.SetOwner($ownerSid)
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $p -AclObject $acl
  ValidateAcl $p $true
}
try {
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
     $env:CI -or $env:GITHUB_ACTIONS -or $env:TF_BUILD -or
     -not [Environment]::UserInteractive -or
     [Console]::IsInputRedirected -or [Console]::IsOutputRedirected){
    Deny 'INTERACTIVE_OWNER_WINDOWS_DEVICE_ONLY'
  }
  $node=Get-Command node.exe -ErrorAction Stop
  $major=& $node.Source -p 'process.versions.node.split(".")[0]'
  if($LASTEXITCODE -ne 0 -or [int]$major -lt 20){Deny 'NODE_20_PLUS_REQUIRED'}
  if($env:AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256 -notmatch '^[0-9a-f]{64}$' -or
     $env:AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256 -notmatch '^[0-9a-f]{64}$'){
    Deny 'INDEPENDENTLY_REVIEWED_PUBLIC_SPKI_PINS_REQUIRED'
  }
  $source=LocalPath $KeysRoot
  $restored=LocalPath $RestoredRoot
  $out=LocalPath $NewProofRoot
  if([string]::Equals($source,$restored,[StringComparison]::OrdinalIgnoreCase)){
    Deny 'REQUIRES_SEPARATE_RESTORED_DIRECTORY'
  }
  if(Test-Path -LiteralPath $out){Deny 'NEW_OUTPUT_ONLY_NO_OVERWRITE'}
  ValidateOwnerKeyRoot $source $true
  ValidateOwnerKeyRoot $restored $false
  $parent=Split-Path -Parent $out
  if(-not (Test-Path -LiteralPath $parent -PathType Container)){Deny 'OUTPUT_PARENT_MISSING'}
  ValidateNoReparse $parent
  [void][IO.Directory]::CreateDirectory($out)
  LockOwnerAcl $out
  $marker=Join-Path $out '.AXIOM_WINDOWS_RESTORED_COPY_OWNER_ACL_CONFIRMED_NO_GO'
  [IO.File]::WriteAllText($marker,"AXIOM_WINDOWS_OWNER_ACL_REVIEW_ONLY_NO_RELEASE`n",[Text.UTF8Encoding]::new($false))
  $script=Join-Path $PSScriptRoot 'step1_owner_windows_restored_keys.mjs'
  if(-not (Test-Path -LiteralPath $script -PathType Leaf)){Deny 'NODE_RESTORATION_SCRIPT_MISSING'}
  & $node.Source $script $source $restored $out
  if($LASTEXITCODE -ne 0){Deny 'LOCAL_ENCRYPTED_KEY_RESTORATION_FAILED'}
  ValidateAcl $out $true
  Write-Output 'AXIOM_STEP1_WINDOWS_RESTORED_KEYS_REHEARSAL_ONLY_NO_GO_NOT_RELEASE'
} catch {
  Write-Error ('AXIOM_STEP1_WINDOWS_RESTORE_NO_GO:' + $_.Exception.Message)
  exit 2
}
