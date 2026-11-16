#requires -Version 5.1
[CmdletBinding()]
param([switch]$PublicSelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Deny([string]$code){throw ('A2_SIGNER_CHECK_STOPPED:'+ $code)}
$ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
function CheckNoReparse([string]$value){
  $p=[IO.Path]::GetFullPath($value)
  while($p){$i=Get-Item -LiteralPath $p -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Deny 'REPARSE_PATH_REFUSED'};$next=Split-Path -Parent $p;if($next -eq $p){break};$p=$next}
}
function CheckLocal([string]$value){
  if($value -notmatch '^[A-Za-z]:[\\/]'){Deny 'LOCAL_ABSOLUTE_PATH_REQUIRED'}
  $p=[IO.Path]::GetFullPath($value)
  if($p -match '(?i)(^|[\\/])(OneDrive[^\\/]*|Dropbox|Google Drive|iCloudDrive)([\\/]|$)'){Deny 'CLOUD_SYNC_PRIVATE_PATH_REFUSED'}
  $d=[IO.DriveInfo]::new($p.Substring(0,3));if(-not $d.IsReady -or $d.DriveType -ne [IO.DriveType]::Fixed -or $d.DriveFormat -ne 'NTFS'){Deny 'LOCAL_FIXED_NTFS_REQUIRED'}
  CheckNoReparse $p
  return $p
}
function CheckAcl([string]$p,[bool]$protected){
  $a=Get-Acl -LiteralPath $p
  if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $ownerSid.Value){Deny 'CURRENT_OWNER_REQUIRED'}
  if($protected -and -not $a.AreAccessRulesProtected){Deny 'PROTECTED_OWNER_ACL_REQUIRED'}
  $allowed=$false
  foreach($ace in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($ace.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow){if($ace.IdentityReference.Value -ne $ownerSid.Value){Deny 'OTHER_PRINCIPAL_CAN_ACCESS_KEY'};$allowed=$true}}
  if(-not $allowed){Deny 'OWNER_ACCESS_RULE_REQUIRED'}
}
function LockDirectory([string]$p){
  $a=Get-Acl -LiteralPath $p;$a.SetAccessRuleProtection($true,$false)
  foreach($rule in @($a.Access)){[void]$a.RemoveAccessRuleSpecific($rule)}
  $flags=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($ownerSid,[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  $a.SetOwner($ownerSid);$a.SetAccessRule($rule);Set-Acl -LiteralPath $p -AclObject $a;CheckAcl $p $true
}
function CheckPacket{
  $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'PACKET_MANIFEST.json') -Raw | ConvertFrom-Json
  if($manifest.schema -ne 'musitu.axiom.authority2.possession-packet.v1' -or $manifest.deployment_performed -ne $false -or $manifest.gate3_closed -ne $false -or $manifest.private_key_material_included -ne $false -or $manifest.network_operations -ne 0 -or $manifest.release_status -ne 'NOT_RELEASE'){Deny 'PACKET_SCOPE_INVALID'}
  $names=@('Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1','step3_authority2_signer_possession.mjs','challenge.json','owner_ed25519_spki.der','README.txt')
  if(@($manifest.files).Count -ne $names.Count){Deny 'PACKET_FILE_LIST_INVALID'}
  foreach($name in $names){$entry=@($manifest.files | Where-Object {$_.name -ceq $name});if($entry.Count -ne 1){Deny 'PACKET_FILE_LIST_INVALID'};$path=Join-Path $PSScriptRoot $name;if(-not(Test-Path -LiteralPath $path -PathType Leaf)){Deny 'PACKET_FILE_MISSING'};CheckNoReparse $path;if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry[0].sha256){Deny 'PACKET_FILE_HASH_MISMATCH'}}
  if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'step3_authority2_signer_possession.mjs') -Algorithm SHA256).Hash.ToLowerInvariant() -cne '1200d429517bc2fe61b1efd60216b78e0ec99100f63793a88b51137d75c1cd4f'){Deny 'REVIEW_PINNED_HELPER_CHANGED'}
}
try{
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){Deny 'WINDOWS_REQUIRED'}
  if(-not $PublicSelfTest -and ($env:CI -or $env:GITHUB_ACTIONS -or $env:TF_BUILD -or -not [Environment]::UserInteractive -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected)){Deny 'OWNER_WINDOWS_CONSOLE_REQUIRED'}
  if($PublicSelfTest -and -not $env:CI -and -not $env:GITHUB_ACTIONS){Deny 'PUBLIC_FIXTURE_TEST_IS_CI_ONLY'}
  CheckPacket
  $node=Get-Command node.exe -ErrorAction Stop
  $version=& $node.Source --version
  if($LASTEXITCODE -ne 0 -or $version -notmatch '^v([0-9]+)\.' -or [int]$Matches[1] -lt 20){Deny 'NODE_20_PLUS_REQUIRED'}
  $helper=Join-Path $PSScriptRoot 'step3_authority2_signer_possession.mjs'
  & $node.Source $helper --public-check;if($LASTEXITCODE -ne 0){Deny 'PUBLIC_PACKET_INVALID'}
  if($PublicSelfTest){
    $temp=Join-Path $env:RUNNER_TEMP ('a2-public-acl-fixture-'+[Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temp)
    try{
      LockDirectory $temp
      $fixture=Join-Path $temp 'public-fixture.txt';[IO.File]::WriteAllText($fixture,'SYNTHETIC PUBLIC ACL FIXTURE ONLY');$fileAcl=Get-Acl -LiteralPath $fixture;$fileAcl.SetOwner($ownerSid);Set-Acl -LiteralPath $fixture -AclObject $fileAcl;CheckAcl $fixture $false
      $acl=Get-Acl -LiteralPath $fixture;$everyone=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$bad=[Security.AccessControl.FileSystemAccessRule]::new($everyone,[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($bad);Set-Acl -LiteralPath $fixture -AclObject $acl
      $denied=$false;try{CheckAcl $fixture $false}catch{if($_.Exception.Message -match 'OTHER_PRINCIPAL_CAN_ACCESS_KEY'){$denied=$true}else{throw}}
      if(-not $denied){Deny 'PUBLIC_ACL_NEGATIVE_TEST_FAILED'}
      Write-Output 'PUBLIC_PACKET_AND_SYNTHETIC_NTFS_CHECKS_PASS_NO_OWNER_KEY'
    }finally{Remove-Item -LiteralPath $temp -Recurse -Force}
    exit 0
  }
  Add-Type -AssemblyName System.Windows.Forms
  $dialog=New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title='Select the EXISTING Authority 2 encrypted Ed25519 private PEM on this PC'
  $dialog.Filter='Encrypted private PEM (*.pem)|*.pem';$dialog.CheckFileExists=$true
  if($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){Deny 'OWNER_CANCELLED'}
  $private=CheckLocal $dialog.FileName
  if($private.StartsWith([IO.Path]::GetFullPath($PSScriptRoot),[StringComparison]::OrdinalIgnoreCase)){Deny 'KEEP_PRIVATE_KEY_OUTSIDE_PUBLIC_PACKET'}
  CheckAcl (Split-Path -Parent $private) $true;CheckAcl $private $false
  $results=Join-Path $PSScriptRoot 'results'
  if(-not(Test-Path -LiteralPath $results)){[void][IO.Directory]::CreateDirectory($results)}
  CheckNoReparse $results
  $out=Join-Path $results ([Guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($out);LockDirectory $out
  [IO.File]::WriteAllText((Join-Path $out '.AXIOM_A2_OWNER_NTFS_OUTPUT'),"OWNER_LOCAL_NTFS_OUTPUT_ONLY`n",[Text.UTF8Encoding]::new($false))
  Write-Output 'Verifying the existing Authority 2 signer locally. No upload or deployment.'
  Write-Output 'Expected public fingerprint: 6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a'
  & $node.Source $helper --owner $private $out
  if($LASTEXITCODE -ne 0){Deny 'LOCAL_SIGNER_PROOF_NOT_CREATED'}
  CheckAcl $out $true
}catch{[Console]::Error.WriteLine('A2_SIGNER_CHECK_STOPPED:'+$_.Exception.Message);exit 2}
