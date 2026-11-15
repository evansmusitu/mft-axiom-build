#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PacketRoot = $PSScriptRoot,
    [string]$ExpectedManifestSha256 = ''
)

# Offline integrity check for public review files only. No credentials or API calls.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$proofSchema = 'musitu.axiom.authority2.owner-review-packet-integrity.v1'
$proofPath = $null

function Hold([string]$Code) { throw $Code }

function ReviewFile([string]$RelativePath) {
    $full = Join-Path $script:reviewRoot $RelativePath
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Hold 'A2_PACKET_FILE_MISSING_HOLD'
    }
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Hold 'A2_PACKET_REPARSE_POINT_HOLD'
    }
    $parent = $item.Directory
    while ($null -ne $parent) {
        if (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Hold 'A2_PACKET_REPARSE_POINT_HOLD'
        }
        if ($parent.FullName.TrimEnd('\') -eq $script:reviewRoot.TrimEnd('\')) {
            return $item.FullName
        }
        $parent = $parent.Parent
    }
    Hold 'A2_PACKET_PATH_SCOPE_HOLD'
}

function FileSha([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        Hold 'A2_WINDOWS_REQUIRED_HOLD'
    }
    $script:reviewRoot = [IO.Path]::GetFullPath($PacketRoot)
    if ($script:reviewRoot.StartsWith('\\')) { Hold 'A2_LOCAL_PACKET_REQUIRED_HOLD' }
    $rootItem = Get-Item -LiteralPath $script:reviewRoot -Force
    if (-not $rootItem.PSIsContainer -or
        (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
        Hold 'A2_PACKET_ROOT_HOLD'
    }
    $proofPath = Join-Path $script:reviewRoot 'OWNER_AUTHORITY2_REVIEW_PACKET_INTEGRITY_PROOF.json'
    if (Test-Path -LiteralPath $proofPath) {
        $oldProof = ReviewFile 'OWNER_AUTHORITY2_REVIEW_PACKET_INTEGRITY_PROOF.json'
        if ((Get-Item -LiteralPath $oldProof).Length -gt 65536) {
            Hold 'A2_PROOF_DESTINATION_EXISTS_HOLD'
        }
        $previous = [IO.File]::ReadAllText($oldProof) | ConvertFrom-Json
        if ($previous.schema -ne $proofSchema) { Hold 'A2_PROOF_DESTINATION_EXISTS_HOLD' }
        # A failed recheck must never leave a previous PASS proof behind.
        Remove-Item -LiteralPath $oldProof -Force
    }

    $manifestFile = ReviewFile 'A2_BUILD_MANIFEST.json'
    $manifestSha = FileSha $manifestFile
    if ($ExpectedManifestSha256 -ne '') {
        if ($ExpectedManifestSha256 -cnotmatch '^[a-fA-F0-9]{64}$' -or
            $manifestSha -ne $ExpectedManifestSha256.ToLowerInvariant()) {
            Hold 'A2_MANIFEST_HASH_MISMATCH_HOLD'
        }
    }
    if ((Get-Item -LiteralPath $manifestFile).Length -gt 65536) {
        Hold 'A2_MANIFEST_SIZE_HOLD'
    }
    $manifest = [IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
    if ($manifest.schema -ne 'musitu.axiom.authority2.worker.dryrun.v1' -or
        $manifest.wrangler_version -ne '4.150.0' -or
        $manifest.reviewed_runtime_source_commit -ne '14b5c520bd7cd53ccd4978f575dfcbe9b250ed0c' -or
        $manifest.source_commit -cnotmatch '^[a-f0-9]{40}$' -or
        $manifest.deployment -ne 'NONE' -or $manifest.origin -ne 'UNASSIGNED') {
        Hold 'A2_MANIFEST_BINDING_HOLD'
    }
    foreach ($flag in @('worker_uploaded','customer_traffic_enabled','secrets_used',
        'independent_custody_qualified','release_eligible')) {
        $value = $manifest.PSObject.Properties[$flag].Value
        if ($value -isnot [bool] -or $value -ne $false) {
            Hold 'A2_MANIFEST_CLAIM_HOLD'
        }
    }

    $expectedBundle = 'd1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210'
    if ($manifest.bundle_file -cne 'authority2-highwater-worker.js' -or
        $manifest.bundle_sha256 -cne $expectedBundle -or $manifest.bundle_size -ne 15548) {
        Hold 'A2_BUNDLE_BINDING_HOLD'
    }
    $bundle = ReviewFile 'authority2-highwater-worker.js'
    if ((Get-Item -LiteralPath $bundle).Length -ne 15548 -or (FileSha $bundle) -ne $expectedBundle) {
        Hold 'A2_BUNDLE_HASH_MISMATCH_HOLD'
    }
    $expectedSources = @{
        'integrations/security-authority2/authority2-highwater-worker.mjs' = '7e29a46bb0924c5a7eb0d60d79885f36a0b6945e022fb37a56898bce3aec6df1'
        'integrations/security-authority2/authority2-r2-worm.mjs' = 'ce080ac8b5a6e190cf22e0bf9a5cf34251174822020b3b6da3e349fe4f5e17f7'
        'integrations/security-authority2/wrangler.example.toml' = 'd8db8f065d8bdad9a219f994352bf0920e8e7e96d734dd2ebab5b2532c3464fd'
    }
    $actualNames = @($manifest.sources.PSObject.Properties.Name | Sort-Object)
    $expectedNames = @($expectedSources.Keys | Sort-Object)
    if (($actualNames -join '|') -cne ($expectedNames -join '|')) {
        Hold 'A2_SOURCE_SET_MISMATCH_HOLD'
    }
    foreach ($source in $expectedNames) {
        if ($manifest.sources.PSObject.Properties[$source].Value -cne $expectedSources[$source]) {
            Hold 'A2_SOURCE_BINDING_HOLD'
        }
        $path = ReviewFile ('reviewed-source/' + $source)
        if ((FileSha $path) -ne $expectedSources[$source]) { Hold 'A2_SOURCE_HASH_MISMATCH_HOLD' }
    }
    $proof = [ordered]@{
        schema = $proofSchema
        observed_at_utc = [DateTime]::UtcNow.ToString('o')
        status = 'REVIEW_PACKET_FILES_VERIFIED_ONLY_NOT_DEPLOYED'
        powershell_version = $PSVersionTable.PSVersion.ToString()
        build_source_commit = $manifest.source_commit
        reviewed_runtime_source_commit = $manifest.reviewed_runtime_source_commit
        build_manifest_sha256 = $manifestSha
        reviewed_bundle_sha256 = $expectedBundle
        reviewed_source_sha256 = $expectedSources
        config_only_public_routes_disabled = $true
        provider_state_verified = $false
        provider_operations = 0
        owner_key_custody_qualified = $false
        deployment_performed = $false
        gate3_closed = $false
        release_status = 'NOT_RELEASE'
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($proofPath, ($proof | ConvertTo-Json -Depth 8), $utf8)
    Write-Output 'PASS - reviewed packet files match the pinned source and bundle.'
    Write-Output ('Review proof: ' + $proofPath)
    exit 0
} catch {
    $code = 'A2_PACKET_VERIFICATION_FAILED_HOLD'
    if ($_.Exception.Message -cmatch '^A2_[A-Z0-9_]+_HOLD$') { $code = $_.Exception.Message }
    Write-Output ('Packet verification stopped: ' + $code)
    exit 2
}
