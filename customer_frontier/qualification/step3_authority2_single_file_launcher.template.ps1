#requires -Version 5.1
# MUSITU Axiom Authority2 signer launcher. Public packet only; NOT_RELEASE.
# Existing key selection and hidden passphrase are handled locally by the
# unchanged reviewed helper. No account/provider/network operations occur.
[CmdletBinding()]
param([switch]$InspectOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PacketSha256='@@PACKET_SHA256@@'
$ToolSourceCommit='@@SOURCE_COMMIT@@'
$PacketBase64='@@PACKET_BASE64@@'
$OwnerSid=$null
function Deny([string]$code){throw ('A2_SINGLE_FILE_STOPPED:'+ $code)}
function HashBytes([byte[]]$bytes){
  $hash=[Security.Cryptography.SHA256]::Create()
  try{return [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
}
function NoReparse([string]$path){
  $p=[IO.Path]::GetFullPath($path)
  while($p){$item=Get-Item -LiteralPath $p -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){Deny 'REPARSE_PATH_REFUSED'};$next=Split-Path -Parent $p;if($next -eq $p){break};$p=$next}
}
function FixedLocalDirectory([string]$path){
  if($path -notmatch '^[A-Za-z]:[\\/]'){Deny 'FIXED_LOCAL_NTFS_REQUIRED'}
  $p=[IO.Path]::GetFullPath($path)
  if($p -match '(?i)(^|[\\/])(OneDrive[^\\/]*|Dropbox|Google Drive|iCloudDrive)([\\/]|$)'){Deny 'CLOUD_SYNC_OUTPUT_REFUSED'}
  $drive=[IO.DriveInfo]::new($p.Substring(0,3))
  if(-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS'){Deny 'FIXED_LOCAL_NTFS_REQUIRED'}
  NoReparse $p
  return $p
}
function ProtectNewDirectory([string]$path){
  $acl=Get-Acl -LiteralPath $path;$acl.SetAccessRuleProtection($true,$false)
  foreach($rule in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($rule)}
  $flags=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($OwnerSid,[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  $acl.SetOwner($OwnerSid);$acl.SetAccessRule($rule);Set-Acl -LiteralPath $path -AclObject $acl
  $saved=Get-Acl -LiteralPath $path
  if(-not $saved.AreAccessRulesProtected -or $saved.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $OwnerSid.Value){Deny 'OWNER_ONLY_OUTPUT_REQUIRED'}
  $allow=$false
  foreach($ace in $saved.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($ace.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow){if($ace.IdentityReference.Value -ne $OwnerSid.Value){Deny 'OWNER_ONLY_OUTPUT_REQUIRED'};$allow=$true}
  }
  if(-not $allow){Deny 'OWNER_ONLY_OUTPUT_REQUIRED'}
}
function WriteNew([string]$path,[byte[]]$bytes){
  $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
}
try{
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){Deny 'WINDOWS_REQUIRED'}
  if(-not $InspectOnly -and ($env:CI -or $env:GITHUB_ACTIONS -or $env:TF_BUILD -or -not [Environment]::UserInteractive -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected)){Deny 'OWNER_WINDOWS_CONSOLE_REQUIRED'}
  $node=@(Get-Command node.exe -CommandType Application -ErrorAction Stop)[0]
  $version=& $node.Source --version
  if($LASTEXITCODE -ne 0 -or $version -notmatch '^v([0-9]+)\.' -or [int]$Matches[1] -lt 20){Deny 'EXISTING_NODE_20_PLUS_REQUIRED'}
  $bytes=[Convert]::FromBase64String($PacketBase64)
  if($bytes.Length -gt 131072 -or (HashBytes $bytes) -cne $PacketSha256){Deny 'EMBEDDED_PACKET_HASH_MISMATCH'}
  $OwnerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $local=FixedLocalDirectory ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData))
  $work=Join-Path $local ('MUSITU_AXIOM_A2_'+[Guid]::NewGuid().ToString('N'))
  if(Test-Path -LiteralPath $work){Deny 'NEW_OUTPUT_DIRECTORY_REQUIRED'}
  [void][IO.Directory]::CreateDirectory($work);NoReparse $work;ProtectNewDirectory $work
  $packet=Join-Path $work 'packet';[void][IO.Directory]::CreateDirectory($packet)
  $archive=Join-Path $work 'verified_public_packet.zip';WriteNew $archive $bytes
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $expected=@('Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1','step3_authority2_signer_possession.mjs','challenge.json','owner_ed25519_spki.der','README.txt','PACKET_MANIFEST.json')
  $zip=[IO.Compression.ZipFile]::OpenRead($archive)
  try{
    if($zip.Entries.Count -ne $expected.Count){Deny 'PACKET_INVENTORY_CHANGED'}
    $seen=@();$total=0
    foreach($entry in $zip.Entries){
      $name=$entry.FullName
      if($expected -cnotcontains $name -or $seen -ccontains $name -or $entry.Length -gt 65536){Deny 'PACKET_INVENTORY_CHANGED'}
      $seen+=$name;$total+=$entry.Length;if($total -gt 131072){Deny 'PACKET_SIZE_LIMIT'}
      $entryInput=$entry.Open();$entryOutput=[IO.File]::Open((Join-Path $packet $name),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try{$entryInput.CopyTo($entryOutput)}finally{$entryInput.Dispose();$entryOutput.Dispose()}
    }
  }finally{$zip.Dispose()}
  $manifest=Get-Content -LiteralPath (Join-Path $packet 'PACKET_MANIFEST.json') -Raw | ConvertFrom-Json
  if($manifest.schema -cne 'musitu.axiom.authority2.possession-packet.v1' -or $manifest.network_operations -ne 0 -or $manifest.deployment_performed -ne $false -or $manifest.private_key_material_included -ne $false -or $manifest.gate3_closed -ne $false -or $manifest.release_status -cne 'NOT_RELEASE' -or $manifest.approved_authority_source_commit -cne '68799a41a367865649b833de649edcb26f77c0d3'){Deny 'PACKET_SCOPE_CHANGED'}
  if(@($manifest.files).Count -ne 5){Deny 'PACKET_MANIFEST_CHANGED'}
  foreach($name in $expected | Where-Object {$_ -cne 'PACKET_MANIFEST.json'}){
    $entry=@($manifest.files | Where-Object {$_.name -ceq $name})
    if($entry.Count -ne 1){Deny 'PACKET_MANIFEST_CHANGED'}
    $file=Join-Path $packet $name
    if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry[0].sha256 -or (Get-Item -LiteralPath $file).Length -ne $entry[0].bytes){Deny 'PACKET_MEMBER_HASH_MISMATCH'}
  }
  $verify=Join-Path $work 'Verify_Public_Proof.mjs'
  $verificationSource=@'
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.argv[2],mode=process.argv[3];
try {
 const m=await import(pathToFileURL(join(root,'step3_authority2_signer_possession.mjs')).href);
 const {challenge,der}=m.readPublicPacket(root);
 if(mode==='fresh'){
  m.validateChallenge(challenge,{expectedPin:m.EXPECTED_PIN,nowMs:Date.now(),fresh:true});
  console.log(JSON.stringify({status:'CHALLENGE_FRESH',expires_at_utc:challenge.expires_at_utc,gate3_closed:false}));
 }else if(mode==='inspect'){
  m.validateChallenge(challenge,{expectedPin:m.EXPECTED_PIN,fresh:false});
  console.log(JSON.stringify({status:'SINGLE_FILE_PUBLIC_INSPECTION_PASS_NOT_OWNER_PROOF',packet_directory:root,challenge_id:challenge.challenge_id,
   expires_at_utc:challenge.expires_at_utc,private_key_accessed:false,owner_proof_observed:false,gate3_closed:false,release_status:'NOT_RELEASE'}));
 }else if(mode==='verify'){
  const raw=readFileSync(process.argv[4]);if(raw.length>16384)throw Error('PUBLIC_PROOF_TOO_LARGE');
  const result=m.verifyPossessionProof(JSON.parse(raw.toString('utf8')),{challenge,expectedDer:der,nowMs:Date.now()});
  if(result.matching_private_key_possession_verified!==true||result.hosted_custody_qualified!==false||result.gate3_closed!==false)throw Error('UNEXPECTED_PROOF_SCOPE');
  console.log(JSON.stringify({...result,proof_sha256:createHash('sha256').update(raw).digest('hex')}));
 }else throw Error('UNKNOWN_PUBLIC_VERIFICATION_MODE');
}catch(e){console.error('A2_PUBLIC_VERIFICATION_STOPPED:'+(e?.code||'PUBLIC_PACKET_OR_PROOF_INVALID'));process.exitCode=2;}
'@
  WriteNew $verify ([Text.UTF8Encoding]::new($false).GetBytes($verificationSource))
  if($InspectOnly){
    & $node.Source $verify $packet 'inspect'
    if($LASTEXITCODE -ne 0){Deny 'PUBLIC_PACKET_CHECK_FAILED'}
    exit 0
  }
  & $node.Source $verify $packet 'fresh'
  if($LASTEXITCODE -ne 0){Deny 'CHALLENGE_EXPIRED_OR_INVALID_GET_FRESH_PACKET'}
  Write-Host 'Public packet verified. Select your EXISTING Authority2 Ed25519 encrypted PEM in the next window.'
  Write-Host 'Enter its passphrase only in the local hidden prompt. Keep the private file outside this packet.'
  # Inherit the real console. Never capture or redirect private-helper input/output.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $packet 'Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1')
  if($LASTEXITCODE -ne 0){Deny 'OWNER_HELPER_DID_NOT_COMPLETE'}
  $results=Join-Path $packet 'results';NoReparse $results
  $proofs=@(Get-ChildItem -LiteralPath $results -Filter 'OWNER_A2_SIGNER_POSSESSION_PROOF.json' -File -Recurse)
  if($proofs.Count -ne 1 -or $proofs[0].Length -gt 16384){Deny 'EXACTLY_ONE_PUBLIC_PROOF_REQUIRED'}
  $proofPath=$proofs[0].FullName;NoReparse $proofPath
  $checked=& $node.Source $verify $packet 'verify' $proofPath
  if($LASTEXITCODE -ne 0){Deny 'RETURNED_SIGNATURE_INVALID'}
  $receipt=$checked | ConvertFrom-Json
  if($receipt.matching_private_key_possession_verified -ne $true -or $receipt.gate3_closed -ne $false){Deny 'RETURNED_SIGNATURE_SCOPE_INVALID'}
  $return=Join-Path $work 'RETURN_ONLY';[void][IO.Directory]::CreateDirectory($return);ProtectNewDirectory $return
  $public=Join-Path $return 'OWNER_A2_SIGNER_POSSESSION_PROOF.json'
  WriteNew $public ([IO.File]::ReadAllBytes($proofPath))
  if((Get-FileHash -LiteralPath $public -Algorithm SHA256).Hash.ToLowerInvariant() -cne $receipt.proof_sha256){Deny 'PUBLIC_PROOF_COPY_MISMATCH'}
  WriteNew (Join-Path $work 'LOCAL_POSSESSION_RECEIPT_NOT_GATE3_CLOSED.json') ([Text.UTF8Encoding]::new($false).GetBytes(($receipt | ConvertTo-Json -Depth 20)))
  Write-Host ''
  Write-Host 'PASS: existing Authority2 signer possession proof created and verified locally.'
  Write-Host ('Upload ONLY the public JSON in: '+$return)
  Write-Host 'Gate3 remains OPEN: provider custody/separation, private genesis/retirement and hosted destructive recovery still require actual evidence.'
  Invoke-Item -LiteralPath $return
  if(-not [Console]::IsInputRedirected){[void](Read-Host 'Press Enter to close')}
  exit 0
}catch{
  [Console]::Error.WriteLine('A2_SINGLE_FILE_STOPPED:'+$_.Exception.Message)
  [Console]::Error.WriteLine('No Gate3 closure or hosted operation is claimed. Keep all private keys and passphrases on the owner PC.')
  if(-not $InspectOnly -and -not $env:CI -and -not $env:GITHUB_ACTIONS -and -not [Console]::IsInputRedirected){[void](Read-Host 'Press Enter to close')}
  exit 2
}
