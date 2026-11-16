# Synthetic/public packet negative cases only. No owner key path is accepted.
param([Parameter(Mandatory=$true)][string]$Packet)
$ErrorActionPreference='Stop'
if(-not $env:GITHUB_ACTIONS){throw 'Public packet Windows fixture tests are CI-only'}
function Negative([string]$name,[scriptblock]$change,[string]$reason){
  $fixture=Join-Path $env:RUNNER_TEMP ('a2-packet-negative-'+[Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($fixture)
  try{
    Copy-Item -Path (Join-Path $Packet '*') -Destination $fixture -Recurse
    & $change $fixture
    $log=Join-Path $fixture 'public-denial.log'
    $prior=$ErrorActionPreference
    try{$ErrorActionPreference='Continue';& powershell.exe -NoProfile -NonInteractive -File (Join-Path $fixture 'Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1') -PublicSelfTest 2> $log | Out-Null;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$prior}
    if($code -ne 2 -or (Get-Content -LiteralPath $log -Raw) -notmatch $reason){throw ('Wrong denial: '+$name)}
    if(Test-Path -LiteralPath (Join-Path $fixture 'results')){throw 'Negative fixture created an owner proof directory'}
    Write-Output ('PUBLIC_PACKET_NEGATIVE_PASS:'+ $name)
  }finally{Remove-Item -LiteralPath $fixture -Recurse -Force}
}
Negative 'changed helper' {param($p)[IO.File]::AppendAllText((Join-Path $p 'step3_authority2_signer_possession.mjs'),"`n// PUBLIC TAMPER FIXTURE")} 'PACKET_FILE_HASH_MISMATCH'
Negative 'changed challenge' {param($p)[IO.File]::AppendAllText((Join-Path $p 'challenge.json'),"`n")} 'PACKET_FILE_HASH_MISMATCH'
Negative 'changed wrapper' {param($p)[IO.File]::AppendAllText((Join-Path $p 'Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1'),"`n# PUBLIC TAMPER FIXTURE")} 'PACKET_FILE_HASH_MISMATCH'
Negative 'rewritten deployment claim' {param($p)$f=Join-Path $p 'PACKET_MANIFEST.json';$m=Get-Content $f -Raw|ConvertFrom-Json;$m.deployment_performed=$true;[IO.File]::WriteAllText($f,($m|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))} 'PACKET_SCOPE_INVALID'
exit 0
