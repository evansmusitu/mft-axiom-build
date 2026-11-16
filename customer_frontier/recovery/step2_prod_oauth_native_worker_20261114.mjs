/** Private transient preview. Only the recovered OAuth D1 is bound. */
import { PLAN, PLAN_SHA256 } from './step2_reviewed_oauth_plan_20261114.mjs';
const FAIL_TABLE = 'axiom_gate2_oauth_failure_20261114';
const ISSUER = 'https://axiom-gate2-oauth.example.invalid';
const SUBJECT_A = 'a'.repeat(64), SUBJECT_B = 'b'.repeat(64), WITNESS = 'c'.repeat(64);
const TENANT_A = 'axiom_gate2_oauth_a_20261114', TENANT_B = 'axiom_gate2_oauth_b_20261114';
export const TENANT_CASES = Object.freeze(['own_tenant_a', 'own_tenant_b', 'a_cannot_select_b_tenant',
  'b_cannot_select_a_tenant', 'unknown_subject_denied', 'unknown_issuer_denied', 'sql_injection_is_bound_value',
  'cross_customer_api_key_link_denied', 'own_customer_api_key_link_accepted', 'identity_binding_immutable',
  'linked_key_customer_immutable', 'revocation_updates_key_and_both_token_families',
  'unrelated_customer_active_counts_preserved', 'identity_revocation_terminal', 'linked_key_revocation_terminal']);
export const SAFE_FAILURE_CODES = Object.freeze(['CONSTRAINT_ENFORCEMENT_UNQUALIFIED','FOREIGN_KEY_VIOLATIONS','REVIEWED_VERSION_NOT_PRESENT',
  'FAILURE_FIXTURE_COLLISION','REVIEWED_PLAN_REJECTED_BEFORE_DELIBERATE_LATE_FAILURE','LATE_FAILURE_DDL_NOT_ROLLED_BACK',
  'PLAN_DRIFT','TENANT_OR_REVOCATION_ASSERTION_FAILED','COPIED_CUSTOMER_WITH_BOTH_TOKEN_FAMILIES_UNAVAILABLE',
  'DISTINCT_COPIED_CUSTOMER_UNAVAILABLE','IDENTITY_FIXTURE_COLLISION','REVOCATION_PRECONDITION_NOT_MET','TENANT_CASE_INVENTORY_INCOMPLETE',
  'NATIVE_SQL_OR_TRANSPORT_REJECTION']);
