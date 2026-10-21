<#
.SYNOPSIS
  LIFELINE reviewed-source, on-demand MetaEditor compiler for ephemeral GitHub Windows.
.DESCRIPTION
  Never uses broker accounts, trades, tester, native MCP, public endpoints or SSH/RDP.
  Only one .mq5 under reviewed/; caller must pin exact SHA256. Signed MetaQuotes
  installer and signed MetaEditor binary are mandatory. Proof is fail-closed.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceRelative,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [string]$ResultDir=(Join-Path $env:RUNNER_TEMP 'lifeline-reviewed-compile')
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
New-Item -ItemType Directory -Path $ResultDir -Force|Out-Null
$proof=[ordered]@{
 schema='lifeline.reviewed_native_compiler.v1'
 source_relative=$SourceRelative
 source_hash_valid=$false
 vendor_signature_valid=$false
 metaeditor_signature_valid=$false
 compiled=$false
 zero_errors=$false
 ex5_sha256=$null
 broker_login=$false
 trading_enabled=$false
 market_history_backtest=$false
 native_mcp_enabled=$false
 permanent_windows_host=$false
 error_code=''
}
function Write-Proof {
 $proof|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $ResultDir 'reviewed-native-proof.json') -Encoding utf8
}
try{
 if($env:RUNNER_OS -ne 'Windows' -or -not [Environment]::Is64BitOperatingSystem){
   throw 'WINDOWS_X64_REQUIRED'
 }
 if($SourceRelative -cnotmatch '^reviewed/[A-Za-z0-9_-]{1,64}\.mq5$'){
   throw 'REVIEWED_SOURCE_ONLY'
 }
 if($ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$'){
   throw 'PINNED_SOURCE_SHA256_REQUIRED'
 }
 $source=Join-Path $PSScriptRoot ($SourceRelative.Replace('/',[IO.Path]::DirectorySeparatorChar))
 if(-not (Test-Path -LiteralPath $source -PathType Leaf)){throw 'REVIEWED_SOURCE_NOT_FOUND'}
 if((Get-Item -LiteralPath $source).Length -gt 262144){throw 'SOURCE_SIZE_LIMIT'}
 $actual=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
 if($actual -cne $ExpectedSha256){throw 'SOURCE_HASH_MISMATCH'}
 $proof.source_hash_valid=$true
 $installer=Join-Path $env:RUNNER_TEMP 'lifeline-reviewed-mt5setup.exe'
 $url='https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe'
 Invoke-WebRequest -Uri $url -OutFile $installer -TimeoutSec 120 -MaximumRedirection 3
 if((Get-Item -LiteralPath $installer).Length -lt 100000){throw 'INSTALLER_TOO_SMALL'}
 $vendor=Get-AuthenticodeSignature -LiteralPath $installer
 if($vendor.Status -ne 'Valid' -or
     $null -eq $vendor.SignerCertificate -or
     $vendor.SignerCertificate.Subject -notmatch 'MetaQuotes'){
   throw 'UNTRUSTED_VENDOR_INSTALLER'
 }
 $proof.vendor_signature_valid=$true
 $install=Join-Path $env:RUNNER_TEMP 'LifelineReviewedMT5'
 New-Item -ItemType Directory -Path $install -Force|Out-Null
 $p=Start-Process -FilePath $installer -ArgumentList @('/auto',"/path:`"$install`"") -PassThru
 if(-not $p.WaitForExit(180000)){
   try{$p.Kill()}catch{}
   throw 'VENDOR_INSTALL_TIMEOUT'
 }
 $editor=@((Join-Path $install 'metaeditor64.exe'),(Join-Path $install 'metaeditor.exe'))|
   Where-Object{Test-Path -LiteralPath $_ -PathType Leaf}|Select-Object -First 1
 if(-not $editor){throw 'METAEDITOR_NOT_INSTALLED'}
 $signature=Get-AuthenticodeSignature -LiteralPath $editor
 if($signature.Status -ne 'Valid' -or
     $null -eq $signature.SignerCertificate -or
     $signature.SignerCertificate.Subject -notmatch 'MetaQuotes'){
   throw 'UNTRUSTED_METAEDITOR_BINARY'
 }
 $proof.metaeditor_signature_valid=$true
 $experts=Join-Path $install 'MQL5/Experts/LIFELINE_REVIEWED'
 New-Item -ItemType Directory -Path $experts -Force|Out-Null
 $name=[IO.Path]::GetFileNameWithoutExtension($source)
 $target=Join-Path $experts ($name+'.mq5')
 Copy-Item -LiteralPath $source -Destination $target -Force
 if((Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSha256){
    throw 'SOURCE_COPY_INTEGRITY_FAILED'
 }
 $c=Start-Process -FilePath $editor -ArgumentList @('/portable',"/compile:`"$target`"","/log") -PassThru
 if(-not $c.WaitForExit(150000)){
   try{$c.Kill()}catch{}
   throw 'METAEDITOR_COMPILER_TIMEOUT'
 }
 $compileLog=Join-Path $experts ($name+'.log')
 $ex5=Join-Path $experts ($name+'.ex5')
 if(-not (Test-Path -LiteralPath $compileLog -PathType Leaf)){throw 'COMPILER_LOG_MISSING'}
 Copy-Item -LiteralPath $compileLog -Destination (Join-Path $ResultDir 'metaeditor-compile.log') -Force
 $logBody=Get-Content -LiteralPath $compileLog -Raw
 $proof.zero_errors=[bool]($logBody -match '(?i)\b0\s+errors?\b')
 if(-not $proof.zero_errors -or -not (Test-Path -LiteralPath $ex5 -PathType Leaf) -or
      (Get-Item -LiteralPath $ex5).Length -lt 100){throw 'NATIVE_COMPILE_FAILED'}
 $hash=(Get-FileHash -LiteralPath $ex5 -Algorithm SHA256).Hash.ToLowerInvariant()
 Copy-Item -LiteralPath $ex5 -Destination (Join-Path $ResultDir ($name+'.ex5')) -Force
 $proof.compiled=$true
 $proof.ex5_sha256=$hash
 Write-Output ('LIFELINE_REVIEWED_COMPILE_PASS_SHA256='+$hash)
} catch {
 # Only preserve reviewed categorical failure codes, never executable paths or host details.
 $msg=$_.Exception.Message
 $allowed=@('WINDOWS_X64_REQUIRED','REVIEWED_SOURCE_ONLY','PINNED_SOURCE_SHA256_REQUIRED',
  'REVIEWED_SOURCE_NOT_FOUND','SOURCE_SIZE_LIMIT','SOURCE_HASH_MISMATCH',
  'INSTALLER_TOO_SMALL','UNTRUSTED_VENDOR_INSTALLER','VENDOR_INSTALL_TIMEOUT',
  'METAEDITOR_NOT_INSTALLED','UNTRUSTED_METAEDITOR_BINARY',
  'SOURCE_COPY_INTEGRITY_FAILED','METAEDITOR_COMPILER_TIMEOUT',
  'COMPILER_LOG_MISSING','NATIVE_COMPILE_FAILED')
 $proof.error_code=if($msg -cin $allowed){$msg}else{'INSTALLER_OR_NATIVE_FAILURE'}
} finally {Write-Proof}
if(-not $proof.compiled){Write-Output ('LIFELINE_REVIEWED_COMPILE_FAILED='+$proof.error_code);exit 1}
exit 0
