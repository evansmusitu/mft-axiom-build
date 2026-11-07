// Controlled qualification fixtures only. These are NOT customers or payment evidence.
export const RUN='axiom-customer-acceptance-20261107-01';
export const DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
export const MARKER='axiom_cq02_backend_fixture_receipt';
export const A=RUN+'-alpha',B=RUN+'-beta';
export const IA=A+'-identity',IB=B+'-identity';
export const SA=A+'-controlled-fixture-not-idp',SB=B+'-controlled-fixture-not-idp';
// Single-statement create+row fences a delayed initial seed. Either this CREATE
// wins or the seed batch CREATE wins; the losing CREATE cannot overwrite data.
export const CANCEL_SQL=`CREATE TABLE ${MARKER} AS SELECT '${RUN}' AS run_id,? AS ownership_sha256,'CANCELLED' AS phase,'' AS baseline_sha256,NULL AS project_a,NULL AS project_b,NULL AS hold_id`;
// Every predicate is fixed to this run. Never erase rows or reverse a schema.
export const DISABLE_SQL=[
 `UPDATE customer_idp_sessions_v1 SET status='revoked',session_version=session_version+1 WHERE subject IN ('${SA}','${SB}') AND status='active'`,
 `UPDATE memberships SET status='revoked' WHERE (tenant_id='${A}' AND identity_id='${IA}') OR (tenant_id='${B}' AND identity_id='${IB}')`,
 `UPDATE canonical_customer_links SET status='revoked' WHERE (tenant_id='${A}' AND identity_id='${IA}') OR (tenant_id='${B}' AND identity_id='${IB}')`,
 `UPDATE tenants SET status='suspended' WHERE id IN ('${A}','${B}')`,
 `UPDATE holds SET state='released' WHERE tenant_id IN ('${A}','${B}') AND state='open'`
];
export const DISABLED_SQL=`SELECT
 (SELECT count(*) FROM customer_idp_sessions_v1 WHERE subject IN ('${SA}','${SB}') AND status='active')+
 (SELECT count(*) FROM memberships WHERE tenant_id IN ('${A}','${B}') AND status='active')+
 (SELECT count(*) FROM canonical_customer_links WHERE tenant_id IN ('${A}','${B}') AND status='active')+
 (SELECT count(*) FROM tenants WHERE id IN ('${A}','${B}') AND status='active')+
 (SELECT count(*) FROM holds WHERE tenant_id IN ('${A}','${B}') AND state='open') AS n`;
export const LIMITS=Object.freeze({real_identity_qualified:false,production_ownership_qualified:false,onboarding_qualified:false,chatgpt_continuity_qualified:false,payment_qualified:false,hosted_restore_qualified:false,production_oauth_changed:false,customer_acceptance_qualified:false,release_authority:false});