const SAFE_FAILURES = new Set(SAFE_FAILURE_CODES);
const must = (ok, code) => { if (!ok) throw new Error(code); };
const first = (db, sql, ...params) => db.prepare(sql).bind(...params).first();
const run = (db, sql, ...params) => db.prepare(sql).bind(...params).run();
const known = (error, phrase) => typeof error?.message === 'string' && error.message.includes(phrase);
async function enforcement(db) {
  must((await first(db, 'SELECT foreign_keys AS n FROM pragma_foreign_keys'))?.n === 1 &&
    (await first(db, 'SELECT ignore_check_constraints AS n FROM pragma_ignore_check_constraints'))?.n === 0,
  'CONSTRAINT_ENFORCEMENT_UNQUALIFIED');
}
export async function readUpgraded(db) {
  await enforcement(db);
  must((await first(db, 'SELECT count(*) AS n FROM pragma_foreign_key_check'))?.n === 0, 'FOREIGN_KEY_VIOLATIONS');
  must((await first(db, 'SELECT count(*) AS n FROM oauth_identity_schema_versions WHERE version=2 AND plan_sha256=?', PLAN_SHA256))?.n === 1,
    'REVIEWED_VERSION_NOT_PRESENT');
  return { status: 'UPGRADED_COPY_STATE_VERIFIED', statement_count: PLAN.length,
    plan_sha256: PLAN_SHA256, foreign_keys: 1, check_constraints: 0, violations: 0 };
}
export async function lateFailure(db) {
  await enforcement(db);
  must((await first(db, 'SELECT count(*) AS n FROM sqlite_schema WHERE name=?', FAIL_TABLE))?.n === 0, 'FAILURE_FIXTURE_COLLISION');
  let expectedFailure = false;
  try {
    await db.batch([db.prepare(`CREATE TABLE ${FAIL_TABLE}(ok INTEGER NOT NULL)`),
      ...PLAN.map(sql => db.prepare(sql)), db.prepare(`INSERT INTO ${FAIL_TABLE}(ok) VALUES(NULL)`)]);
  } catch (error) { expectedFailure = known(error, 'NOT NULL constraint failed: ' + FAIL_TABLE + '.ok'); }
  must(expectedFailure, 'REVIEWED_PLAN_REJECTED_BEFORE_DELIBERATE_LATE_FAILURE');
  must((await first(db, 'SELECT count(*) AS n FROM sqlite_schema WHERE name=?', FAIL_TABLE))?.n === 0,
    'LATE_FAILURE_DDL_NOT_ROLLED_BACK');
  return { status: 'REVIEWED_PLAN_LATE_FAILURE_ROLLED_BACK', statement_count: PLAN.length, plan_sha256: PLAN_SHA256 };
}
export async function applyReviewed(db) {
  await enforcement(db);
  must(PLAN.length === 89 && PLAN_SHA256 === '6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a', 'PLAN_DRIFT');
  await db.batch(PLAN.map(sql => db.prepare(sql)));
  const state = await readUpgraded(db);
  return { ...state, status: 'REVIEWED_PLAN_APPLIED_IN_ONE_NATIVE_BATCH' };
}
export async function concurrentReviewed(db) {
  await enforcement(db);
  await Promise.all([db.batch(PLAN.map(sql=>db.prepare(sql))),db.batch(PLAN.map(sql=>db.prepare(sql)))]);
  return {...await readUpgraded(db),status:'REVIEWED_PLAN_CONCURRENT_BATCHES_VERIFIED',concurrent_batches:2};
}
export async function tenantAndRevocation(db) {
  await readUpgraded(db);
  const r = { tests: [], recovered_customer_rows_used: 0, fixture_principals_only: true, real_customer_login_qualified: false };
  const pass = (name, ok) => { must(ok, 'TENANT_OR_REVOCATION_ASSERTION_FAILED'); r.tests.push({ name, result: 'PASS' }); };
  const denied = async (fn, phrase) => { let refused = false; try { await fn(); } catch (error) { refused = known(error, phrase); } return refused; };
  const a = await first(db, `SELECT c.id AS customer_id,k.id AS key_id FROM customers c JOIN api_keys k ON k.customer_id=c.id
    WHERE c.status='active' AND k.status='active' AND NOT EXISTS(SELECT 1 FROM oauth_identity_links l WHERE l.customer_id=c.id)
    AND EXISTS(SELECT 1 FROM oauth_access_tokens t WHERE t.api_key_id=k.id AND t.revoked_at IS NULL)
    AND EXISTS(SELECT 1 FROM oauth_refresh_tokens t WHERE t.api_key_id=k.id AND t.revoked_at IS NULL)
    ORDER BY c.id,k.id LIMIT 1`);
  must(typeof a?.customer_id === 'string' && typeof a?.key_id === 'string', 'COPIED_CUSTOMER_WITH_BOTH_TOKEN_FAMILIES_UNAVAILABLE');
  const b = await first(db, `SELECT c.id AS customer_id,k.id AS key_id FROM customers c JOIN api_keys k ON k.customer_id=c.id
    WHERE c.status='active' AND k.status='active' AND c.id<>? AND NOT EXISTS(SELECT 1 FROM oauth_identity_links l WHERE l.customer_id=c.id)
    ORDER BY c.id,k.id LIMIT 1`, a.customer_id);
  must(typeof b?.customer_id === 'string' && typeof b?.key_id === 'string' && a.customer_id !== b.customer_id,
    'DISTINCT_COPIED_CUSTOMER_UNAVAILABLE');
  must((await first(db, 'SELECT count(*) AS n FROM oauth_identity_links WHERE issuer=?', ISSUER))?.n === 0, 'IDENTITY_FIXTURE_COLLISION');
  r.recovered_customer_rows_used = 2;
  const beforeB = await first(db, `SELECT
    (SELECT count(*) FROM api_keys WHERE customer_id=? AND status='active') AS active_keys,
    (SELECT count(*) FROM oauth_access_tokens WHERE customer_id=? AND revoked_at IS NULL) AS access_tokens,
    (SELECT count(*) FROM oauth_refresh_tokens WHERE customer_id=? AND revoked_at IS NULL) AS refresh_tokens`, b.customer_id,b.customer_id,b.customer_id);
  const seed = 'INSERT INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256) VALUES(?,?,?,?,?)';
  await db.batch([db.prepare(seed).bind(ISSUER,SUBJECT_A,TENANT_A,a.customer_id,WITNESS),
    db.prepare(seed).bind(ISSUER,SUBJECT_B,TENANT_B,b.customer_id,WITNESS)]);
  const lookup = async (subject, tenant, issuer=ISSUER) => (await first(db, `SELECT count(*) AS n FROM oauth_identity_links l
    JOIN customers c ON c.id=l.customer_id WHERE l.issuer=? AND l.subject_sha256=? AND l.tenant_id=? AND l.state='active' AND c.status='active'`, issuer,subject,tenant))?.n;
  pass(TENANT_CASES[0],await lookup(SUBJECT_A,TENANT_A)===1);
  pass(TENANT_CASES[1],await lookup(SUBJECT_B,TENANT_B)===1);
  pass(TENANT_CASES[2],await lookup(SUBJECT_A,TENANT_B)===0);
  pass(TENANT_CASES[3],await lookup(SUBJECT_B,TENANT_A)===0);
  pass(TENANT_CASES[4],await lookup('d'.repeat(64),TENANT_A)===0);
  pass(TENANT_CASES[5],await lookup(SUBJECT_A,TENANT_A,'https://unrecognized.example.invalid')===0);
  pass(TENANT_CASES[6],await lookup(SUBJECT_A,"tenant-' OR 1=1 --")===0);
  const tokenLink = 'INSERT INTO oauth_identity_token_links(api_key_id,issuer,subject_sha256,customer_id,tenant_id) VALUES(?,?,?,?,?)';
  pass(TENANT_CASES[7],await denied(()=>run(db,tokenLink,a.key_id,ISSUER,SUBJECT_B,b.customer_id,TENANT_B),'identity_token_link_not_active'));
  await run(db,tokenLink,a.key_id,ISSUER,SUBJECT_A,a.customer_id,TENANT_A);
  pass(TENANT_CASES[8],(await first(db,'SELECT count(*) AS n FROM oauth_identity_token_links WHERE api_key_id=? AND customer_id=?',a.key_id,a.customer_id))?.n===1);
  pass(TENANT_CASES[9],await denied(()=>run(db,'UPDATE oauth_identity_links SET tenant_id=? WHERE issuer=? AND subject_sha256=?',TENANT_B,ISSUER,SUBJECT_A),'identity_link_immutable'));
  pass(TENANT_CASES[10],await denied(()=>run(db,'UPDATE api_keys SET customer_id=? WHERE id=?',b.customer_id,a.key_id),'oauth_linked_parent_immutable'));
  const activeA = await first(db, `SELECT
    (SELECT count(*) FROM oauth_access_tokens WHERE api_key_id=? AND revoked_at IS NULL) AS access_tokens,
    (SELECT count(*) FROM oauth_refresh_tokens WHERE api_key_id=? AND revoked_at IS NULL) AS refresh_tokens`,a.key_id,a.key_id);
  must(activeA.access_tokens>0 && activeA.refresh_tokens>0,'REVOCATION_PRECONDITION_NOT_MET');
  await run(db,"UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP WHERE issuer=? AND subject_sha256=?",ISSUER,SUBJECT_A);
  const revoked = await first(db,`SELECT
    (SELECT count(*) FROM api_keys WHERE id=? AND status='revoked') AS revoked_keys,
    (SELECT count(*) FROM oauth_access_tokens WHERE api_key_id=? AND revoked_at IS NULL) AS access_tokens,
    (SELECT count(*) FROM oauth_refresh_tokens WHERE api_key_id=? AND revoked_at IS NULL) AS refresh_tokens`,a.key_id,a.key_id,a.key_id);
  pass(TENANT_CASES[11],revoked.revoked_keys===1 && revoked.access_tokens===0 && revoked.refresh_tokens===0);
  const afterB = await first(db,`SELECT
    (SELECT count(*) FROM api_keys WHERE customer_id=? AND status='active') AS active_keys,
    (SELECT count(*) FROM oauth_access_tokens WHERE customer_id=? AND revoked_at IS NULL) AS access_tokens,
    (SELECT count(*) FROM oauth_refresh_tokens WHERE customer_id=? AND revoked_at IS NULL) AS refresh_tokens`,b.customer_id,b.customer_id,b.customer_id);
  pass(TENANT_CASES[12],JSON.stringify(beforeB)===JSON.stringify(afterB) && beforeB.active_keys>0);
  pass(TENANT_CASES[13],await denied(()=>run(db,"UPDATE oauth_identity_links SET state='active',revoked_at=NULL WHERE issuer=? AND subject_sha256=?",ISSUER,SUBJECT_A),'identity_link_reactivation_forbidden'));
  pass(TENANT_CASES[14],await denied(()=>run(db,"UPDATE api_keys SET status='active',revoked_at=NULL WHERE id=?",a.key_id),'oauth_linked_key_revocation_terminal'));
  must(r.tests.length===TENANT_CASES.length,'TENANT_CASE_INVENTORY_INCOMPLETE');
  return {...r,status:'RECOVERED_OAUTH_TENANT_AND_REVOCATION_CHECKS_VERIFIED',statement_count:PLAN.length,plan_sha256:PLAN_SHA256};
}
export default {
  async fetch(request,env) {
    if(request.method!=='POST'||new URL(request.url).pathname!=='/gate2/prod-oauth'||
      typeof env.GATE2_PROBE_KEY!=='string'||env.GATE2_PROBE_KEY.length!==64||
      request.headers.get('authorization')!=='Bearer '+env.GATE2_PROBE_KEY) return new Response(null,{status:404});
    let body;try{const raw=await request.text();if(raw.length>200)throw new Error();body=JSON.parse(raw);}catch{return new Response(null,{status:400});}
    if(!body||Object.keys(body).join('|')!=='operation')return new Response(null,{status:400});
    let output;
    try {
      if(body.operation==='late-failure')output=await lateFailure(env.RECOVERY_DB);
      else if(body.operation==='apply-reviewed-plan')output=await applyReviewed(env.RECOVERY_DB);
      else if(body.operation==='concurrent-reviewed-plan')output=await concurrentReviewed(env.RECOVERY_DB);
      else if(body.operation==='read-after-upgrade')output=await readUpgraded(env.RECOVERY_DB);
      else if(body.operation==='tenant-revocation-tests')output=await tenantAndRevocation(env.RECOVERY_DB);
      else return new Response(null,{status:400});
    } catch (error) { output={status:'RECOVERED_OAUTH_NATIVE_OPERATION_NOT_QUALIFIED',failure_stage:body.operation,
      failure_code:SAFE_FAILURES.has(error?.message)?error.message:'NATIVE_SQL_OR_TRANSPORT_REJECTION'}; }
    return Response.json({...output,schema:'musitu.axiom.production-oauth-native-worker-result.v1',
      preview_instance_tag:env.GATE2_INSTANCE_TAG,release_status:'NOT_RELEASE'}, {
      status:output.status==='RECOVERED_OAUTH_NATIVE_OPERATION_NOT_QUALIFIED'?409:200,
      headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
  }
};
