#requires -Version 5.1
<#
MUSITU AXIOM Gate1 owner-operated Windows-only metadata preflight.
No Python/Ubuntu/WSL. Node 20+ required. Creates NOTHING at Cloudflare:
Only exact GET account identity, subscriptions, and D1 catalog for a newly
owner-created Free candidate. A successful metadata preflight is NEVER Gate1 GO.
NEVER enter token in chat, terminal arguments, scripts, or GitHub secrets.
#>
[CmdletBinding()]
param([string]$FreeAccountId)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$ptr=[IntPtr]::Zero
$hasOutputFolder=$false
$previous=$null
$working=$false
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_REQUIRED' }
    if ($env:CI -or $env:GITHUB_ACTIONS -or $env:TF_BUILD) { throw 'CLOUD_RUNNER_FORBIDDEN' }
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
        throw 'INTERACTIVE_OWNER_CONSOLE_REQUIRED'
    }
    $node=(Get-Command 'node.exe' -ErrorAction SilentlyContinue)
    if (-not $node) { throw 'NODE_20_PLUS_NOT_INSTALLED' }
    $version=(& node.exe --version)
    if ($version -notmatch '^v(\d+)\.') { throw 'NODE_VERSION_NOT_IDENTIFIED' }
    if ([int]$Matches[1] -lt 20) { throw 'NODE_20_PLUS_REQUIRED' }
    $src=Join-Path $PSScriptRoot 'customer_frontier\qualification\step1_gate1_free_isolated_account_readonly_20261114.mjs'
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw 'PINNED_PROVIDER_CHECKER_NOT_FOUND' }
    $expected='c31142df86b7d10f227938bd68c33e594799c7b963d5808085e1a4535252c733'
    $actual=(Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $expected) { throw 'PINNED_PROVIDER_CHECKER_SHA256_MISMATCH' }
    if (-not $FreeAccountId) { $FreeAccountId=Read-Host 'Enter ID of your NEW, separate Cloudflare Free account (32 lowercase hex characters)' }
    if ($FreeAccountId -cnotmatch '^[0-9a-f]{32}$') { throw 'NEW_ACCOUNT_ID_INVALID' }
    if ($FreeAccountId -ceq '93f395f5121954671f92fffa453d6b61') { throw 'PRODUCTION_ACCOUNT_REUSE_FORBIDDEN' }
    $base=Join-Path $env:LOCALAPPDATA 'AXIOM_GATE1_NEW_FREE_READONLY'
    if (-not (Test-Path -LiteralPath $base)) { [void][IO.Directory]::CreateDirectory($base) }
    $s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $base '/inheritance:r' '/grant:r' ('*{0}:(OI)(CI)F' -f $s) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'OWNER_ACL_SETUP_FAILED' }
    $run='receipt_'+[DateTime]::UtcNow.ToString('yyyyMMdd_HHmmssfff')
    $output=Join-Path $base $run
    if (Test-Path -LiteralPath $output) { throw 'EVIDENCE_ALREADY_EXISTS' }
    [void][IO.Directory]::CreateDirectory($output)
    & icacls.exe $output '/inheritance:r' '/grant:r' ('*{0}:(OI)(CI)F' -f $s) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'EVIDENCE_ACL_SETUP_FAILED' }
    $hasOutputFolder=$true
    Write-Host 'Enter the NEW Free-account READ-ONLY API token locally; text will be hidden.'
    $secure=Read-Host 'Read-only Cloudflare token' -AsSecureString
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'TOKEN_NOT_PROVIDED' }
    $env:AXIOM_GATE1_OWNER_FREE_ACCOUNT_ID=$FreeAccountId
    $env:AXIOM_GATE1_OWNER_FREE_ACCOUNT_READ_TOKEN=$token
    Push-Location -LiteralPath $output
    $working=$true
    & node.exe $src
    $status=$LASTEXITCODE
    Pop-Location
    $working=$false
    # Add an explicit file-level ACE (OI/CI directory ACE does not grant a leaf file).
    foreach($name in @('axiom_gate1_free_account_readonly_NO_GO_20261114.json','axiom_gate1_free_account_readonly_NO_GO_20261114.json.sha256')) {
        $f=Join-Path $output $name
        if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw 'NO_GO_RECEIPT_MISSING' }
        & icacls.exe $f '/inheritance:r' '/grant:r' ('*{0}:F' -f $s) | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'EVIDENCE_FILE_ACL_FAILED' }
    }
    if ($status -ne 0) { throw 'ISOLATED_FREE_ACCOUNT_METADATA_NOT_QUALIFIED' }
    $receipt=Get-Content -LiteralPath (Join-Path $output 'axiom_gate1_free_account_readonly_NO_GO_20261114.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.gate1_closed -ne $false -or $receipt.release_status -cne 'NOT_RELEASE' -or
        $receipt.d1_creation_authorized -ne $false -or $receipt.customer_restore_authorized -ne $false) {
        throw 'UNSAFE_NO_GO_RECEIPT_FLAGS'
    }
    Write-Host 'AXIOM_GATE1_SEPARATE_FREE_ACCOUNT_METADATA_ONLY_PASS_GATE1_STILL_OPEN_NOT_RELEASE'
    Write-Host ('Sanitized local evidence: '+$output)
    Write-Host 'No D1 creation, SQL, upload, spending or owner sign-off occurred.'
    exit 0
}
catch {
    [Console]::Error.WriteLine('AXIOM_GATE1_OWNER_WINDOWS_NO_GO:'+ $_.Exception.Message)
    [Console]::Error.WriteLine('No production, D1, payments or release authority. Existing keys unchanged.')
    exit 2
}
finally {
    if ($working) { Pop-Location -ErrorAction SilentlyContinue }
    Remove-Item Env:\AXIOM_GATE1_OWNER_FREE_ACCOUNT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\AXIOM_GATE1_OWNER_FREE_ACCOUNT_READ_TOKEN -ErrorAction SilentlyContinue
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $token=$null
    $secure=$null
}
