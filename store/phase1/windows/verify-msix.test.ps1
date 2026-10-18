$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. "$PSScriptRoot/verify-msix.ps1"

if (-not $env:MUSITU_TEST_SIGNED_MSIX -or -not $env:MUSITU_TEST_UNSIGNED_MSIX -or
    -not $env:MUSITU_TEST_CERT_THUMBPRINT -or -not $env:MUSITU_TEST_SIGNTOOL) {
  throw 'Windows CI fixture credentials and paths are required (test-only)'
}

$inputArgs=@{
  PackagePath=$env:MUSITU_TEST_SIGNED_MSIX
  ExpectedSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $env:MUSITU_TEST_SIGNED_MSIX).Hash.ToLowerInvariant()
  ExpectedCertificateThumbprint=$env:MUSITU_TEST_CERT_THUMBPRINT.ToUpperInvariant()
  ExpectedPackageName='MUSITU.Private.WindowsFixture'
  ExpectedPublisher='CN=MUSITU Disposable MSIX Test'
  ExpectedVersion='1.0.0.0'
  SignToolPath=$env:MUSITU_TEST_SIGNTOOL
}
function Assert-Rejected([scriptblock]$Run,[string]$Reason) {
  $denied=$false
  try { $null=(& $Run) }
  catch { $denied=$true }
  if (-not $denied){throw "MSIX review incorrectly admitted $Reason"}
}
$success=Test-MusituWindowsMsix @inputArgs
if ($success.state -ne 'REVIEW_REQUIRED' -or $success.packageName -ne $inputArgs.ExpectedPackageName){
  throw 'Independently verified MSIX must require manual review, never publish'
}
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -ExpectedSha256 ('f'*64)} 'wrong SHA256'
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -ExpectedCertificateThumbprint ('a'*40)} 'wrong certificate'
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -ExpectedPackageName 'MUSITU.OtherPublisher'} 'incorrect package name'
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -ExpectedPublisher 'CN=Attacker'} 'incorrect publisher'
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -ExpectedVersion '2.0.0.0'} 'incorrect version'
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -PackagePath $env:MUSITU_TEST_UNSIGNED_MSIX -ExpectedSha256 (Get-FileHash -Algorithm SHA256 -LiteralPath $env:MUSITU_TEST_UNSIGNED_MSIX).Hash.ToLowerInvariant()} 'unsigned MSIX'
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -PackagePath (Join-Path $env:RUNNER_TEMP 'missing-file.msix')} 'missing artifact'
Assert-Rejected {Test-MusituWindowsMsix @inputArgs -ExpectedSha256 'not-a-hash'} 'malformed digest'
Write-Output 'MUSITU_STORE_V2_WINDOWS_MSIX_POLICY_PASS valid=1 rejected=8 review=required installed=false'
