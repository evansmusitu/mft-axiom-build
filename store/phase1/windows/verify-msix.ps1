# Isolated private Windows MSIX review. Initial test stub: intentionally
# not secure, must be replaced only after negative security tests fail.
function Test-MusituWindowsMsix {
  param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$ExpectedSha256,
    [Parameter(Mandatory)][string]$ExpectedCertificateThumbprint,
    [Parameter(Mandatory)][string]$ExpectedPackageName,
    [Parameter(Mandatory)][string]$ExpectedPublisher,
    [Parameter(Mandatory)][string]$ExpectedVersion,
    [Parameter(Mandatory)][string]$SignToolPath
  )
  [PSCustomObject]@{ state='REVIEW_REQUIRED'; packageName=$ExpectedPackageName;
                     sha256=$ExpectedSha256; signingThumbprint=$ExpectedCertificateThumbprint }
}
