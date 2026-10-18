# MUSITU Store V2, Windows Phase-1 isolated operator-only MSIX intake.
# Does not install, publish, grant an entitlement or change OS trust stores.
# The caller MUST separately obtain its expected identities/digests from
# the trusted root-signed catalog, not an untrusted publisher submission.
function Test-MusituWindowsMsix {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$ExpectedSha256,
    [Parameter(Mandatory)][string]$ExpectedCertificateThumbprint,
    [Parameter(Mandatory)][string]$ExpectedPackageName,
    [Parameter(Mandatory)][string]$ExpectedPublisher,
    [Parameter(Mandatory)][string]$ExpectedVersion,
    [Parameter(Mandatory)][string]$SignToolPath
  )
  $ErrorActionPreference='Stop'
  if ($ExpectedSha256 -cnotmatch '^[0-9a-fA-F]{64}$' -or
      $ExpectedCertificateThumbprint -cnotmatch '^[0-9a-fA-F]{40}$' -or
      $ExpectedPackageName -cnotmatch '^[A-Za-z][A-Za-z0-9.]{3,120}$' -or
      $ExpectedPublisher -cnotmatch '^CN=[A-Za-z0-9 ._-]{3,100}$' -or
      $ExpectedVersion -cnotmatch '^[0-9]{1,5}(\.[0-9]{1,5}){3}$') {
    throw 'Windows MSIX intake: malformed trusted catalog expectations'
  }
  if (-not $PackagePath.EndsWith('.msix',[StringComparison]::OrdinalIgnoreCase) -or
      -not [IO.Path]::IsPathRooted($PackagePath)) {
    throw 'Windows MSIX intake: rooted native MSIX path required'
  }
  $item=Get-Item -LiteralPath $PackagePath -Force -ErrorAction Stop
  if ($item.PSIsContainer -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $item.Length -lt 256 -or $item.Length -gt 536870912) {
    throw 'Windows MSIX intake: unsafe, linked or oversized artifact'
  }
  $digest=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($digest -cne $ExpectedSha256.ToLowerInvariant()){
    throw 'Windows MSIX intake: signed catalog artifact SHA256 mismatch'
  }
  Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
  # Windows PowerShell 5.1 defines ZipFile in FileSystem, whereas modern
  # PowerShell normally resolves it automatically. Require both runtimes.
  if (-not ('System.IO.Compression.ZipFile' -as [type])) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
  }
  $archive=[IO.Compression.ZipFile]::OpenRead($item.FullName)
  try {
    $entries=@($archive.Entries | Where-Object {$_.FullName -ceq 'AppxManifest.xml'})
    if ($entries.Count -ne 1 -or $entries[0].Length -lt 64 -or
        $entries[0].Length -gt 131072) {
      throw 'Windows MSIX intake: missing or oversized native package identity manifest'
    }
    $settings=[Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver=$null
    $stream=$entries[0].Open()
    try {
      $reader=[Xml.XmlReader]::Create($stream,$settings)
      try { $xml=[xml]::new();$xml.XmlResolver=$null;$xml.Load($reader) }
      finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
    $identity=$xml.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
    if ($null -eq $identity -or
        $identity.GetAttribute('Name') -cne $ExpectedPackageName -or
        $identity.GetAttribute('Publisher') -cne $ExpectedPublisher -or
        $identity.GetAttribute('Version') -cne $ExpectedVersion){
      throw 'Windows MSIX intake: native manifest identity does not match the trusted signed catalog'
    }
  } finally { $archive.Dispose() }

  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
    throw 'Windows MSIX intake: platform signature validation requires Windows OS'
  }
  $tool=Get-Item -LiteralPath $SignToolPath -ErrorAction Stop
  if ($tool.PSIsContainer -or $tool.Name -ine 'signtool.exe'){
    throw 'Windows MSIX intake: genuine trusted Windows SDK SignTool is required'
  }
  $auth=Get-AuthenticodeSignature -LiteralPath $item.FullName -ErrorAction Stop
  if ($null -eq $auth.SignerCertificate -or $auth.Status -ne 'Valid'){
    throw 'Windows MSIX intake: missing or untrusted native Authenticode signature'
  }
  if ($auth.SignerCertificate.Thumbprint.ToUpperInvariant() -cne
      $ExpectedCertificateThumbprint.ToUpperInvariant() -or
      $auth.SignerCertificate.Subject -cne $ExpectedPublisher){
    throw 'Windows MSIX intake: native signed publisher certificate mismatch'
  }
  & $tool.FullName verify /pa /all $item.FullName | Out-Null
  if ($LASTEXITCODE -ne 0){throw 'Windows MSIX intake: native platform SignTool verification failed'}
  # Refuse any package mutated while the archive and signature were inspected.
  $after=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($after -cne $digest){throw 'Windows MSIX intake: artifact changed during validation'}

  [PSCustomObject]@{
    state='REVIEW_REQUIRED'
    packageName=$ExpectedPackageName
    publisher=$ExpectedPublisher
    version=$ExpectedVersion
    sha256=$digest
    signingThumbprint=$auth.SignerCertificate.Thumbprint.ToUpperInvariant()
    permittedInstallation=$false
    permittedPublication=$false
  }
}
