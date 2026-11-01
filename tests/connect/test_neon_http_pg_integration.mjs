/**
 * Synthetic-only *real loopback HTTP* -> Request handler -> restricted PG LOGIN.
 * CI starts a disposable PostgreSQL 17 service. No hosted Worker/Neon access.
 * Must follow qualification/neon_pg_contract_test.py (creates CI role).
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import test from 'node:test';
import pg from 'pg';
import {handleNeonSyntheticHttpCanary as handle} from '../../connect/customer_neon_http_canary.mjs';

const DSN=process.env.NEON_TEST_PG_DSN??'';
const TOKEN='mct_'+'N'.repeat(43);
const DIGEST=createHash('sha256').update(TOKEN).digest('hex');
const ORIGIN='https://isolated.example.invalid';
const PATH='/__synthetic/neon/mining.plan';
const ids=Array.from({length:10},(_,i)=>`abcd${(i+1).toString(16).padStart(4,'0')}-1234-4234-8234-${String(i+1).padStart(12,'0')}`);
const requestHeaders=id=>({authorization:'Bearer '+TOKEN,'x-musitu-request-id':id});

async function startIsolatedListener(env){
  const server=createServer(async(req,res)=>{
    try{
      const init={method:req.method,headers:req.headers};
      if(req.headers['transfer-encoding']||Number(req.headers['content-length']??0)>0){
        init.body=req;init.duplex='half';
      }
      const workerRequest=new Request(ORIGIN+req.url,init);
      const workerResponse=await handle(workerRequest,env);
      res.writeHead(workerResponse.status,Object.fromEntries(workerResponse.headers));
      res.end(await workerResponse.text());
    }catch{
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end('{"ok":false,"error":"CUSTOMER_NEON_UNAVAILABLE"}');
    }
  });
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',err=>err?reject(err):resolve()));
  const addr=server.address();
  return {server,base:`http://127.0.0.1:${addr.port}`};
}

test('real HTTP ingress with real restricted PostgreSQL login: quotas and failure paths',async()=>{
  assert.match(DSN,/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/postgres$/);
  const owner=new pg.Client({connectionString:DSN});
  const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'postgres',user:'musitu_ci_app',
    password:'ci-synthetic-disposable-only',ssl:false,max:4});
  let server;
  await owner.connect();
  try{
    assert.equal((await pool.query('SELECT current_user AS role_name')).rows[0].role_name,'musitu_ci_app');
    await owner.query("INSERT INTO connect_qualification.tenants(tenant_id,status,daily_limit,minute_limit) VALUES('tenant_http','active',2,2)");
    await owner.query("INSERT INTO connect_qualification.credentials(credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) VALUES('cred_http','tenant_http',$1,'active',clock_timestamp()+INTERVAL '1 day',true,false)",[DIGEST]);
    const env={CONNECT_NEON_MODE:'isolated-synthetic-only',CONNECT_NEON_HTTP_ENABLED:true,
      CONNECT_NEON_HTTP_ORIGIN:ORIGIN,CONNECT_NEON_DB:{query:({text,values})=>pool.query(text,values)}};
    const started=await startIsolatedListener(env);
    server=started.server;
    const send=async(id,path=PATH,opts={})=>{
      const response=await fetch(started.base+path,{method:'POST',headers:requestHeaders(id),signal:AbortSignal.timeout(8000),...opts});
      assert.equal(response.headers.get('cache-control'),'no-store');
      return {status:response.status,data:await response.json()};
    };
    const invalid=await send('not-a-uuid');
    assert.equal(invalid.status,400);
    assert.equal((await send(ids[8],'/__synthetic/neon/mining.risk')).status,401);
    assert.equal((await send(ids[8],PATH,{headers:{...requestHeaders(ids[8]),authorization:'Bearer invalid'}})).status,401);
    assert.equal((await send(ids[8],PATH,{body:'{}',headers:{...requestHeaders(ids[8]),'content-type':'application/json'}})).status,400);
    // Eight independent HTTP requests compete for two quota units.
    const outcomes=await Promise.all(ids.slice(0,8).map(id=>send(id)));
    const successes=outcomes.filter(x=>x.status===200);
    const quotas=outcomes.filter(x=>x.status===429&&x.data.error==='CUSTOMER_QUOTA_EXCEEDED');
    assert.equal(successes.length,2);
    assert.equal(quotas.length,6);
    assert.equal(outcomes.length,successes.length+quotas.length);
    assert.deepEqual(Object.keys(successes[0].data).sort(),['ok','request_id','scope']);
    assert.doesNotMatch(JSON.stringify(outcomes),/mct_|Bearer|tenant_http|token_sha256|ci-synthetic/);
    assert.equal((await send(successes[0].data.request_id)).status,409);
    const counts=async()=>{
      const q=await owner.query("SELECT (SELECT count(*)::integer FROM connect_qualification.events WHERE tenant_id='tenant_http') AS events,(SELECT used FROM connect_qualification.daily_usage WHERE tenant_id='tenant_http') AS daily,(SELECT used FROM connect_qualification.minute_usage WHERE tenant_id='tenant_http') AS minute");
      return Object.values(q.rows[0]).map(Number);
    };
    assert.deepEqual(await counts(),[2,2,2]);
    await owner.query("UPDATE connect_qualification.credentials SET status='revoked' WHERE credential_id='cred_http'");
    assert.equal((await send(ids[8])).status,401);
    assert.deepEqual(await counts(),[2,2,2]);
    await assert.rejects(pool.query('SELECT token_sha256 FROM connect_qualification.credentials'),error=>error.code==='42501');
    await pool.end();
    assert.deepEqual(await send(ids[8]),{status:503,data:{ok:false,error:'CUSTOMER_NEON_UNAVAILABLE'}});
    console.log('NEON_LOOPBACK_HTTP_RESTRICTED_LOGIN=PASS');
    console.log('NEON_HTTP_CONCURRENCY_REPLAY_REVOCATION=PASS');
    console.log('NEON_HTTP_FAILS_CLOSED_ON_DISCONNECTION=PASS');
    console.log('CUSTOMER_RELEASE_AUTHORIZED=false');
  }finally{
    if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    if(!pool.ending)await pool.end();
    await owner.end();
  }
});
