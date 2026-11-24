# Public-only Windows tests. No owner key, operator credential or provider action.
param([Parameter(Mandatory=$true)][string]$Launcher)
$ErrorActionPreference='Stop'
if(-not $env:GITHUB_ACTIONS){throw 'SYNTHETIC_WINDOWS_CI_ONLY'}
Write-Output ('NODE_EXECUTABLE_CANDIDATES:'+@(Get-Command node.exe -CommandType Application).Count)
$syntaxErrors=$null;$tokens=$null
[void][Management.Automation.Language.Parser]::ParseFile($Launcher,[ref]$tokens,[ref]$syntaxErrors)
if(@($syntaxErrors).Count -ne 0){throw ('PowerShell syntax failed: '+($syntaxErrors|Out-String))}
foreach($exe in @('powershell.exe','pwsh')){
 $lines=@(& $exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Launcher -InspectOnly)
 if($LASTEXITCODE -ne 0){throw ('Public single-file check failed: '+$exe)}
 $r=$lines[-1]|ConvertFrom-Json
 if($r.status -cne 'SINGLE_FILE_PUBLIC_INSPECTION_PASS_NOT_OWNER_PROOF' -or $r.private_key_accessed -ne $false -or $r.owner_proof_observed -ne $false -or $r.gate3_closed -ne $false -or $r.release_status -cne 'NOT_RELEASE'){throw 'Inspection tried to qualify owner/hosted evidence'}
 Write-Output ('NATIVE_SINGLE_FILE_PUBLIC_INSPECTION_PASS:'+ $exe)
 & $exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $r.packet_directory 'Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1') -PublicSelfTest
 if($LASTEXITCODE -ne 0){throw ('Unchanged reviewed wrapper public checks failed: '+$exe)}
 Write-Output ('NATIVE_REVIEWED_WRAPPER_PUBLIC_PASS:'+ $exe)
}
$log=Join-Path $env:RUNNER_TEMP 'single-file-owner-guard.log'
$prior=$ErrorActionPreference
try{$ErrorActionPreference='Continue';& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Launcher 2> $log | Out-Null;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$prior}
if($code -ne 2 -or (Get-Content -LiteralPath $log -Raw) -notmatch 'OWNER_WINDOWS_CONSOLE_REQUIRED'){throw 'Owner CI/console guard failed'}
Write-Output 'NATIVE_SINGLE_FILE_OWNER_CI_DENIAL_PASS_NO_OWNER_KEY'
$bad=Join-Path $env:RUNNER_TEMP 'single-file-corrupt-packet.ps1'
$body=[IO.File]::ReadAllText($Launcher)
$pattern=[regex]'(\$PacketBase64='')([A-Za-z0-9+/=])'
if($pattern.Matches($body).Count -ne 1){throw 'Single embedded packet marker required'}
$changed=$pattern.Replace($body,[Text.RegularExpressions.MatchEvaluator]{param($m)$replacement='A';if($m.Groups[2].Value -ceq 'A'){$replacement='B'};return $m.Groups[1].Value+$replacement})
[IO.File]::WriteAllText($bad,$changed,[Text.UTF8Encoding]::new($true))
$prior=$ErrorActionPreference
try{$ErrorActionPreference='Continue';& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $bad -InspectOnly 2> $log | Out-Null;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$prior}
if($code -ne 2 -or (Get-Content -LiteralPath $log -Raw) -notmatch 'EMBEDDED_PACKET_HASH_MISMATCH'){throw 'Embedded ZIP tamper was not denied before extraction'}
Write-Output 'NATIVE_SINGLE_FILE_CORRUPT_PAYLOAD_DENIAL_PASS'
exit 0
