#requires -Version 5.1
# Owner-local provider custody metadata. GET-only; no key creation or rotation.
[CmdletBinding()]
param([switch]$InspectOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ToolSourceCommit='@@SOURCE_COMMIT@@'
$ModuleSha='@@MODULE_SHA@@'
$ModuleBase64='@@MODULE_B64@@'
$ParserSha='@@PARSER_SHA@@'
$ParserBase64='@@PARSER_B64@@'
$ChallengeSha='@@CHALLENGE_SHA@@'
$ChallengeBase64='@@CHALLENGE_B64@@'
function StopReadback([string]$code){throw ('OWNER_CUSTODY_STOPPED:'+ $code)}
function HashBytes([byte[]]$bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function NoReparse([string]$path){
 $current=[IO.Path]::GetFullPath($path)
 while($current){
  if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){StopReadback 'REPARSE_PATH_REFUSED'}}
  $parent=[IO.Directory]::GetParent($current);if($null -eq $parent){break};$current=$parent.FullName
 }
}
function ProtectDirectory([string]$path){
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
 foreach($allowed in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($allowed,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)
 }
 Set-Acl -LiteralPath $path -AclObject $acl
}
function WriteNew([string]$path,[byte[]]$bytes){
 $s=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$s.Write($bytes,0,$bytes.Length)}finally{$s.Dispose()}
}
try{
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){StopReadback 'WINDOWS_REQUIRED'}
 $module=[Convert]::FromBase64String($ModuleBase64);$parser=[Convert]::FromBase64String($ParserBase64);$challenge=[Convert]::FromBase64String($ChallengeBase64)
 if($module.Length -gt 131072 -or $parser.Length -gt 32768 -or $challenge.Length -gt 16384){StopReadback 'PUBLIC_SOURCE_SIZE_LIMIT'}
 if((HashBytes $module) -cne $ModuleSha -or (HashBytes $parser) -cne $ParserSha -or (HashBytes $challenge) -cne $ChallengeSha){StopReadback 'PUBLIC_SOURCE_HASH_MISMATCH'}
 $node=@(Get-Command node -CommandType Application -ErrorAction SilentlyContinue);if($node.Count -lt 1){StopReadback 'NODE22_OR_NEWER_REQUIRED'};$node=$node[0]
 $local=[IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData));NoReparse $local
 if($local.StartsWith('\\') -or [IO.Path]::GetPathRoot($local) -notmatch '^[A-Za-z]:\\$'){StopReadback 'LOCAL_FIXED_NTFS_REQUIRED'}
 $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($local));if($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -cne 'NTFS'){StopReadback 'LOCAL_FIXED_NTFS_REQUIRED'}
 $work=Join-Path $local ('MUSITU_AXIOM_CUSTODY_'+[Guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($work);NoReparse $work;ProtectDirectory $work
 $return=Join-Path $work 'RETURN_ONLY';[void][IO.Directory]::CreateDirectory($return);ProtectDirectory $return
 $modulePath=Join-Path $work 'owner_custody_readback.mjs'
 WriteNew $modulePath $module;WriteNew (Join-Path $work 'owner_custody_json.mjs') $parser;WriteNew (Join-Path $work 'challenge.json') $challenge
 if($InspectOnly){
  & $node.Source $modulePath '--inspect'
  if($LASTEXITCODE -ne 0){StopReadback 'SOURCE_INSPECTION_FAILED'}
  [ordered]@{status='OWNER_CUSTODY_WINDOWS_INSPECTION_PASS_NOT_OWNER_EXECUTION';work_directory=$work;source_commit=$ToolSourceCommit;module_sha256=$ModuleSha;parser_sha256=$ParserSha;challenge_sha256=$ChallengeSha;provider_requests=0;gate3_closed=$false;release_status='NOT_RELEASE'}|ConvertTo-Json -Compress
  exit 0
 }
 if($env:GITHUB_ACTIONS -or $env:CI -or [Console]::IsInputRedirected){StopReadback 'OWNER_INTERACTIVE_PC_REQUIRED'}
 foreach($name in @('NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')){
  if([Environment]::GetEnvironmentVariable($name)){StopReadback 'RUNTIME_OR_NETWORK_OVERRIDE_REQUIRES_LOCAL_REVIEW'}
 }
 $fresh=([Text.UTF8Encoding]::new($false)).GetString($challenge)|ConvertFrom-Json
 $utc=[DateTimeOffset]::UtcNow
 if($utc -ge [DateTimeOffset]::Parse($fresh.expires_at_utc) -or $utc -lt ([DateTimeOffset]::Parse($fresh.issued_at_utc)).AddSeconds(-60)){StopReadback 'PUBLIC_METADATA_PACKET_EXPIRED_OR_CLOCK_INVALID'}
 $version=& $node.Source '--version';if($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22){StopReadback 'NODE22_OR_NEWER_REQUIRED'}
 $gh=@(Get-Command gh -CommandType Application -ErrorAction SilentlyContinue);$ghPath='NONE';if($gh.Count -gt 0){$ghPath=$gh[0].Source}
 Write-Host 'This collects Cloudflare and GitHub metadata. It creates no credential, changes no permission and performs no provider write.'
 Write-Host 'Use your existing OWNER-ONLY Cloudflare credential here. Keep it outside GitHub Actions and this chat.'
 Write-Host 'Your accepted Authority2 signer key/passphrase is not needed.'
 if($ghPath -ceq 'NONE'){Write-Host 'GitHub CLI was not found. Cloudflare metadata can be returned, but the GitHub inventory will remain incomplete.'}
 $mode=Read-Host 'Enter 1 for your current owner Global API Key, or 2 for an existing owner-only API token'
 if($mode -cne '1' -and $mode -cne '2'){StopReadback 'AUTHENTICATION_MODE_REQUIRED'}
 $email=$null;if($mode -ceq '1'){$email=Read-Host 'Cloudflare owner account email'}
 $secure=Read-Host 'Enter the owner credential in this hidden LOCAL prompt' -AsSecureString
 $bstr=[IntPtr]::Zero;$plain=$null;$payload=$null
 try{
  $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $inputRecord=[ordered]@{kind=$(if($mode -ceq '1'){'global_key'}else{'api_token'});secret=$plain};if($email){$inputRecord['email']=$email}
  $payload=$inputRecord|ConvertTo-Json -Compress
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$node.Source
  $start.Arguments='"'+$modulePath+'" "'+$work+'" "'+$ghPath+'" owner-local-v1'
  $start.UseShellExecute=$false;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.CreateNoWindow=$true
  $process=[Diagnostics.Process]::new();$process.StartInfo=$start
  if(-not $process.Start()){StopReadback 'LOCAL_PROCESS_START_FAILED'}
  $outputTask=$process.StandardOutput.ReadToEndAsync();$errorTask=$process.StandardError.ReadToEndAsync()
  $process.StandardInput.Write($payload);$process.StandardInput.Close()
 }finally{
  if($bstr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
  $plain=$null;$payload=$null;$inputRecord=$null;if($secure){$secure.Dispose()}
 }
 if(-not $process.WaitForExit(480000)){$process.Kill();StopReadback 'LOCAL_METADATA_COLLECTION_TIMEOUT'}
 $stdout=$outputTask.GetAwaiter().GetResult();$ignoredError=$errorTask.GetAwaiter().GetResult();$ignoredError=$null
 if(-not $stdout){StopReadback 'LOCAL_READBACK_UNAVAILABLE'}
 $result=$stdout|ConvertFrom-Json
 $public=Join-Path $return 'OWNER_CUSTODY_PROVIDER_READBACK.json';NoReparse $public
 if(-not (Test-Path -LiteralPath $public -PathType Leaf) -or $result.gate3_closed -ne $false){StopReadback 'PUBLIC_RECEIPT_SCOPE_INVALID'}
 Write-Host ('Saved provider readback: '+$result.status)
 Write-Host ('Return ONLY the JSON in: '+$return)
 Write-Host 'Keep PRIVATE_GITHUB_METADATA_NAMES_DO_NOT_UPLOAD.json on this PC for your own inventory review.'
 Write-Host 'Gate3 remains open until the returned provider evidence is reviewed. No OS/hardware custody attestation is claimed.'
 Invoke-Item -LiteralPath $return
 if(-not [Console]::IsInputRedirected){[void](Read-Host 'Press Enter to close')}
 exit $process.ExitCode
}catch{
 if($_.Exception.Message -cmatch '^OWNER_CUSTODY_STOPPED:[A-Z0-9_]+$'){[Console]::Error.WriteLine($_.Exception.Message)}else{[Console]::Error.WriteLine('OWNER_CUSTODY_READBACK_STOPPED_HOLD')}
 [Console]::Error.WriteLine('Keep every credential on the owner PC. No Gate3 completion is claimed.')
 if(-not $InspectOnly -and -not $env:CI -and -not $env:GITHUB_ACTIONS -and -not [Console]::IsInputRedirected){[void](Read-Host 'Press Enter to close')}
 exit 2
}
