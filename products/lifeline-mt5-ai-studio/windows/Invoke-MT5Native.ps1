param([string]$ResultDir = "$env:RUNNER_TEMP\lifeline-native-proof")
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
New-Item -ItemType Directory -Path $ResultDir -Force | Out-Null
$proof = [ordered]@{
  schema = "lifeline.native.verification.v1"
  windows = $true
  installer_downloaded = $false
  installer_authenticode_valid = $false
  installer_publisher = ""
  installation_verified = $false
  metaeditor_path_verified = $false
  compiled = $false
  compile_log_present = $false
  compiler_errors_zero = $false
  compiled_ex5_sha256 = $null
  strategy_tester_report_verified = $false
  strategy_tester_status = "NOT_ATTEMPTED"
  account_login = $false
  trade_execution = $false
  error = ""
}
function Save-Proof {
  $proof | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $ResultDir "native-proof.json") -Encoding utf8
}
try {
  $installer = Join-Path $env:RUNNER_TEMP "mt5setup-official.exe"
  $url = "https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe"
  $installPath = Join-Path $env:RUNNER_TEMP "LifelineMT5"
  Write-Host "Downloading official MetaTrader 5 installer from MetaQuotes canonical download host."
  Invoke-WebRequest -Uri $url -OutFile $installer -TimeoutSec 120 -MaximumRedirection 3
  $installerSize = (Get-Item $installer).Length
  if ($installerSize -lt 100000) { throw "Downloaded installer unexpectedly small: $installerSize" }
  $proof.installer_downloaded = $true
  $sig = Get-AuthenticodeSignature -FilePath $installer
  $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "" }
  $proof.installer_publisher = $subject
  if ($sig.Status -ne "Valid" -or $subject -notmatch "MetaQuotes") {
    throw "MetaQuotes publisher signature not valid: $($sig.Status) $subject"
  }
  $proof.installer_authenticode_valid = $true
  $installerSha = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -Path (Join-Path $ResultDir "official-installer-sha256.txt") -Value $installerSha
  Write-Host "Authenticode publisher verified; SHA256 captured (not exposing installer contents)."
  New-Item -ItemType Directory -Path $installPath -Force | Out-Null
  $args = @("/auto", "/path:`"$installPath`"")
  $p = Start-Process -FilePath $installer -ArgumentList $args -PassThru
  if (-not $p.WaitForExit(180000)) {
    try { $p.Kill() } catch {}
    throw "MetaQuotes automatic installer did not finish in 180 seconds."
  }
  $editor = @((Join-Path $installPath "metaeditor64.exe"),(Join-Path $installPath "metaeditor.exe")) | Where-Object { Test-Path $_ } | Select-Object -First 1
  $terminal = Join-Path $installPath "terminal64.exe"
  if (-not $editor -or -not (Test-Path $terminal)) {
    throw "Official automatic install produced no MetaEditor/terminal64.exe at the requested path (installer exit $($p.ExitCode))."
  }
  $proof.installation_verified = $true
  $proof.metaeditor_path_verified = $true
  foreach($exe in @($editor,$terminal)){
    $v=Get-AuthenticodeSignature -FilePath $exe
    if($v.Status -ne "Valid" -or $v.SignerCertificate.Subject -notmatch "MetaQuotes"){ throw "Unsigned or wrong publisher: $(Split-Path $exe -Leaf)" }
  }
  Write-Host "MetaEditor and terminal verified from vendor-signed installation."
  $expertsDir=Join-Path $installPath "MQL5\Experts"
  New-Item -ItemType Directory -Path $expertsDir -Force | Out-Null
  $src=Join-Path $expertsDir "LifelineSmoke.mq5"
  Copy-Item (Join-Path $PSScriptRoot "LifelineSmoke.mq5") $src -Force
  $compileArgs = @("/portable", "/compile:`"$src`"", "/log")
  $c=Start-Process -FilePath $editor -ArgumentList $compileArgs -PassThru
  if (-not $c.WaitForExit(150000)) { try {$c.Kill()} catch {}; throw "MetaEditor compile timed out" }
  $log=Join-Path $expertsDir "LifelineSmoke.log"
  $ex5=Join-Path $expertsDir "LifelineSmoke.ex5"
  $proof.compile_log_present=(Test-Path $log)
  if (Test-Path $log) {
    Copy-Item $log (Join-Path $ResultDir "metaeditor-compile.log") -Force
    $body=Get-Content $log -Raw
    $proof.compiler_errors_zero=($body -match "(?i)0\s+errors")
  }
  if (-not (Test-Path $ex5) -or (Get-Item $ex5).Length -lt 100 -or -not $proof.compiler_errors_zero) {
    throw "MetaEditor did not produce verifiable EX5 plus a zero-error compile log (exit $($c.ExitCode))."
  }
  $proof.compiled=$true
  $proof.compiled_ex5_sha256=(Get-FileHash $ex5 -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "Compiled real MQL5 source to EX5; zero compiler errors."
  # Installer can leave terminal running; another terminal64.exe instance would not apply /config.
  # Only stop the signed disposable install inside RUNNER_TEMP; never touch a user's MT5.
  foreach ($q in @(Get-CimInstance Win32_Process -Filter "name = 'terminal64.exe'" -ErrorAction SilentlyContinue)) {
    if ($q.ExecutablePath -eq $terminal) {
      Write-Host "Stopping installer-started disposable terminal before Strategy Tester config."
      Stop-Process -Id $q.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 2
  # Try one local-only, no-cloud backtest. Missing historic market data must NOT be reported as success.
  $testerProfiles=Join-Path $installPath "MQL5\\Profiles\\Tester"
  New-Item -ItemType Directory -Path $testerProfiles -Force | Out-Null
  "InpProbeValue=7||1||1||10||Y" | Set-Content (Join-Path $testerProfiles "LifelineSmoke.set") -Encoding ascii
  $ini=Join-Path $installPath "lifeline-tester.ini"
  @"
[Tester]
Expert=LifelineSmoke
Symbol=EURUSD
Period=H1
FromDate=2025.02.03
ToDate=2025.02.07
Model=3
Optimization=1
OptimizationCriterion=6
ExpertParameters=LifelineSmoke.set
UseLocal=1
UseRemote=0
UseCloud=0
Visual=0
Report=lifeline-native-smoke
ReplaceReport=1
ShutdownTerminal=1
"@ | Set-Content -Path $ini -Encoding ascii
  $proof.strategy_tester_status="MATH_TESTER_ATTEMPTED"
  $proof.strategy_tester_mode="MATH_CALCULATIONS_NO_HISTORY_NO_ACCOUNT"
  $t=Start-Process -FilePath $terminal -ArgumentList @("/portable","/config:`"$ini`"") -PassThru
  if (-not $t.WaitForExit(100000)) {
    try { $t.Kill() } catch {}
    $proof.strategy_tester_status="INCONCLUSIVE_TIMEOUT_OR_MARKET_DATA"
  } else { $proof.strategy_tester_status="NO_VERIFIED_REPORT" }
  $reports=@(Get-ChildItem -Path $installPath -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match "^lifeline-native-smoke\.(htm|html|xml)$" -and $_.Length -gt 500
  })
  $historyLogs=@(Get-ChildItem -Path $installPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\\d{8}\\.log$' -and $_.DirectoryName -match 'logs' })
  $proof.terminal_log_count=$historyLogs.Count
  Write-Host "Tester candidate reports: $($reports.Count); terminal logs: $($historyLogs.Count)"
  if ($reports.Count -gt 0) {
    $proof.strategy_tester_report_verified=$true
    $proof.strategy_tester_status="MATH_CALCULATION_OPTIMIZATION_REPORT_PRESENT_NOT_MARKET_BACKTEST"
    $selected=$reports[0]
    $proof.strategy_tester_report_sha256=(Get-FileHash $selected.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $reportText=Get-Content -Path $selected.FullName -Raw -ErrorAction SilentlyContinue
    $proof.tester_report_has_named_inputs=($reportText -match 'InpProbeValue')
    $proof.tester_report_has_result_field=($reportText -match 'Result|OnTester|Criterion')
    $proof.tester_report_structurally_verified=($proof.tester_report_has_named_inputs -and $proof.tester_report_has_result_field)
    if (-not $proof.tester_report_structurally_verified) {
      $proof.strategy_tester_status='MATH_REPORT_EXISTS_PASS_STRUCTURE_UNCONFIRMED'
    }

  }
} catch {
  $proof.error=$_.Exception.Message
  Write-Host "Native qualification limitation: $($proof.error)"
} finally { Save-Proof }
if (-not $proof.compiled) { exit 1 }
exit 0
