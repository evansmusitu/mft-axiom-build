/** Single-purpose GitHub Actions CLI: GET-only live authority inspection. */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {auditLiveMmfPaynowScope} from './audit-live-paynow-merchant-scope.mjs';
const branch='product/musitu-mail-fabric-isolated-20261009';
if(process.env.GITHUB_REF_NAME!==branch||!process.env.RUNNER_TEMP){
 console.error('MMF_PAYNOW_READONLY_WORKFLOW_GUARD_DENIED');process.exit(2);
}
try{
 const proof=await auditLiveMmfPaynowScope({
  accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN
 });
 const report={...proof,checkedAtUtc:new Date().toISOString(),
  gate:'MMF_SHARED_PAYNOW_PRODUCT_SCOPE_READONLY',
  confirmedRealMoneyEligible:false};
 writeFileSync(join(process.env.RUNNER_TEMP,'mmf-live-paynow-scope-readonly.json'),
  JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({gate:report.gate,observedWorkerCount:report.observedWorkerCount,
  verifiedExistingMerchantStack:report.verifiedExistingMerchantStack,
  sourceReadbackStableAcrossReads:report.sourceReadbackStableAcrossReads,
  sourceHashDriftIndependentlyProven:report.sourceHashDriftIndependentlyProven,
  changedSharedWorkers:report.changedSharedWorkers,
  mmfPaymentAuthorityBound:report.mmfPaymentAuthorityBound,
  missingCapabilities:report.missingCapabilities,
  realProviderPollCertified:false,eligibleForPaidActivation:false,
  cloudflareMethod:'GET',cloudflareMutations:false,customerFunds:false,customerEmail:false}));
}catch{
 console.error('MMF_PAYNOW_READONLY_WORKFLOW_VERIFICATION_FAILED');process.exit(1);
}
