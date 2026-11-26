#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Packet)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function AssertOperator($condition,[string]$code){if(-not $condition){throw ('OPERATOR_NATIVE_TEST_FAILED:'+ $code)}}
$source=Get-Content -LiteralPath $Packet -Raw -Encoding UTF8
$errors=$null;$tokens=$null;[void][Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
AssertOperator ($errors.Count -eq 0) 'PARSE'
$hostExe=(Get-Process -Id $PID).Path
function RunPacket([string]$file,[bool]$inspect){
 $s=[Diagnostics.ProcessStartInfo]::new();$s.FileName=$hostExe;$s.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$file+'"'+$(if($inspect){' -InspectOnly'}else{''});$s.UseShellExecute=$false;$s.RedirectStandardInput=$true;$s.RedirectStandardOutput=$true;$s.RedirectStandardError=$true;$s.CreateNoWindow=$true
 $p=[Diagnostics.Process]::new();$p.StartInfo=$s
 try{AssertOperator $p.Start() 'START';$p.StandardInput.Close();$a=$p.StandardOutput.ReadToEndAsync();$b=$p.StandardError.ReadToEndAsync();if(-not $p.WaitForExit(30000)){$p.Kill();throw 'OPERATOR_NATIVE_DEADLINE'};return [pscustomobject]@{code=$p.ExitCode;stdout=$a.GetAwaiter().GetResult();stderr=$b.GetAwaiter().GetResult()}}finally{$p.Dispose()}
}
$inspection=RunPacket $Packet $true
AssertOperator ($inspection.code -eq 0) ('INSPECT:'+ $inspection.stderr)
$rows=@($inspection.stdout -split '\r?\n'|Where-Object {$_}|ForEach-Object {$_|ConvertFrom-Json})
AssertOperator ($rows.Count -eq 2 -and $rows[0].provider_requests -eq 0 -and -not $rows[0].private_input_read) 'CLI_INSPECTION'
$result=$rows[1];AssertOperator ($result.status -ceq 'OWNER_ONLINE_OPERATOR_PUBLIC_PACKET_INSPECTION_PASS' -and $result.provider_requests -eq 0 -and -not $result.private_input_read -and -not $result.gate3_closed) 'WRAPPER_INSPECTION'
$acl=Get-Acl -LiteralPath $result.work_directory;$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
AssertOperator $acl.AreAccessRulesProtected 'ACL_INHERITANCE_PROTECTED'
foreach($ace in $acl.Access){$id=$ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;AssertOperator ($id -ceq $owner -or $id -ceq 'S-1-5-18') 'NO_UNRELATED_ACL_PRINCIPAL'}
AssertOperator (-not ((Get-Item -LiteralPath $result.work_directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'NO_REPARSE'
$full=RunPacket $Packet $false
AssertOperator ($full.code -eq 2 -and $full.stderr.Contains('OWNER_INTERACTIVE_WINDOWS_REQUIRED') -and -not $full.stdout) 'CI_FULL_MODE_BEFORE_PRIVATE_INPUT'
$temp=Join-Path $env:RUNNER_TEMP ('a2-public-negative-'+[Guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($temp)
$oldSha=[regex]::Match($source,"(?m)^\`$PayloadSha='([a-f0-9]{64})'$").Groups[1].Value
$oldPacked=[regex]::Match($source,"(?m)^\`$PayloadGzipBase64='([A-Za-z0-9+/=]+)'$").Groups[1].Value
AssertOperator ($oldSha.Length -eq 64 -and $oldPacked.Length -gt 100) 'EMBEDDED_PUBLIC_FIELDS'
$bad=Join-Path $temp 'hash-mismatch.ps1';$badSource=$source.Replace(('$PayloadSha='''+$oldSha+''''),('$PayloadSha='''+('0'*64)+''''));[IO.File]::WriteAllText($bad,$badSource,[Text.UTF8Encoding]::new($true))
$mismatch=RunPacket $bad $true;AssertOperator ($mismatch.code -eq 2 -and $mismatch.stderr.Contains('EMBEDDED_SOURCE_HASH_MISMATCH')) 'TAMPER_HOLD_BEFORE_PRIVATE_INPUT'
$compressed=[IO.MemoryStream]::new([Convert]::FromBase64String($oldPacked));$zip=[IO.Compression.GzipStream]::new($compressed,[IO.Compression.CompressionMode]::Decompress);$reader=[IO.StreamReader]::new($zip,[Text.Encoding]::UTF8)
try{$payload=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose();$zip.Dispose();$compressed.Dispose()}
$payload.files|Add-Member -NotePropertyName '../ESCAPED_A2_TEST.mjs' -NotePropertyValue 'synthetic'
$raw=[Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 40 -Compress));$h=[Security.Cryptography.SHA256]::Create();try{$newSha=([BitConverter]::ToString($h.ComputeHash($raw))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}
$out=[IO.MemoryStream]::new();$gz=[IO.Compression.GzipStream]::new($out,[IO.Compression.CompressionMode]::Compress,$true);try{$gz.Write($raw,0,$raw.Length)}finally{$gz.Dispose()};$newPacked=[Convert]::ToBase64String($out.ToArray());$out.Dispose()
$malicious=$source.Replace(('$PayloadSha='''+$oldSha+''''),('$PayloadSha='''+$newSha+'''')).Replace(('$PayloadGzipBase64='''+$oldPacked+''''),('$PayloadGzipBase64='''+$newPacked+''''));$badPath=Join-Path $temp 'path-escape.ps1';[IO.File]::WriteAllText($badPath,$malicious,[Text.UTF8Encoding]::new($true))
$escape=RunPacket $badPath $true;AssertOperator ($escape.code -eq 2 -and $escape.stderr.Contains('PACKAGE_FILE_SCOPE_INVALID')) 'EXTRACTION_PATH_ESCAPE_HOLD'
AssertOperator (-not (Test-Path -LiteralPath (Join-Path ([IO.Directory]::GetParent($result.work_directory).FullName) 'ESCAPED_A2_TEST.mjs'))) 'NO_PARENT_WRITE'
# Actual Windows DPAPI wrapping and AES-GCM readback, using ONLY a synthetic
# fixture key/record. No provider request, user credential or owner signer.
$archiveRoot=Join-Path $result.work_directory 'SYNTHETIC_DPAPI_TEST';[void][IO.Directory]::CreateDirectory($archiveRoot)
$program=@'
import {pathToFileURL} from 'node:url';import {join} from 'node:path';const {PrivateEvidence}=await import(pathToFileURL(join(process.argv[1],'private_evidence.mjs')).href);const p=new PrivateEvidence(process.argv[2]);if(!p.capture({schema:'SYNTHETIC_WINDOWS_DPAPI_TEST',value:'not-a-user-credential'}))throw Error('capture failed');p.close();console.log(JSON.stringify({directory:p.directory,file:p.file}));
'@
$json=& node --input-type=module -e $program $result.work_directory $archiveRoot;AssertOperator ($LASTEXITCODE -eq 0) 'DPAPI_WRAP_NATIVE';$archive=$json|ConvertFrom-Json
Add-Type -AssemblyName System.Security
$wrapped=[IO.File]::ReadAllBytes((Join-Path $archive.directory 'WINDOWS_CURRENT_USER_WRAPPED_SESSION_KEY.bin'));$session=[Security.Cryptography.ProtectedData]::Unprotect($wrapped,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
AssertOperator ($session.Length -eq 32) 'DPAPI_CURRENT_USER_UNWRAP'
$decrypt=@'
import {readFileSync} from 'node:fs';import {createDecipheriv} from 'node:crypto';const k=Buffer.from(readFileSync(0,'utf8').trim(),'base64'),r=JSON.parse(readFileSync(process.argv[1],'utf8').trim()),d=createDecipheriv('aes-256-gcm',k,Buffer.from(r.iv_base64,'base64'));d.setAuthTag(Buffer.from(r.tag_base64,'base64'));const v=JSON.parse(Buffer.concat([d.update(Buffer.from(r.ciphertext_base64,'base64')),d.final()]));k.fill(0);if(v.schema!=='SYNTHETIC_WINDOWS_DPAPI_TEST'||v.value!=='not-a-user-credential')process.exit(2);console.log('SYNTHETIC_DPAPI_AES_READBACK_PASS');
'@
try{$decrypted=[Convert]::ToBase64String($session)|& node --input-type=module -e $decrypt $archive.file;AssertOperator ($LASTEXITCODE -eq 0 -and $decrypted -ceq 'SYNTHETIC_DPAPI_AES_READBACK_PASS') 'AES_GCM_AUTHENTICATED_READBACK'}finally{[Array]::Clear($session,0,$session.Length)}
$sha=(Get-FileHash -LiteralPath $Packet -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output ('A2_OWNER_ONLINE_OPERATOR_NATIVE_PASS_PS_'+$PSVersionTable.PSVersion.Major+' SHA256='+$sha+' OWNER_EXECUTION=false GATE3=false')
