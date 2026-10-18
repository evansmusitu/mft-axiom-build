# CI-only OS-mediated Windows MSIX deployment acceptance fixture. This is
# neither a Store install API nor a way for a customer/publisher to install.
# It requires an ephemeral GitHub-hosted Windows runner and test-only identity.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. "$PSScriptRoot/verify-msix.ps1"
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
    $env:CI -ne 'true' -or $env:MUSITU_WINDOWS_DISPOSABLE_INSTALL -ne 'true' -or
    -not $env:RUNNER_TEMP -or
    -not $env:MUSITU_TEST_SIGNED_MSIX -or
    -not $env:MUSITU_TEST_CERT_THUMBPRINT -or
    -not $env:MUSITU_SIGNTOOL) {
  throw 'Windows disposable OS installation requires explicitly gated ephemeral CI runner'
}

$name='MUSITU.Private.WindowsFixture'
$publisher='CN=MUSITU Disposable MSIX Test'
$version='1.0.0.0'
$file=[IO.Path]::GetFullPath($env:MUSITU_TEST_SIGNED_MSIX)
$trustedTemp=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\'
if (-not $file.StartsWith($trustedTemp,[StringComparison]::OrdinalIgnoreCase) -or
    $file -notmatch '(?i)\\musitu-store-private-windows-msix\\signed-fixture\.msix$') {
  throw 'Only the previously built, disposable MSIX within the ephemeral runner may be installed'
}
$prior=@(Get-AppxPackage -Name $name -ErrorAction Stop)
if ($prior.Count -ne 0){
  throw 'Refusing to replace an existing Windows installation'
}

$checked=Test-MusituWindowsMsix `
  -PackagePath $file `
  -ExpectedSha256 (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() `
  -ExpectedCertificateThumbprint $env:MUSITU_TEST_CERT_THUMBPRINT `
  -ExpectedPackageName $name `
  -ExpectedPublisher $publisher `
  -ExpectedVersion $version `
  -SignToolPath $env:MUSITU_SIGNTOOL

if ($checked.state -cne 'REVIEW_REQUIRED' -or $checked.permittedInstallation -ne $false){
  throw 'The normal Store intake MUST NOT grant customer installation authority'
}
# Only this disposable CI acceptance harness is permitted to exercise the
# OS installer. A genuine user's approval is required on retail devices.
Add-AppxPackage -Path $file -ErrorAction Stop
Write-Output 'MUSITU_WINDOWS_CI_DISPOSABLE_ADD_APPXPACKAGE_INVOKED=PASS'
