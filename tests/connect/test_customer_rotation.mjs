/** Synthetic-only D1-compatible atomic rotation; never commercial admission evidence. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {provisionOfflineTenant,issueOfflineCredential,rotateOfflineCredential}
  from '../../connect/customer_provisioning.mjs';
import {reserveConnectCustomerRequest} from '../../connect/customer_admission.mjs';

const schema=readFileSync(new URL('../../infra/connect_customer_registry.sql',import.meta.url),'utf8');
const now=Date.parse('2026-10-22T12:00:00Z');
const expiresAt='2026-11-01T12:00:00Z';
const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(schema);
  const db={
    prepare(query){return {bind(...params){return {
      query,params,
      async first(){return sql.prepare(query).get(...params)??null;},
    }}}},
    async batch(commands){
      sql.exec('BEGIN');
      try {
        const results=commands.map(({query,params})=>({results:sql.prepare(query).all(...params)}));
        sql.exec('COMMIT');
        return results;
      } catch(error){sql.exec('ROLLBACK');throw error;}
    },
  };
  const env={CONNECT_CUSTOMER_PROVISIONING_MODE:'isolated-synthetic-only',
    CONNECT_CUSTOMER_RUNTIME_ENABLED:'true',CONNECT_CUSTOMER_DB:db};
  const issue=async tenantId=>{
    const value=await issueOfflineCredential({env,tenantId,scopes:['mining.plan'],nowMs:now,expiresAt});
    assert.equal(value.ok,true);
    return value;
  };
  const rotate=(credentialId,tenantId='tenant_alpha')=>rotateOfflineCredential({
    env,tenantId,credentialId,scopes:['mining.risk'],nowMs:now,expiresAt,
  });
  const seed=async tenantId=>{
    const value=await provisionOfflineTenant({env,tenantId,dailyLimit:4,minuteLimit:4});
    assert.equal(value.ok,true);
  };
  return {sql,env,seed,issue,rotate};
}

test('synthetic credential rotation atomically revokes the old token and changes its scope',async()=>{
  const f=fixture();
  try {
    await f.seed('tenant_alpha');
    const old=await f.issue('tenant_alpha');
    const fresh=await f.rotate(old.credential_id);
    assert.equal(fresh.ok,true);
    assert.equal(fresh.rotated_credential_id,old.credential_id);
    assert.match(fresh.bearer_token,/^mct_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(fresh.bearer_token,old.bearer_token);
    assert.notEqual(fresh.credential_id,old.credential_id);
    assert.equal(f.sql.prepare('SELECT status FROM connect_customer_credentials WHERE credential_id=?')
      .get(old.credential_id).status,'revoked');
    assert.deepEqual({...f.sql.prepare('SELECT status,can_plan,can_risk FROM connect_customer_credentials WHERE credential_id=?')
      .get(fresh.credential_id)},{status:'active',can_plan:0,can_risk:1});
    assert.deepEqual(await reserveConnectCustomerRequest({env:f.env,
      authorization:'Bearer '+old.bearer_token,scope:'mining.plan',nowMs:now,
      requestIdFactory:()=>requestId}),{ok:false,status:401,error:'UNAUTHORIZED'});
    const allowed=await reserveConnectCustomerRequest({env:f.env,
      authorization:'Bearer '+fresh.bearer_token,scope:'mining.risk',nowMs:now,
      requestIdFactory:()=>requestId});
    assert.equal(allowed.ok,true);
    assert.equal(allowed.principal.credential_id,fresh.credential_id);
  } finally {f.sql.close();}
});

test('cross-tenant, unknown, revoked and concurrent rotations cannot mint extra active tokens',async()=>{
  const f=fixture();
  try {
    await f.seed('tenant_alpha');await f.seed('tenant_beta');
    const old=await f.issue('tenant_alpha');
    assert.deepEqual(await f.rotate(old.credential_id,'tenant_beta'),
      {ok:false,status:404,error:'ACTIVE_CREDENTIAL_NOT_FOUND'});
    assert.deepEqual(await f.rotate('cred_missing'),
      {ok:false,status:404,error:'ACTIVE_CREDENTIAL_NOT_FOUND'});
    const results=await Promise.all([f.rotate(old.credential_id),f.rotate(old.credential_id)]);
    assert.equal(results.filter(x=>x.ok).length,1);
    assert.equal(results.filter(x=>x.error==='ACTIVE_CREDENTIAL_NOT_FOUND').length,1);
    assert.deepEqual(await f.rotate(old.credential_id),
      {ok:false,status:404,error:'ACTIVE_CREDENTIAL_NOT_FOUND'});
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM connect_customer_credentials').get().n,2);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM connect_customer_credentials WHERE status='active'").get().n,1);
  } finally {f.sql.close();}
});

test('disabled rotation and failed SQL revocation never disclose or persist replacement token',async()=>{
  const f=fixture();
  try {
    await f.seed('tenant_alpha');
    const old=await f.issue('tenant_alpha');
    const opts={env:f.env,tenantId:'tenant_alpha',credentialId:old.credential_id,
      scopes:['mining.risk'],nowMs:now,expiresAt};
    assert.deepEqual(await rotateOfflineCredential({...opts,env:{...f.env,
      CONNECT_CUSTOMER_PROVISIONING_MODE:'disabled'}}),
      {ok:false,status:503,error:'PROVISIONING_DISABLED'});
    assert.deepEqual(await rotateOfflineCredential({...opts,env:{...f.env,
      CONNECT_CUSTOMER_DB:{prepare:f.env.CONNECT_CUSTOMER_DB.prepare}}}),
      {ok:false,status:503,error:'PROVISIONING_UNAVAILABLE'});
    f.sql.exec("CREATE TRIGGER deny_rotation BEFORE UPDATE ON connect_customer_credentials " +
      "BEGIN SELECT RAISE(ABORT,'PRIVATE_TOKEN_MUST_NOT_LEAK'); END");
    const failed=await rotateOfflineCredential(opts);
    assert.deepEqual(failed,{ok:false,status:503,error:'PROVISIONING_UNAVAILABLE'});
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM connect_customer_credentials').get().n,1);
    assert.equal(f.sql.prepare('SELECT status FROM connect_customer_credentials WHERE credential_id=?')
      .get(old.credential_id).status,'active');
  } finally {f.sql.close();}
});
