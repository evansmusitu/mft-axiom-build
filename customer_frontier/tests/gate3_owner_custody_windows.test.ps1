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
}
Write-Output 'NATIVE_OWNER_CUSTODY_INSPECTION_PS51_PS7_PASS_NO_OWNER_EXECUTION'
