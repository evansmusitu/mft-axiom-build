/**
 * AXIOM Track B: zero-cash qualification-mode admission.
 * Only isolated *local* workerd tests are automatically admitted. Real
 * Cloudflare preview/staging require separate reviewed S3 authorization,
 * provider-native Free-plan, identity, spend and nonpublic ingress evidence.
 * Legacy wrangler dev --remote is specifically not valid for SQLite-backed
 * Durable Object qualification per Cloudflare's official docs (2026-10).
 *
 * This gate never issues remote authority, credentials or release approval.
 */
export class UnsafeQualificationMode extends Error {
  constructor(){super('SQLITE_DO_QUALIFICATION_MODE_NOT_AUTHORIZED');}
}
const REQUIRED = [
  'runtime','storage','isolated','publicRoutes','workerDev','customerData',
  'cashBudgetUsd'
];
export function selectSqliteDOQualification(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',')!==REQUIRED.slice().sort().join(','))
    throw new UnsafeQualificationMode();
  if(input.runtime!=='local_workerd' ||
      input.storage!=='sqlite_durable_object' ||
      input.isolated!==true || input.publicRoutes!==0 ||
      input.workerDev!==false || input.customerData!==false ||
      input.cashBudgetUsd!=='0.00')
    throw new UnsafeQualificationMode();
  return Object.freeze({
    schema:'musitu.axiom.public_inference.sqlite_do_qualification_mode.v1',
    mode:'LOCAL_WORKERD_ONLY',
    remoteNativeQuotaProven:false,
    customerReleaseAuthorized:false,
    billableActionsAuthorized:false,
    publicRoutesAuthorized:false,
    externalModelCallsAuthorized:false,
    independentSecurityCertification:false,
  });
}
