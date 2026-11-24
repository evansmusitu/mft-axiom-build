#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$Packet)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
foreach($shell in @('powershell.exe','pwsh')){
 $output=& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Packet -InspectOnly
 if($LASTEXITCODE -ne 0){throw 'OWNER_CUSTODY_WINDOWS_INSPECTION_FAILED'}
 $parsed=@($output|ForEach-Object {try{$_|ConvertFrom-Json}catch{}})
 $receipt=@($parsed|Where-Object {$_.status -ceq 'OWNER_CUSTODY_WINDOWS_INSPECTION_PASS_NOT_OWNER_EXECUTION'})
 if($receipt.Count -ne 1 -or $receipt[0].provider_requests -ne 0 -or $receipt[0].gate3_closed -ne $false){throw 'OWNER_CUSTODY_INSPECTION_SCOPE_CHANGED'}
 $work=$receipt[0].work_directory;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $acl=Get-Acl -LiteralPath $work
 if(-not $acl.AreAccessRulesProtected){throw 'OWNER_DIRECTORY_NOT_PROTECTED'}
 foreach($rule in $acl.Access){
  $id=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if($rule.AccessControlType -eq 'Allow' -and $id -notin @($sid,'S-1-5-18')){throw 'UNEXPECTED_DIRECTORY_PRINCIPAL'}
 }
 if(Test-Path -LiteralPath (Join-Path $work 'RETURN_ONLY/OWNER_CUSTODY_PROVIDER_READBACK.json')){throw 'INSPECTION_CANNOT_CREATE_OWNER_PROVIDER_EVIDENCE'}
 # Invoke full mode in the actual hosted Windows context, with no credential.
 # The owner-only boundary must stop before any prompt or provider collection.
 # This records the actual attempt; it never simulates an owner or removes CI.
 if(-not $env:GITHUB_ACTIONS -and -not $env:CI){throw 'HOSTED_CONTEXT_REQUIRED_FOR_FULL_MODE_BOUNDARY_CHECK'}
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=(Get-Command $shell -CommandType Application).Source
 $info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Packet+'"'
 $info.UseShellExecute=$false;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.CreateNoWindow=$true
 $child=[Diagnostics.Process]::new();$child.StartInfo=$info
 try{
  if(-not $child.Start()){throw 'FULL_MODE_PROCESS_START_FAILED'}
  $outTask=$child.StandardOutput.ReadToEndAsync();$errTask=$child.StandardError.ReadToEndAsync();$child.StandardInput.Close()
  if(-not $child.WaitForExit(60000)){$child.Kill();throw 'FULL_MODE_BOUNDARY_TIMEOUT'}
  $fullOut=$outTask.GetAwaiter().GetResult();$fullErr=$errTask.GetAwaiter().GetResult()
  if($child.ExitCode -ne 2 -or $fullOut -or $fullErr -cnotmatch '(?m)^OWNER_CUSTODY_STOPPED:OWNER_INTERACTIVE_PC_REQUIRED\r?$'){throw 'FULL_MODE_MUST_STOP_BEFORE_OWNER_CREDENTIAL_INPUT'}
  [ordered]@{status='HOSTED_WINDOWS_FULL_MODE_BLOCKED_OWNER_CONTEXT_REQUIRED';shell=$shell;exit_code=$child.ExitCode;owner_credential_supplied=$false;provider_collection_started=$false;owner_receipt_produced=$false;gate3_closed=$false;release_status='NOT_RELEASE'}|ConvertTo-Json -Compress
 }finally{$child.Dispose()}
}
Write-Output 'NATIVE_OWNER_CUSTODY_INSPECTION_PS51_PS7_PASS_NO_OWNER_EXECUTION'
Write-Output 'NATIVE_FULL_MODE_PS51_PS7_BLOCKED_BEFORE_OWNER_CREDENTIAL_INPUT'
