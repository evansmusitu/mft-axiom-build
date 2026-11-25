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
function FindGithubCli {
 $found=@(Get-Command gh -CommandType Application -ErrorAction SilentlyContinue)
 foreach($entry in $found){if([IO.Path]::GetExtension($entry.Source) -ieq '.exe'){return $entry.Source}}
 $candidates=@()
 foreach($base in @([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86))){
  if($base){$candidates+=Join-Path $base 'GitHub CLI\gh.exe'}
 }
 $userBase=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
 if($userBase){$candidates+=Join-Path $userBase 'Programs\GitHub CLI\gh.exe'}
 foreach($candidate in $candidates){if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}}
 return $null
}
function GithubSignedIn([string]$path){
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$path;$info.Arguments='auth status --hostname github.com'
 $info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.CreateNoWindow=$true
 $check=[Diagnostics.Process]::new();$check.StartInfo=$info
 try{
  if(-not $check.Start()){return $false}
  $outTask=$check.StandardOutput.ReadToEndAsync();$errTask=$check.StandardError.ReadToEndAsync()
  if(-not $check.WaitForExit(30000)){$check.Kill();return $false}
  [void]$outTask.GetAwaiter().GetResult();[void]$errTask.GetAwaiter().GetResult()
  return ($check.ExitCode -eq 0)
 }catch{return $false}finally{$check.Dispose()}
}
function EnsureGithubCli {
 $path=FindGithubCli
 if(-not $path){
  Write-Host 'GitHub CLI is missing. This file can install the official free GitHub CLI using Windows Package Manager.'
  $choice=Read-Host 'Press Enter to install GitHub CLI, or type X to stop'
  if($choice){StopReadback 'GITHUB_CLI_SETUP_CANCELLED'}
  $winget=@(Get-Command winget -CommandType Application -ErrorAction SilentlyContinue)
  if($winget.Count -gt 0){
   & $winget[0].Source install --id GitHub.cli --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
   $path=FindGithubCli
  }
  if(-not $path){
   Write-Host 'Opening the official GitHub CLI download page. Complete its Windows installer, then return here.'
   Start-Process 'https://cli.github.com/'
   [void](Read-Host 'Press Enter after the official Windows installer finishes')
   $path=FindGithubCli
  }
  if(-not $path){StopReadback 'GITHUB_CLI_INSTALLATION_REQUIRED'}
 }
 # This happens before the Cloudflare credential prompt. The two credentials
 # are never combined in a process argument, environment value or uploaded file.
 if(-not (GithubSignedIn $path)){
  Write-Host 'Sign in through GitHub CLI using your own browser. Review GitHub authorization there; no Cloudflare key is needed.'
  $savedPreference=$ErrorActionPreference
  try{$ErrorActionPreference='Continue';& $path auth login --hostname github.com --git-protocol https --web --skip-ssh-key 2>&1 | Out-Host;$loginExit=$LASTEXITCODE}
  finally{$ErrorActionPreference=$savedPreference}
  if($loginExit -ne 0){StopReadback 'GITHUB_OWNER_SIGN_IN_REQUIRED'}
  if(-not (GithubSignedIn $path)){StopReadback 'GITHUB_OWNER_SIGN_IN_UNAVAILABLE'}
 }
 return $path
}
function ReadAuthenticationMode {
 for($attempt=0;$attempt -lt 3;$attempt++){
  Write-Host 'Choose 1 for your current owner Global API Key, or 2 for an existing owner-only API token. Enter one digit only; typing is hidden.'
  $selection=Read-Host 'Authentication choice (1 or 2; do not paste a key here)' -AsSecureString
  $selectionPointer=[IntPtr]::Zero;$choice=$null
  try{$selectionPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($selection);$choice=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($selectionPointer)}
  finally{if($selectionPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($selectionPointer)};$selection.Dispose()}
  if($choice -ceq '1' -or $choice -ceq '2'){return $choice}
  $choice=$null;Write-Host 'Choose only 1 or 2. The credential is entered later in its own hidden prompt.'
 }
 StopReadback 'AUTHENTICATION_MODE_REQUIRED'
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
 $ghPath=EnsureGithubCli
 Write-Host 'This collects Cloudflare and GitHub metadata. It creates no Cloudflare credential, changes no Cloudflare permission and performs no provider write.'
 Write-Host 'Use your existing OWNER-ONLY Cloudflare credential here. Keep it outside GitHub Actions and this chat.'
 Write-Host 'Your accepted Authority2 signer key/passphrase is not needed.'
 $mode=ReadAuthenticationMode
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
