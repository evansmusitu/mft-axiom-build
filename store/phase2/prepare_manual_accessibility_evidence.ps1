[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RecordingPath,

    [Parameter(Mandatory = $true)]
    [string]$Reference,

    [ValidateSet('Edge','Chrome','Firefox')]
    [string]$Browser = 'Edge',

    [string]$OutputPath = '',

    [string]$ScreenReaderName = 'Microsoft Narrator',

    [string]$ScreenReaderVersion = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-BrowserExecutable {
    param([string]$Name)
    $candidates = switch ($Name) {
        'Edge' {
            @(
                "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
                "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
                "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
            )
        }
        'Chrome' {
            @(
                "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
            )
        }
        'Firefox' {
            @(
                "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
                "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
            )
        }
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    $commandName = switch ($Name) {
        'Edge' { 'msedge.exe' }
        'Chrome' { 'chrome.exe' }
        'Firefox' { 'firefox.exe' }
    }
    $cmd = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "Could not locate $Name. Supply a supported installed browser or record its version manually in the packet."
}

function Get-MediaType {
    param([string]$Path)
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.mp4' { return 'video/mp4' }
        '.mov' { return 'video/quicktime' }
        '.mkv' { return 'video/x-matroska' }
        '.webm' { return 'video/webm' }
        default { return 'application/octet-stream' }
    }
}

$recording = Get-Item -LiteralPath $RecordingPath
if ($recording.PSIsContainer) { throw 'RecordingPath must be a file.' }
if ($recording.Length -le 0) { throw 'Recording file is empty.' }

if ([string]::IsNullOrWhiteSpace($Reference)) { throw 'Reference must be non-empty.' }
if ($Reference -match '(?i)todo|tbd|pending|placeholder|replace-me|example') {
    throw 'Reference looks like a placeholder. Upload the original recording first and supply its stable reference.'
}

$hash = (Get-FileHash -LiteralPath $recording.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -notmatch '^[0-9a-f]{64}$') { throw 'Unexpected SHA-256 output.' }

$os = Get-CimInstance Win32_OperatingSystem
$osVersion = "$($os.Caption) version $($os.Version) build $($os.BuildNumber)"
$deviceClass = (Get-CimInstance Win32_ComputerSystem).Model

$browserExe = Resolve-BrowserExecutable -Name $Browser
$browserFile = Get-Item -LiteralPath $browserExe
$browserVersion = $browserFile.VersionInfo.ProductVersion
if ([string]::IsNullOrWhiteSpace($browserVersion)) { $browserVersion = $browserFile.VersionInfo.FileVersion }
if ([string]::IsNullOrWhiteSpace($browserVersion)) { throw 'Browser version could not be determined.' }

if ([string]::IsNullOrWhiteSpace($ScreenReaderVersion)) {
    # Narrator ships as a Windows component. Use the exact Windows build as the
    # reproducible component-version basis when Narrator exposes no separate UI version.
    $ScreenReaderVersion = "Windows component basis: $($os.Version) build $($os.BuildNumber)"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $recording.DirectoryName 'MUSITU_STORE_PHASE2_ACCESSIBILITY_EVIDENCE_METADATA.json'
}
if ([IO.Path]::IsPathRooted($OutputPath)) {
    $outputFullPath = [IO.Path]::GetFullPath($OutputPath)
} else {
    $outputFullPath = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $OutputPath))
}
$outputDirectory = Split-Path -Parent $outputFullPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$manifestItem = [ordered]@{
    reference = $Reference
    sha256 = $hash
    bytes = [int64]$recording.Length
    media_type = Get-MediaType -Path $recording.FullName
    captured_at_utc = $recording.CreationTimeUtc.ToString('o')
}

$out = [ordered]@{
    schema = 'musitu.store.phase2.manual_accessibility_capture_metadata.v1'
    generated_at_utc = [DateTime]::UtcNow.ToString('o')
    source_recording = [ordered]@{
        file_name = $recording.Name
        local_path_not_for_public_packet = $recording.FullName
        file_created_utc = $recording.CreationTimeUtc.ToString('o')
        file_last_write_utc = $recording.LastWriteTimeUtc.ToString('o')
        sha256 = $hash
        bytes = [int64]$recording.Length
        media_type = $manifestItem.media_type
        stable_reference = $Reference
    }
    suggested_test_environment = [ordered]@{
        platform = 'Windows'
        os_version = $osVersion
        device_model_class = $deviceClass
        browser_name = $Browser
        browser_version = $browserVersion
        screen_reader_name = $ScreenReaderName
        screen_reader_version = $ScreenReaderVersion
        production_url = 'https://payments.mftintelligence.com/store'
        store_version_under_test = '1.0.2'
        test_started_at_utc = $recording.CreationTimeUtc.ToString('o')
        test_completed_at_utc = $recording.LastWriteTimeUtc.ToString('o')
    }
    evidence_manifest_item = $manifestItem
    required_evidence_reference_examples = [ordered]@{
        continuous_recording_reference = "$Reference#t=00:00:00-end"
        keyboard_navigation_recording_or_screenshot_reference = "$Reference#t=<keyboard-start>-<keyboard-end>"
        screen_reader_heading_landmark_reference = "$Reference#t=<headings-landmarks-start>-<headings-landmarks-end>"
        screen_reader_install_route_reference = "$Reference#t=<install-start>-<install-end>"
        screen_reader_low_bandwidth_reference = "$Reference#t=<lite-start>-<lite-end>"
        zoom_reflow_reference = "$Reference#t=<zoom-start>-<zoom-end>"
        tester_notes_reference = 'packet://tester_notes'
    }
    warning = 'This helper fingerprints evidence and gathers environment metadata only. It does not mark any accessibility check PASS and does not substitute for original-evidence review.'
}

$json = $out | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($outputFullPath, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))

Write-Host 'MUSITU_STORE_PHASE2_ACCESSIBILITY_EVIDENCE_METADATA=CREATED'
Write-Host "Output: $outputFullPath"
Write-Host "Recording SHA-256: $hash"
Write-Host "Recording bytes: $($recording.Length)"
Write-Host "Browser: $Browser $browserVersion"
Write-Host "OS: $osVersion"
Write-Host "Screen reader: $ScreenReaderName ($ScreenReaderVersion)"
