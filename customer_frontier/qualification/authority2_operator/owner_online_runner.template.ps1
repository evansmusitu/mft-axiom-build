#requires -Version 5.1
[CmdletBinding()]
param([switch]$InspectOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$SourceCommit='@@SOURCE_COMMIT@@'
$PayloadSha='@@PAYLOAD_SHA@@'
$PayloadGzipBase64='@@PAYLOAD_GZIP_B64@@'
function StopOperator([string]$code){throw ('A2_OWNER_OPERATOR_STOPPED:'+ $code)}
function HashBytes([byte[]]$bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Hidden([string]$prompt){$s=Read-Host ($prompt+' (hidden)') -AsSecureString;$b=[IntPtr]::Zero;try{$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}finally{if($b -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)};$s.Dispose()}}
function Choice([string]$prompt,[string[]]$allowed){for($n=0;$n -lt 3;$n++){$x=Hidden $prompt;if($x -cin $allowed){return $x};Write-Host 'Use one of the displayed choices only. Never paste a credential at a choice prompt.'};StopOperator 'CHOICE_INVALID'}
function NoReparse([string]$path){$p=[IO.Path]::GetFullPath($path);while($p){if(Test-Path -LiteralPath $p){if((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){StopOperator 'REPARSE_PATH_REFUSED'}};$q=[IO.Directory]::GetParent($p);if($null -eq $q){break};$p=$q.FullName}}
function Protect([string]$path){$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($s in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};Set-Acl -LiteralPath $path -AclObject $acl}
function WriteNew([string]$path,[byte[]]$data){$s=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$s.Write($data,0,$data.Length)}finally{$s.Dispose()}}
try{
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){StopOperator 'WINDOWS_REQUIRED'}
 if($SourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $PayloadSha -cnotmatch '^[a-f0-9]{64}$'){StopOperator 'SOURCE_PIN_INVALID'}
 if(-not $InspectOnly -and ($env:CI -or $env:GITHUB_ACTIONS -or $env:TF_BUILD -or $env:AXIOM_BUILDER_RUNTIME -or [Console]::IsInputRedirected)){StopOperator 'OWNER_INTERACTIVE_WINDOWS_REQUIRED'}
 foreach($name in @('NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')){if([Environment]::GetEnvironmentVariable($name)){StopOperator 'RUNTIME_OVERRIDE_REQUIRES_LOCAL_REVIEW'}}
 $packed=[Convert]::FromBase64String($PayloadGzipBase64);if($packed.Length -gt 524288){StopOperator 'PACKAGE_SIZE_LIMIT'}
 $inputStream=[IO.MemoryStream]::new($packed);$gzip=[IO.Compression.GzipStream]::new($inputStream,[IO.Compression.CompressionMode]::Decompress);$output=[IO.MemoryStream]::new();$buffer=New-Object byte[] 8192
 try{while(($count=$gzip.Read($buffer,0,$buffer.Length)) -gt 0){if($output.Length+$count -gt 1048576){StopOperator 'PACKAGE_EXPANSION_LIMIT'};$output.Write($buffer,0,$count)};$raw=$output.ToArray()}finally{$gzip.Dispose();$inputStream.Dispose();$output.Dispose()}
 if((HashBytes $raw) -cne $PayloadSha){StopOperator 'EMBEDDED_SOURCE_HASH_MISMATCH'}
 $payload=([Text.UTF8Encoding]::new($false,$true)).GetString($raw)|ConvertFrom-Json
 if($payload.source_commit -cne $SourceCommit -or $payload.approved_source_commit -cne '68799a41a367865649b833de649edcb26f77c0d3'){StopOperator 'APPROVED_SOURCE_CONTEXT_INVALID'}
 $local=[IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData));NoReparse $local
 if($local.StartsWith('\\') -or [IO.Path]::GetPathRoot($local) -notmatch '^[A-Za-z]:\\$'){StopOperator 'LOCAL_FIXED_NTFS_REQUIRED'}
 $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($local));if($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -cne 'NTFS'){StopOperator 'LOCAL_FIXED_NTFS_REQUIRED'}
 $work=Join-Path $local ('MUSITU_AXIOM_A2_OPERATOR_'+[Guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($work);NoReparse $work;Protect $work
 $return=Join-Path $work 'RETURN_ONLY';[void][IO.Directory]::CreateDirectory($return);Protect $return
 $utf8=[Text.UTF8Encoding]::new($false)
 foreach($entry in $payload.files.PSObject.Properties){if($entry.Name -cnotmatch '^[a-z0-9_-]+\.mjs$' -or $entry.Value -isnot [string]){StopOperator 'PACKAGE_FILE_SCOPE_INVALID'};WriteNew (Join-Path $work $entry.Name) ($utf8.GetBytes($entry.Value))}
 WriteNew (Join-Path $work 'payload.json') $raw;WriteNew (Join-Path $work '.AXIOM_OWNER_OPERATOR_V1') ($utf8.GetBytes("OWNER_LOCAL_PROTECTED_NTFS_V1`n"))
 $node=@(Get-Command node -CommandType Application -ErrorAction SilentlyContinue);if($node.Count -lt 1){StopOperator 'EXISTING_NODE22_OR_NEWER_REQUIRED'};$node=$node[0].Source
 if($InspectOnly){& $node (Join-Path $work 'operator_cli.mjs') --inspect;if($LASTEXITCODE -ne 0){StopOperator 'NODE_PUBLIC_INSPECTION_FAILED'};[ordered]@{status='OWNER_ONLINE_OPERATOR_PUBLIC_PACKET_INSPECTION_PASS';source_commit=$SourceCommit;payload_sha256=$PayloadSha;private_input_read=$false;provider_requests=0;work_directory=$work;gate3_closed=$false;release_status='NOT_RELEASE'}|ConvertTo-Json -Compress;exit 0}
 $v=& $node --version;if($LASTEXITCODE -ne 0 -or $v -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22){StopOperator 'EXISTING_NODE22_OR_NEWER_REQUIRED'}
 $gh=@(Get-Command gh -CommandType Application -ErrorAction SilentlyContinue)
 if($gh.Count -lt 1){$candidate=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)) 'GitHub CLI\gh.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$gh=@([pscustomobject]@{Source=$candidate})}}
 if($gh.Count -lt 1){StopOperator 'EXISTING_OWNER_GITHUB_CLI_REQUIRED'};$ghPath=$gh[0].Source
 Write-Host 'MUSITU AXIOM - private disposable Authority2 operator run. INTERNET REQUIRED.'
 Write-Host 'This is NEW execution and hosted fault/recovery automation. The original approved initializer and serving bytes are unchanged.'
 Write-Host 'It may take60-90 minutes because private cron changes need time to propagate. Keep this PC awake and online.'
 Write-Host 'It creates private qualification checkpoints and a temporary private Worker, tests only the approved disposable namespace, rotates test roles, removes cron/control settings and restores the exact serving source.'
 Write-Host 'It does not merge or publish Axiom, change Paynow, alter customer databases, delete original checkpoints/buckets, create a new signer, or activate public routes. Gate3 is not automatically certified.'
 Write-Host ('New automation source: '+$SourceCommit);Write-Host ('Package SHA256: '+$PayloadSha)
 $reviewUrl='https://github.com/evansmusitu/mft-axiom-build/tree/'+$SourceCommit+'/customer_frontier/qualification/authority2_operator'
 $choice=Choice '1=Approve this NEW pinned automation after review; 2=Open source review page; X=Stop' @('1','2','X')
 if($choice -ceq '2'){Start-Process $reviewUrl;$choice=Choice 'After reviewing the pinned source: 1=Approve new automation, X=Stop' @('1','X')}
 if($choice -cne '1'){StopOperator 'NEW_AUTOMATION_REVIEW_NOT_APPROVED'}
 $operation=Choice '1=New approved disposable ceremony, 2=Retire a previous owned attempt only' @('1','2');$journalPath=$null
 Add-Type -AssemblyName System.Windows.Forms
 if($operation -ceq '2'){$pick=New-Object Windows.Forms.OpenFileDialog;$pick.Title='Choose the prior owner-signed OPERATOR_PROVIDER_REQUEST_JOURNAL.json';$pick.Filter='Owner request journal|OPERATOR_PROVIDER_REQUEST_JOURNAL.json';if($pick.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){StopOperator 'JOURNAL_SELECTION_CANCELLED'};$journalPath=$pick.FileName;$pick.Dispose();NoReparse $journalPath}
 Write-Host 'Use your existing OWNER-ONLY Cloudflare administration credential. No credential is sent to GitHub or this chat.'
 $mode=Choice '1=Existing owner Global API Key, 2=Existing owner-only API token' @('1','2');$email=$null;if($mode -ceq '1'){$email=Hidden 'Existing Cloudflare owner email'}
 $cf=Hidden 'Existing owner Cloudflare credential';$read=$null;if($operation -ceq '1'){$read=Hidden 'Existing READ-ONLY GitHub token for the private checkpoint repository (not your GitHub CLI write credential)'}
 $dialog=New-Object Windows.Forms.OpenFileDialog;$dialog.Title='Choose the EXISTING encrypted Authority2 Ed25519 private key - it stays on this PC';$dialog.Filter='Encrypted private key (*.pem;*.key)|*.pem;*.key|All files (*.*)|*.*'
 if($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){StopOperator 'EXISTING_SIGNER_SELECTION_CANCELLED'};$privatePath=$dialog.FileName;$dialog.Dispose();NoReparse $privatePath
 $passphrase=Hidden 'Existing encrypted Authority2 key passphrase'
 $cred=[ordered]@{kind=$(if($mode -ceq '1'){'global_key'}else{'api_token'});secret=$cf};if($email){$cred['email']=$email}
 $record=[ordered]@{source_approval_sha256=$PayloadSha;credential=$cred;github_read_token=$read;private_key_path=$privatePath;passphrase=$passphrase;cleanup_journal_path=$journalPath}
 $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$node;$start.Arguments='"'+(Join-Path $work 'operator_cli.mjs')+'" "'+$work+'" "'+$ghPath+'"';$start.UseShellExecute=$false;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.CreateNoWindow=$true
 $process=[Diagnostics.Process]::new();$process.StartInfo=$start;if(-not $process.Start()){StopOperator 'OWNER_PROCESS_START_FAILED'};$errorTask=$process.StandardError.ReadToEndAsync()
 try{$process.StandardInput.WriteLine(($record|ConvertTo-Json -Depth 6 -Compress));$process.StandardInput.Flush()}finally{$cf=$null;$read=$null;$passphrase=$null;$email=$null;$cred=$null;$record=$null;$privatePath=$null}
 $watch=[Diagnostics.Stopwatch]::StartNew();$lineTask=$process.StandardOutput.ReadLineAsync();$complete=$false
 while($watch.Elapsed.TotalMinutes -lt 150){
  if(-not $lineTask.Wait(1000)){if($process.HasExited){break};continue}
  $line=$lineTask.GetAwaiter().GetResult();if($null -eq $line){break};if($line.Length -gt 131072){StopOperator 'OWNER_PROTOCOL_OUTPUT_LIMIT'};$message=$line|ConvertFrom-Json
  if($message.type -ceq 'PROGRESS'){Write-Host $message.message}
  elseif($message.type -ceq 'APPROVAL'){
   Write-Host ('Operator decision: '+$message.kind);Write-Host ($message.details|ConvertTo-Json -Depth 20);Write-Host ('Exact decision SHA256: '+$message.digest)
   $answer=Choice '1=Approve these exact observed results / fresh plan, X=Stop' @('1','X');$approved=$null;if($answer -ceq '1'){$approved=$message.digest}
   $process.StandardInput.WriteLine((@{approved_sha256=$approved}|ConvertTo-Json -Compress));$process.StandardInput.Flush()
  }
  elseif($message.type -ceq 'ERROR'){Write-Host ('Stopped: '+$message.code)}
  elseif($message.type -ceq 'COMPLETE'){Write-Host ('Operator result: '+$message.status);$complete=$true}
  else{StopOperator 'OWNER_PROTOCOL_INVALID'}
  $lineTask=$process.StandardOutput.ReadLineAsync()
 }
 if(-not $process.WaitForExit(30000)){StopOperator 'OWNER_PROCESS_STILL_RUNNING_REQUIRES_REVIEW'}
 [void]$errorTask.GetAwaiter().GetResult();$resultCode=$process.ExitCode
 Write-Host 'Return ONLY the JSON files in the folder opening now. Private input was not stored in those files.'
 Write-Host 'No Gate3 closure or product release is automatic. Preserve every receipt, including HOLD outcomes; do not rerun an uncertain initialization.'
 Invoke-Item -LiteralPath $return;[void](Read-Host 'Press Enter to close');exit $resultCode
}catch{
 if($_.Exception.Message -cmatch '^A2_OWNER_OPERATOR_STOPPED:[A-Z0-9_]+$'){[Console]::Error.WriteLine($_.Exception.Message)}else{[Console]::Error.WriteLine('A2_OWNER_OPERATOR_STOPPED_HOLD')}
 [Console]::Error.WriteLine('No completion is claimed. If private operations started, keep this window and every receipt; do not retry initialization or delete retained state.')
 if(-not $InspectOnly -and -not $env:CI -and -not $env:GITHUB_ACTIONS -and -not [Console]::IsInputRedirected){[void](Read-Host 'Press Enter to close')};exit 2
}
