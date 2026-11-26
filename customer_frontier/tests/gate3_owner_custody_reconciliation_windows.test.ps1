#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Packet)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function AssertReview($condition,[string]$code){if(-not $condition){throw ('TEST_FAILED:'+ $code)}}
function ExpectReviewHold([scriptblock]$action){$caught=$false;try{& $action|Out-Null}catch{if($_.Exception.Message -cmatch '^OWNER_REVIEW_STOPPED:[A-Z0-9_]+$'){$caught=$true}else{throw}};AssertReview $caught 'EXPECTED_TYPED_HOLD'}
$source=Get-Content -LiteralPath $Packet -Raw -Encoding UTF8
$parseErrors=$null;$tokens=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
AssertReview ($parseErrors.Count -eq 0) 'NATIVE_PARSE'
AssertReview (-not ($source -match 'Invoke-(WebRequest|RestMethod)|Start-Process|HttpClient|DownloadString|gh\.exe|node\.exe')) 'NO_NETWORK_OR_RUNTIME_DEPENDENCY'
foreach($f in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($f.Extent.Text))}
$ReviewSourceCommit='a'*40;$ReceiptSha='fad4a419c0c8c9b47d3b132f00ad1b9a3c573ea8fd0c85913f74d58c19989365'
$receipt=Join-Path $PSScriptRoot '../evidence/gate3_owner_provider_readback_20261124/OWNER_CUSTODY_PROVIDER_READBACK_20261126_042347Z_COMPLETE_METADATA.json'
$snapshot=Get-Content -LiteralPath $receipt -Raw -Encoding UTF8|ConvertFrom-Json
$private=[ordered]@{cloudflare_token_names=@();github_metadata_names=@()};$i=0
foreach($t in $snapshot.user_tokens.rows){$i++;$private.cloudflare_token_names+=,[ordered]@{token_identifier_sha256=$t.token_identifier_sha256;name=('PRIVATE_TOKEN_LABEL_'+$i)}}
foreach($s in $snapshot.github.scopes){$names=@($s.known_cloudflare_references_present);for($j=$names.Count;$j -lt $s.count;$j++){$names+=('PRIVATE_GITHUB_LABEL_'+$j)};$private.github_metadata_names+=,[ordered]@{scope=$s.scope;kind=$s.kind;names=$names}}
$private=($private|ConvertTo-Json -Depth 15)|ConvertFrom-Json
$mapping=ValidatePrivateSnapshot $snapshot $private
AssertReview ($mapping.ReviewTokens.Count -eq 23 -and $mapping.GithubNames.Count -eq 25) 'ALL_UNPINNED_ROWS_INCLUDED'
$r=BuildReviewRecord $snapshot $mapping @{} @{} @{}
AssertReview (-not $r.declaration_complete -and $r.owner_token_declarations.Count -eq 23 -and $r.github_reference_declarations.Count -eq 25) 'UNANSWERED_ROWS_UNKNOWN'
AssertReview (@($r.owner_token_declarations|Where-Object {$_.snapshot_all_account_or_explicit_A2_write_named_allow}).Count -eq 2) 'BOTH_BROAD_TOKENS_PRESERVED'
$text=$r|ConvertTo-Json -Depth 15;AssertReview (-not $text.Contains('PRIVATE_TOKEN_LABEL_') -and -not $text.Contains('PRIVATE_GITHUB_LABEL_')) 'PRIVATE_NAMES_NOT_RETURNED'
$ta=@{};1..23|ForEach-Object {$ta[$_]='OWNER_ONLY'};$ga=@{};1..25|ForEach-Object {$ga[$_]='NON_CLOUDFLARE_PURPOSE_DECLARED'}
$external=@{current_owner_global_key_accessible_to_builders_or_services='NO_OWNER_DECLARED';other_A2_write_credentials_accessible_outside_private_custody='NO_OWNER_DECLARED';classification_checked_against_storage_and_consumer_records='YES_OWNER_DECLARED'}
$r=BuildReviewRecord $snapshot $mapping $ta $ga $external
AssertReview $r.declaration_complete 'COMPLETE_DECLARATIONS_RECORDED'
foreach($flag in @('gate3_closed','credential_content_inventory_exhaustive','global_key_custody_qualified','independent_operator_custody_qualified','effective_write_denial_verified','private_genesis_retirement_or_hosted_recovery_performed','current_tokens_reverified')){AssertReview ($r[$flag] -eq $false) ('NO_DECLARATION_AUTOPASS_'+$flag)}
AssertReview ($r.provider_requests -eq 0 -and $r.github_requests -eq 0 -and $r.B27 -ceq 'FAILED_IN_SYNTHETIC_ATTACK' -and $r.parity_superiority -ceq 'NOT_CERTIFIED' -and $r.unavailable_final_usage -ceq 'UNKNOWN') 'STATUS_AND_NO_PROVIDER_OPERATIONS'
ExpectReviewHold {BuildReviewRecord $snapshot $mapping @{1='TRUST_ME_PASS'} @{} @{}}
$copy=($private|ConvertTo-Json -Depth 15)|ConvertFrom-Json;$copy.cloudflare_token_names[1].token_identifier_sha256=$copy.cloudflare_token_names[0].token_identifier_sha256
ExpectReviewHold {ValidatePrivateSnapshot $snapshot $copy}
$copy=($private|ConvertTo-Json -Depth 15)|ConvertFrom-Json;$copy.github_metadata_names[0].names[5]=$copy.github_metadata_names[0].names[0]
ExpectReviewHold {ValidatePrivateSnapshot $snapshot $copy}
$copy=($private|ConvertTo-Json -Depth 15)|ConvertFrom-Json;$copy.github_metadata_names[0].names[0]='PRIVATE_WRONG_KNOWN_REFERENCE'
ExpectReviewHold {ValidatePrivateSnapshot $snapshot $copy}
$copy=($private|ConvertTo-Json -Depth 15)|ConvertFrom-Json;$copy.cloudflare_token_names[0].name="PRIVATE`nCONTROL"
ExpectReviewHold {ValidatePrivateSnapshot $snapshot $copy}
$script:reviewChoices=@('1,2','2,3','3','FAKE_CREDENTIAL_NEVER_ECHO','', '1','2','')
function ReadHiddenChoice([string]$prompt){$next=$script:reviewChoices[0];$script:reviewChoices=@($script:reviewChoices|Select-Object -Skip 1);return $next}
$claimed=@{};$first=@(ReadIndices 'test' 25 $claimed);$next=@(ReadIndices 'test' 25 $claimed)
AssertReview (($first -join ',') -ceq '1,2' -and ($next -join ',') -ceq '3') 'INDEX_SETS_DISJOINT_AFTER_RETRY'
$safeOutput=(& { $script:empty=@(ReadIndices 'test' 25 @{}) } 6>&1|Out-String)
AssertReview ($script:empty.Count -eq 0 -and -not $safeOutput.Contains('FAKE_CREDENTIAL_NEVER_ECHO')) 'INVALID_SELECTION_NEVER_ECHOED_OR_RECORDED'
AssertReview ((ReadDeclaration 'test') -ceq 'YES_OWNER_DECLARED') 'DECLARATION_YES'
AssertReview ((ReadDeclaration 'test') -ceq 'NO_OWNER_DECLARED') 'DECLARATION_NO'
AssertReview ((ReadDeclaration 'test') -ceq 'UNKNOWN') 'DECLARATION_DEFAULT_UNKNOWN'
$output=& $Packet -InspectOnly|Out-String;AssertReview ($LASTEXITCODE -eq 0) 'INSPECT_EXIT'
$inspection=$output|ConvertFrom-Json;AssertReview ($inspection.private_inventory_read -eq $false -and $inspection.provider_requests -eq 0 -and $inspection.github_requests -eq 0) 'INSPECT_BEFORE_PRIVATE_ACCESS'
$hostExe=(Get-Process -Id $PID).Path
$start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$hostExe;$start.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$Packet+'"';$start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.CreateNoWindow=$true
$p=[Diagnostics.Process]::new();$p.StartInfo=$start
try{AssertReview ($p.Start()) 'HOSTED_TEST_START';$out=$p.StandardOutput.ReadToEndAsync();$err=$p.StandardError.ReadToEndAsync();if(-not $p.WaitForExit(10000)){$p.Kill();throw 'HOSTED_TEST_DEADLINE'};$stdout=$out.GetAwaiter().GetResult();$stderr=$err.GetAwaiter().GetResult();AssertReview ($p.ExitCode -eq 2 -and $stderr.Contains('OWNER_INTERACTIVE_WINDOWS_REQUIRED') -and -not $stdout) 'HOSTED_FULL_MODE_REFUSED_BEFORE_PRIVATE_ACCESS'}finally{$p.Dispose()}
$folder=Join-Path $env:RUNNER_TEMP ('offline-review-acl-'+[Guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($folder);ProtectDirectory $folder;RequireOwnerOnlyAcl $folder
Write-Output ('OWNER_PRIVATE_REVIEW_NATIVE_PASS_PS_'+$PSVersionTable.PSVersion.Major+'_SYNTHETIC_DECLARATIONS_NOT_CUSTODY')
