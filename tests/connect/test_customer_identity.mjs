import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyConnectCustomerBearer } from '../../connect/customer_identity.mjs';

const tokenA = 'mct_' + 'A'.repeat(43);
const tokenB = 'mct_' + 'B'.repeat(43);
const tokenC = 'mct_' + 'C'.repeat(43);
const sha = token => createHash('sha256').update(token).digest('hex');
const expires = '2030-01-01T00:00:00Z';
const now = Date.parse('2026-10-21T04:00:00Z');
const record = (id, tenant, token, scopes=['mining.plan'], status='active', until=expires) => ({
  credential_id:id, tenant_id:tenant, token_sha256:sha(token), scopes, status, expires_at:until,
});
const a=record('cred_a','tenant_alpha',tokenA);
const b=record('cred_b','tenant_beta',tokenB,['mining.risk']);
const config=(records, enabled='true')=>({CONNECT_CUSTOMER_AUTH_ENABLED:enabled, CONNECT_CUSTOMER_CREDENTIALS_JSON:JSON.stringify(records)});
const verify=(token, scope, env)=>verifyConnectCustomerBearer({authorization:'Bearer '+token,requiredScope:scope,env,nowMs:now});

test('no configured customer-auth flag denies all customer bearer tokens',async()=>{
  assert.deepEqual(await verify(tokenA,'mining.plan',config([a],'false')),
    {ok:false,status:503,error:'CUSTOMER_AUTH_DISABLED'});
  assert.equal((await verify(tokenA,'mining.plan',{})).ok,false);
});

test('distinct tenant credentials resolve to correct principal and authorized scope',async()=>{
  const env=config([a,b]);
  assert.deepEqual(await verify(tokenA,'mining.plan',env),
    {ok:true,principal:{tenant_id:'tenant_alpha',credential_id:'cred_a',scope:'mining.plan'}});
  assert.deepEqual(await verify(tokenB,'mining.risk',env),
    {ok:true,principal:{tenant_id:'tenant_beta',credential_id:'cred_b',scope:'mining.risk'}});
  assert.deepEqual(await verify(tokenA,'mining.risk',env),
    {ok:false,status:403,error:'INSUFFICIENT_SCOPE'});
});

test('missing malformed unknown and legacy internal bearers all deny without credential disclosure',async()=>{
  const env=config([a]);
  for(const authorization of ['', 'Bearer ', 'Basic '+tokenA, 'Bearer '+tokenC,
       'Bearer '+sha('old-secret'), 'Bearer '+tokenA+' trailing', 'bearer '+tokenA]){
    const result=await verifyConnectCustomerBearer({authorization,requiredScope:'mining.plan',env,nowMs:now});
    assert.deepEqual(result,{ok:false,status:401,error:'UNAUTHORIZED'});
    assert.equal(JSON.stringify(result).includes(tokenA),false);
  }
});

test('revoked suspended and expired credentials fail closed, including at exact expiry',async()=>{
  for(const status of ['revoked','suspended']){
    const response=await verify(tokenA,'mining.plan',config([record('cred_a','tenant_alpha',tokenA,['mining.plan'],status)]));
    assert.deepEqual(response,{ok:false,status:401,error:'UNAUTHORIZED'});
  }
  const expired=record('cred_a','tenant_alpha',tokenA,['mining.plan'],'active','2026-10-21T04:00:00Z');
  assert.deepEqual(await verify(tokenA,'mining.plan',config([expired])),
    {ok:false,status:401,error:'UNAUTHORIZED'});
});

test('two keys for one tenant rotate without widening scopes; revoked prior key fails',async()=>{
  const old=record('cred_old','tenant_alpha',tokenA,['mining.plan']);
  const replacement=record('cred_new','tenant_alpha',tokenC,['mining.plan','mining.risk']);
  let env=config([old,replacement]);
  assert.equal((await verify(tokenA,'mining.plan',env)).ok,true);
  assert.equal((await verify(tokenC,'mining.risk',env)).ok,true);
  env=config([{...old,status:'revoked'},replacement]);
  assert.deepEqual(await verify(tokenA,'mining.plan',env),{ok:false,status:401,error:'UNAUTHORIZED'});
  assert.equal((await verify(tokenC,'mining.plan',env)).ok,true);
});

test('ambiguous duplicate hashes, credentials, and tenant declarations fail before authentication',async()=>{
  for(const entries of [[a,{...a,credential_id:'cred_other'}],[a,{...a,token_sha256:sha(tokenC)}],
                        [a,{...a,tenant_id:'tenant_beta'}]]){
    const response=await verify(tokenA,'mining.plan',config(entries));
    assert.deepEqual(response,{ok:false,status:503,error:'CUSTOMER_AUTH_INVALID_CONFIGURATION'});
  }
});

test('noncanonical JSON, duplicate object property, plaintext and unknown scopes reject configuration',async()=>{
  const input=JSON.stringify([a]);
  const variants=[
    {CONNECT_CUSTOMER_AUTH_ENABLED:'true',CONNECT_CUSTOMER_CREDENTIALS_JSON:input+' '},
    {CONNECT_CUSTOMER_AUTH_ENABLED:'true',CONNECT_CUSTOMER_CREDENTIALS_JSON:input.replace('"tenant_id"','"tenant_id":"different", "tenant_id"')},
    config([{...a,plaintext_token:tokenA}]),
    config([{...a,scopes:['mining.plan','admin.all']}]),
    config([{...a,expires_at:'nonsense'}]),
    config([{...a,token_sha256:'f'.repeat(63)}]),
  ];
  for(const env of variants){
    assert.deepEqual(await verify(tokenA,'mining.plan',env),
      {ok:false,status:503,error:'CUSTOMER_AUTH_INVALID_CONFIGURATION'});
  }
});

test('caller cannot choose arbitrary scope and verified principal does not include token material',async()=>{
  assert.deepEqual(await verify(tokenA,'tenant.admin',config([a])),
    {ok:false,status:403,error:'INSUFFICIENT_SCOPE'});
  const result=await verify(tokenA,'mining.plan',config([a]));
  assert.deepEqual(Object.keys(result.principal).sort(),['credential_id','scope','tenant_id']);
  assert.doesNotMatch(JSON.stringify(result),/token|sha256|Bearer/i);
});
