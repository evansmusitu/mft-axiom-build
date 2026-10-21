<#
.SYNOPSIS
  Fail-closed LIFELINE Windows MetaTrader 5/MetaEditor host acceptance.
.DESCRIPTION
  Read-only. Does NOT configure a network listener, install software, run EAs,
  access a broker account, create tasks, launch compiler, change firewall, or place orders.
  Token values are never read back or persisted in output.
.EXAMPLE
  pwsh -File Test-LifelineHost.ps1 -ResultDir C:\LifelineHostProof
  Requires owner-approved Windows x64 with vendor-signed MT5+MetaEditor paths,
  protected native-MCP credentials and the private edge URL in environment.
#>
[CmdletBinding()]
param(
  [string]$ResultDir = (Join-Path $env:TEMP 'lifeline-host-acceptance'),
  [switch]$AllowUnpaired
)
$ErrorActionPreference='Stop'
$report=[ordered]@{
 schema='lifeline.windows.host_readiness.v1'
 acquired_persistent_host=$false
 windows_x64=$false
 user_mode_non_system=$false
 python_available=$false
 metaeditor_signed=$false
 terminal_signed=$false
 mcp_terminal_loopback=$false
 mcp_metaeditor_loopback=$false
 terminal_token_configured=$false
 metaeditor_token_configured=$false
 edge_https_configured=$false
 agent_pairing_configured=$false
 agent_nonpublic=$true
 trading_enabled=$false
 shell_enabled=$false
 ready_for_manual_local_probe=$false
 ready_for_research_agent=$false
}
try {
 $report.windows_x64=($IsWindows -eq $true -or $env:OS -eq 'Windows_NT') -and [Environment]::Is64BitOperatingSystem
 if(-not $report.windows_x64){throw 'Windows x64 required'}
 $report.user_mode_non_system=([Security.Principal.WindowsIdentity]::GetCurrent().Name -notlike '*\\SYSTEM')
 $python=Get-Command python -ErrorAction SilentlyContinue
 if($python){$report.python_available=$true}
 $editor=$env:LIFELINE_METAEDITOR
 $terminal=$env:LIFELINE_TERMINAL
 function CheckVendor([string]$Path,[string]$ExpectedName) {
  if([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)){return $false}
  if([IO.Path]::GetFileName($Path).ToLowerInvariant() -ne $ExpectedName){return $false}
  $sig=Get-AuthenticodeSignature -LiteralPath $Path
  return ($sig.Status -eq 'Valid' -and $null -ne $sig.SignerCertificate -and
    $sig.SignerCertificate.Subject -match 'MetaQuotes')
 }
 $report.metaeditor_signed=(CheckVendor $editor 'metaeditor64.exe')
 $report.terminal_signed=(CheckVendor $terminal 'terminal64.exe')
 foreach($name in @('terminal','metaeditor')){
  $port=if($name -eq 'terminal'){22346}else{22345}
  $listeners=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  # Reject a wildcard or externally accessible bind even if localhost also listens.
  $report[('mcp_'+$name+'_loopback')]=($listeners.Count -gt 0 -and
    @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') }).Count -eq 0)
 }
 $report.terminal_token_configured=($env:LIFELINE_TERMINAL_MCP_TOKEN.Length -ge 24)
 $report.metaeditor_token_configured=($env:LIFELINE_METAEDITOR_MCP_TOKEN.Length -ge 24)
 $uri=$null
 $gatewayText=[string]$env:LIFELINE_EDGE_URL
 if(-not [string]::IsNullOrWhiteSpace($gatewayText) -and [Uri]::TryCreate($gatewayText,[UriKind]::Absolute,[ref]$uri)){
   $report.edge_https_configured=($uri.Scheme -eq 'https' -and $uri.UserInfo -eq '' -and
      $uri.Query -eq '' -and $uri.Fragment -eq '' -and $uri.AbsolutePath -eq '/' -and
      $uri.Host -notin @('localhost','127.0.0.1'))
 }
 $report.agent_pairing_configured=(
   $env:LIFELINE_AGENT_ID -match '^[A-Za-z0-9_-]{1,100}$' -and
   $env:LIFELINE_TENANT -match '^[A-Za-z0-9_-]{1,100}$' -and
   $env:LIFELINE_AGENT_SECRET.Length -ge 32
 )
 $report.ready_for_manual_local_probe=(
   $report.metaeditor_signed -and $report.terminal_signed -and
   $report.mcp_terminal_loopback -and $report.mcp_metaeditor_loopback -and
   $report.terminal_token_configured -and $report.metaeditor_token_configured
 )
 $report.ready_for_research_agent=(
   $report.ready_for_manual_local_probe -and $report.python_available -and
   $report.agent_pairing_configured -and $report.edge_https_configured -and
   $report.user_mode_non_system
 )
 $report.acquired_persistent_host=$report.ready_for_research_agent
} finally {
 New-Item -ItemType Directory -Path $ResultDir -Force | Out-Null
 $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $ResultDir 'host-readiness.json') -Encoding utf8
 Write-Output ("LIFELINE windows_x64="+$report.windows_x64+" signed_metaeditor="+$report.metaeditor_signed+
    " mcp_local_only="+($report.mcp_terminal_loopback -and $report.mcp_metaeditor_loopback)+
    " agent_ready="+$report.ready_for_research_agent)
}
if(-not $AllowUnpaired -and -not $report.ready_for_research_agent){exit 2}
exit 0
