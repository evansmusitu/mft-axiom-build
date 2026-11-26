#requires -Version 5.1
# Offline owner declarations from the already collected private metadata names.
# Never a provider operation, key rotation, signing ceremony or custody certificate.
[CmdletBinding()]
param([switch]$InspectOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ReviewSourceCommit='@@SOURCE_COMMIT@@'
$ReceiptSha='fad4a419c0c8c9b47d3b132f00ad1b9a3c573ea8fd0c85913f74d58c19989365'
$ReceiptBytes=36515
function StopReview([string]$code){throw ('OWNER_REVIEW_STOPPED:'+ $code)}
function HashBytes([byte[]]$bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function NoReparse([string]$path){
 $current=[IO.Path]::GetFullPath($path)
 while($current){
  if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){StopReview 'REPARSE_PATH_REFUSED'}}
  $parent=[IO.Directory]::GetParent($current);if($null -eq $parent){break};$current=$parent.FullName
 }
}
function RequireOwnerOnlyAcl([string]$path){
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$acl=Get-Acl -LiteralPath $path
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid){StopReview 'RUN_AS_THE_ORIGINAL_WINDOWS_OWNER'}
 foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($r.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $r.IdentityReference.Value -notin @($sid,'S-1-5-18')){StopReview 'PRIVATE_INVENTORY_ACL_REVIEW_REQUIRED'}
 }
}
function ProtectDirectory([string]$path){
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
 foreach($allowed in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($allowed,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
 Set-Acl -LiteralPath $path -AclObject $acl
}
function ValidatePrivateSnapshot($snapshot,$private){
 if($snapshot.schema -cne 'musitu.axiom.gate3.owner-custody-provider-readback.v1' -or $snapshot.repository -cne 'evansmusitu/mft-axiom-build' -or $snapshot.account_id -cne '67469478aa9349fa0a57fe3a72da200a' -or $snapshot.collection_complete -ne $true){StopReview 'PUBLIC_RECEIPT_SCOPE_INVALID'}
 $keys=@($private.PSObject.Properties.Name|Sort-Object)
 if(($keys -join ',') -cne 'cloudflare_token_names,github_metadata_names'){StopReview 'PRIVATE_INVENTORY_SHAPE_INVALID'}
 $tokens=@($snapshot.user_tokens.rows);if($tokens.Count -ne 25 -or @($private.cloudflare_token_names).Count -ne 25){StopReview 'TOKEN_NAME_MAPPING_INCOMPLETE'}
 $tokenMap=@{};foreach($t in $private.cloudflare_token_names){
  if((@($t.PSObject.Properties.Name|Sort-Object) -join ',') -cne 'name,token_identifier_sha256' -or $t.token_identifier_sha256 -cnotmatch '^[a-f0-9]{64}$' -or $t.name -isnot [string] -or $t.name.Length -lt 1 -or $t.name.Length -gt 200 -or $t.name -match '[\x00-\x1f\x7f]' -or $tokenMap.ContainsKey($t.token_identifier_sha256)){StopReview 'TOKEN_NAME_MAPPING_INVALID'}
  $tokenMap[$t.token_identifier_sha256]=$t.name
 }
 foreach($t in $tokens){if(-not $tokenMap.ContainsKey($t.token_identifier_sha256)){StopReview 'TOKEN_NAME_MAPPING_MISMATCH'}}
 $scopes=@($snapshot.github.scopes);if(@($private.github_metadata_names).Count -ne $scopes.Count){StopReview 'GITHUB_NAME_MAPPING_INCOMPLETE'}
 $scopeMap=@{};foreach($s in $private.github_metadata_names){
  if((@($s.PSObject.Properties.Name|Sort-Object) -join ',') -cne 'kind,names,scope' -or $s.scope -cnotmatch '^(repository|environment:[a-f0-9]{64})$' -or $s.kind -cnotin @('secrets','variables')){StopReview 'GITHUB_NAME_MAPPING_INVALID'}
  $key=$s.scope+'/'+$s.kind;if($scopeMap.ContainsKey($key)){StopReview 'GITHUB_SCOPE_DUPLICATE'};$names=@($s.names)
  if($names.Count -gt 100 -or @($names|Sort-Object -Unique).Count -ne $names.Count){StopReview 'GITHUB_NAMES_DUPLICATE_OR_OVERSIZED'}
  foreach($n in $names){if($n -isnot [string] -or $n -cnotmatch '^[A-Z_][A-Z0-9_]{0,255}$'){StopReview 'GITHUB_NAME_INVALID'}}
  $scopeMap[$key]=$names
 }
 $known=@('AXIOM_D1_RECOVERY_CF_API_TOKEN','MUSITU_CLOUDFLARE_ADMIN_TOKEN','CLOUDFLARE_API_TOKEN','CLOUDFLARE_GLOBAL_API_KEY','CLOUDFLARE_API_KEY','MUSITU_CF_STAGING_READ_TOKEN','CLOUDFLARE_EMAIL')
 foreach($s in $scopes){
  $key=$s.scope+'/'+$s.kind;if(-not $scopeMap.ContainsKey($key) -or $scopeMap[$key].Count -ne $s.count){StopReview 'GITHUB_NAME_COUNT_MISMATCH'}
  $present=@($scopeMap[$key]|Where-Object {$_ -cin $known}|Sort-Object)
  if(($present -join ',') -cne (@($s.known_cloudflare_references_present|Sort-Object) -join ',')){StopReview 'KNOWN_GITHUB_NAME_MISMATCH'}
 }
 $reviewTokens=@($tokens|Where-Object {-not $_.known_build_reference}|Sort-Object token_identifier_sha256)
 $repoNames=@($scopeMap['repository/secrets']|Where-Object {$_ -cnotin $known}|Sort-Object)
 if($reviewTokens.Count -ne 23 -or $repoNames.Count -ne 25){StopReview 'RECONCILIATION_SET_MISMATCH'}
 return @{TokenNames=$tokenMap;ReviewTokens=$reviewTokens;GithubNames=$repoNames}
}
function ReadIndices([string]$prompt,[int]$count,[hashtable]$claimed){
 for($attempt=0;$attempt -lt 3;$attempt++){
  $text=ReadHiddenChoice $prompt;if(-not $text){return @()}
  if($text.Length -le 512 -and $text -match '^\s*\d+(\s*,\s*\d+)*\s*$'){
   $indices=@();$valid=$true
   foreach($v in ($text -split ',')){$n=0;if(-not [int]::TryParse($v.Trim(),[ref]$n) -or $n -lt 1 -or $n -gt $count -or $claimed.ContainsKey($n) -or $n -in $indices){$valid=$false;break};$indices+=$n}
   if($valid){foreach($n in $indices){$claimed[$n]=$true};return $indices}
  }
  Write-Host 'Use only distinct row numbers separated by commas, within the displayed list and not selected earlier. Never enter a credential.'
 }
 StopReview 'ROW_SELECTION_INVALID'
}
function ReadHiddenChoice([string]$prompt){
 $value=Read-Host ($prompt+' (typing hidden)') -AsSecureString;$pointer=[IntPtr]::Zero
 try{$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value);return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}
 finally{if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)};$value.Dispose()}
}
function ReadDeclaration([string]$prompt){
 for($attempt=0;$attempt -lt 3;$attempt++){$x=ReadHiddenChoice ($prompt+' [1=Yes, 2=No, Enter=Unknown]');if(-not $x){return 'UNKNOWN'};if($x -ceq '1'){return 'YES_OWNER_DECLARED'};if($x -ceq '2'){return 'NO_OWNER_DECLARED'};Write-Host 'Enter only 1, 2, or press Enter. No key or other text is needed.'}
 StopReview 'DECLARATION_CHOICE_INVALID'
}
function BuildReviewRecord($snapshot,$mapping,[hashtable]$tokenAnswers,[hashtable]$githubAnswers,[hashtable]$externalAnswers){
 $tokenKinds=@('OWNER_ONLY','BUILD_OR_DEPLOYER','OTHER_SHARED','UNKNOWN');$githubKinds=@('NON_CLOUDFLARE_PURPOSE_DECLARED','CLOUDFLARE_AUTH_OR_ALTERNATIVE','BACKUP_DECRYPTION_ONLY_DECLARED','UNKNOWN')
 $tokenRows=@();$githubRows=@();$i=0
 foreach($t in $mapping.ReviewTokens){$i++;$a='UNKNOWN';if($tokenAnswers.ContainsKey($i)){$a=$tokenAnswers[$i]};if($a -cnotin $tokenKinds){StopReview 'TOKEN_DECLARATION_INVALID'}
  $broad=@($t.policies|Where-Object {$_.effect -ceq 'allow' -and ($_.all_account_resource -or $_.explicit_a2_resource) -and $_.potential_write_or_execute_named_groups -gt 0}).Count -gt 0
  $tokenRows+=,[ordered]@{token_identifier_sha256=$t.token_identifier_sha256;owner_declared_storage=$a;snapshot_all_account_or_explicit_A2_write_named_allow=$broad;actual_custody_independently_verified=$false}
 }
 $i=0;foreach($n in $mapping.GithubNames){$i++;$a='UNKNOWN';if($githubAnswers.ContainsKey($i)){$a=$githubAnswers[$i]};if($a -cnotin $githubKinds){StopReview 'GITHUB_DECLARATION_INVALID'}
  $githubRows+=,[ordered]@{reference_name_identifier_sha256=(HashBytes ([Text.Encoding]::UTF8.GetBytes("github-secret-reference-name`n"+$n)));scope='repository/secrets';owner_declared_purpose=$a;secret_value_read=$false;contents_independently_verified=$false}
 }
 $external=[ordered]@{};foreach($key in @('current_owner_global_key_accessible_to_builders_or_services','other_A2_write_credentials_accessible_outside_private_custody','classification_checked_against_storage_and_consumer_records')){
  $a='UNKNOWN';if($externalAnswers.ContainsKey($key)){$a=$externalAnswers[$key]};if($a -cnotin @('YES_OWNER_DECLARED','NO_OWNER_DECLARED','UNKNOWN')){StopReview 'EXTERNAL_DECLARATION_INVALID'};$external[$key]=$a
 }
 return [ordered]@{schema='musitu.axiom.gate3.owner-private-inventory-declarations.v1';recorded_at_utc=[DateTimeOffset]::UtcNow.ToString('o');source_commit=$ReviewSourceCommit;owner_metadata_receipt_sha256=$ReceiptSha;owner_metadata_reported_at_utc=$snapshot.observed_at_utc;execution_origin='OWNER_LOCAL_DECLARATIONS_NOT_OS_OR_PROVIDER_ATTESTATION';provider_requests=0;github_requests=0;credential_values_requested=$false;credential_values_or_value_hashes_exported=$false;private_names_exported=$false;owner_token_declarations=$tokenRows;github_reference_declarations=$githubRows;external_inventory_declarations=$external;declaration_complete=(@($tokenRows|Where-Object {$_.owner_declared_storage -ceq 'UNKNOWN'}).Count -eq 0 -and @($githubRows|Where-Object {$_.owner_declared_purpose -ceq 'UNKNOWN'}).Count -eq 0 -and @($external.Values|Where-Object {$_ -ceq 'UNKNOWN'}).Count -eq 0);current_tokens_reverified=$false;credential_content_inventory_exhaustive=$false;global_key_custody_qualified=$false;independent_operator_custody_qualified=$false;effective_write_denial_verified=$false;private_genesis_retirement_or_hosted_recovery_performed=$false;gate3_closed=$false;B27='FAILED_IN_SYNTHETIC_ATTACK';parity_superiority='NOT_CERTIFIED';unavailable_final_usage='UNKNOWN';release_status='NOT_RELEASE';status='OWNER_DECLARATIONS_RECORDED_INDEPENDENT_REVIEW_REQUIRED'}
}
try{
 if($ReviewSourceCommit -cnotmatch '^[a-f0-9]{40}$'){StopReview 'SOURCE_PIN_INVALID'}
 if($InspectOnly){[ordered]@{status='OFFLINE_OWNER_REVIEW_PUBLIC_SOURCE_INSPECTION';source_commit=$ReviewSourceCommit;provider_requests=0;github_requests=0;private_inventory_read=$false;gate3_closed=$false;release_status='NOT_RELEASE'}|ConvertTo-Json -Compress;exit 0}
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $env:GITHUB_ACTIONS -or $env:CI -or [Console]::IsInputRedirected){StopReview 'OWNER_INTERACTIVE_WINDOWS_REQUIRED'}
 $local=[IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData));NoReparse $local
 $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($local));if($local.StartsWith('\\') -or $drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -cne 'NTFS'){StopReview 'LOCAL_FIXED_NTFS_REQUIRED'}
 $matchingRoots=@();foreach($folder in @(Get-ChildItem -LiteralPath $local -Directory -Filter 'MUSITU_AXIOM_CUSTODY_*'|Select-Object -First 100)){
  if($folder.Attributes -band [IO.FileAttributes]::ReparsePoint){continue};$candidate=Join-Path $folder.FullName 'RETURN_ONLY\OWNER_CUSTODY_PROVIDER_READBACK.json'
  if(-not (Test-Path -LiteralPath $candidate -PathType Leaf)){continue};NoReparse $candidate
  if((Get-Item -LiteralPath $candidate).Length -ne $ReceiptBytes){continue};$bytes=[IO.File]::ReadAllBytes($candidate)
  if((HashBytes $bytes) -ceq $ReceiptSha){$matchingRoots+=,$folder.FullName}
 }
 if($matchingRoots.Count -eq 0){StopReview 'ORIGINAL_COMPLETE_RECEIPT_NOT_FOUND_ON_THIS_PC'}
 $root=$matchingRoots[0];$publicPath=Join-Path $root 'RETURN_ONLY\OWNER_CUSTODY_PROVIDER_READBACK.json';$privatePath=Join-Path $root 'PRIVATE_GITHUB_METADATA_NAMES_DO_NOT_UPLOAD.json'
 NoReparse $privatePath;RequireOwnerOnlyAcl $root;RequireOwnerOnlyAcl $privatePath
 $raw=[IO.File]::ReadAllBytes($publicPath);if($raw.Length -ne $ReceiptBytes -or (HashBytes $raw) -cne $ReceiptSha){StopReview 'PUBLIC_RECEIPT_CHANGED'}
 if((Get-Item -LiteralPath $privatePath).Length -gt 262144){StopReview 'PRIVATE_INVENTORY_SIZE_LIMIT'}
 $snapshot=([Text.UTF8Encoding]::new($false,$true)).GetString($raw)|ConvertFrom-Json
 $private=Get-Content -LiteralPath $privatePath -Raw -Encoding UTF8|ConvertFrom-Json;$mapping=ValidatePrivateSnapshot $snapshot $private
 Write-Host 'OFFLINE private custody review. No internet, credential, signer key, login or permission change is needed.'
 Write-Host 'Names below stay on this PC. Review actual storage and consumers. Press Enter for anything unknown.'
 Write-Host 'First: Cloudflare tokens outside the pinned read-only build references. Asterisk means broad write-named allow policy in the collected snapshot.'
 $i=0;foreach($t in $mapping.ReviewTokens){$i++;$mark=' ';if(@($t.policies|Where-Object {$_.effect -ceq 'allow' -and ($_.all_account_resource -or $_.explicit_a2_resource) -and $_.potential_write_or_execute_named_groups -gt 0}).Count -gt 0){$mark='*'};Write-Host ('{0,2}. {1} {2}' -f $i,$mark,$mapping.TokenNames[$t.token_identifier_sha256])}
 $tokenAnswers=@{};$claimed=@{}
 foreach($spec in @(@('OWNER_ONLY','Rows whose token values are held ONLY by you privately (comma-separated numbers; Enter=none)'),@('BUILD_OR_DEPLOYER','Rows available to any GitHub/CI runner, deployer, service or agent'),@('OTHER_SHARED','Rows shared with another person or system outside the preceding categories'))){foreach($n in @(ReadIndices $spec[1] $mapping.ReviewTokens.Count $claimed)){$tokenAnswers[$n]=$spec[0]}}
 Write-Host 'Next: other GitHub repository-secret names. Do not retrieve or paste secret values.'
 $i=0;foreach($n in $mapping.GithubNames){$i++;Write-Host ('{0,2}. {1}' -f $i,$n)}
 $githubAnswers=@{};$claimed=@{}
 foreach($spec in @(@('NON_CLOUDFLARE_PURPOSE_DECLARED','Rows you can identify as unrelated to Cloudflare authentication'),@('CLOUDFLARE_AUTH_OR_ALTERNATIVE','Rows containing Cloudflare authentication or an alternative credential'),@('BACKUP_DECRYPTION_ONLY_DECLARED','Rows used only for backup decryption; do not rotate or delete them here'))){foreach($n in @(ReadIndices $spec[1] $mapping.GithubNames.Count $claimed)){$githubAnswers[$n]=$spec[0]}}
 $external=@{current_owner_global_key_accessible_to_builders_or_services=(ReadDeclaration 'Can any builder, runner, deployer, service or agent access your CURRENT owner Global API Key?');other_A2_write_credentials_accessible_outside_private_custody=(ReadDeclaration 'Are any OTHER A2 write credentials available outside private custody, including other repositories or machines?');classification_checked_against_storage_and_consumer_records=(ReadDeclaration 'Did you check these classifications against actual storage and consumer records?')}
 $record=BuildReviewRecord $snapshot $mapping $tokenAnswers $githubAnswers $external
 $out=Join-Path $local ('MUSITU_AXIOM_CUSTODY_REVIEW_'+[Guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($out);NoReparse $out;ProtectDirectory $out
 $return=Join-Path $out 'RETURN_ONLY';[void][IO.Directory]::CreateDirectory($return);ProtectDirectory $return
 $target=Join-Path $return 'OWNER_CUSTODY_RECONCILIATION.json';$bytes=([Text.UTF8Encoding]::new($false)).GetBytes(($record|ConvertTo-Json -Depth 12)+"`n")
 $stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
 Write-Host 'Saved owner declarations. Gate3 remains open for independent custody and provider acceptance.'
 Write-Host 'Return ONLY OWNER_CUSTODY_RECONCILIATION.json from the folder now opening. Keep the original private name file on this PC.'
 Invoke-Item -LiteralPath $return;[void](Read-Host 'Press Enter to close');exit 0
}catch{
 if($_.Exception.Message -cmatch '^OWNER_REVIEW_STOPPED:[A-Z0-9_]+$'){[Console]::Error.WriteLine($_.Exception.Message)}else{[Console]::Error.WriteLine('OWNER_PRIVATE_REVIEW_STOPPED_HOLD')}
 if(-not $InspectOnly -and -not $env:CI -and -not $env:GITHUB_ACTIONS -and -not [Console]::IsInputRedirected){[void](Read-Host 'Press Enter to close')};exit 2
}
