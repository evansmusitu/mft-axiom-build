# CI-only Windows MSIX deployment acceptance. NO production installer
# automation: this test verifies current-user OS package state but never
# installs applications, changes trust, opens apps or publishes anything.
param([switch]$MustBeAbsent,
      [ValidateSet('1.0.0.0','1.0.0.1')][string]$ExpectedVersion='1.0.0.0')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $env:CI -ne 'true' -or
    -not $env:RUNNER_TEMP -or
    -not $env:MUSITU_TEST_SIGNED_MSIX -or
    -not $env:MUSITU_TEST_CERT_THUMBPRINT) {
  throw 'MUSITU Windows native install qualification is restricted to ephemeral Windows CI runners'
}

$name='MUSITU.Private.WindowsFixture'
$version=$ExpectedVersion
$publisher='CN=MUSITU Disposable MSIX Test'
$packages=@(Get-AppxPackage -Name $name -ErrorAction Stop)
if ($MustBeAbsent){
  if ($packages.Count -ne 0) {
    throw 'Windows package still installed after cleanup; do not release runner'
  }
  Write-Output 'MUSITU_WINDOWS_NATIVE_MSIX_REMOVAL_PASS installed=false'
  return
}
if ($packages.Count -ne 1){
  throw 'Real Windows native installation not observed: exactly one fixture package required'
}
$app=$packages[0]
if ($app.Name -cne $name -or
    $app.Publisher -cne $publisher -or
    $app.Version.ToString() -cne $version -or
    [string]::IsNullOrWhiteSpace($app.PackageFullName) -or
    [string]::IsNullOrWhiteSpace($app.InstallLocation) -or
    -not (Test-Path -LiteralPath $app.InstallLocation -PathType Container)) {
  throw 'Windows native installed package identity/path does not match the reviewed package'
}
$signature=(Get-AuthenticodeSignature -LiteralPath $env:MUSITU_TEST_SIGNED_MSIX -ErrorAction Stop)
if ($signature.Status -ne 'Valid' -or
    $null -eq $signature.SignerCertificate -or
    $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -cne
      $env:MUSITU_TEST_CERT_THUMBPRINT.ToUpperInvariant()) {
  throw 'Installed Windows package has not retained the independently verified signer'
}
Write-Output 'MUSITU_WINDOWS_NATIVE_MSIX_OS_INSTALL_PASS installed=true reviews=required production=false'
