/**
 * Synthetic TLS-over-loopback acceptance only: ephemeral HTTPS certificate,
 * verified client trust and hostname, real restricted PostgreSQL 17 LOGIN.
 * No hosted Neon, production Worker, real customer or public route.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer, request as httpsRequest} from 'node:https';
import test from 'node:test';
import pg from 'pg';
import {handleNeonSyntheticHttpCanary as handle} from '../../connect/customer_neon_http_canary.mjs';

const DSN=process.env.NEON_TEST_PG_DSN??'';
const CERT=process.env.NEON_TLS_CERT_FILE??'';
const KEY=process.env.NEON_TLS_KEY_FILE??'';
const TOKEN='mct_'+'T'.repeat(43);
const HASH=createHash('sha256').update(TOKEN).digest('hex');
const ORIGIN='https://isolated.example.invalid';
const PATH='/__synthetic/neon/mining.plan';
const ID='acbd1000-1234-4234-8234-123456789abc';
const OTHER_ID='acbd1001-1234-4234-8234-123456789abc';

test('verified HTTPS transport and restricted PG admission fail closed',async()=>{
  assert.match(DSN,/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/postgres$/);
  assert.ok(CERT.startsWith('/tmp/') && KEY.startsWith('/tmp/'));
  const certificate=readFileSync(CERT);
  const privateKey=readFileSync(KEY);
  const owner=new pg.Client({connectionString:DSN});
  const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'postgres',
    user:'musitu_ci_app',password:'ci-synthetic-disposable-only',ssl:false,max:2});
  let server;
  await owner.connect();
  try{
    assert.equal((await pool.query('SELECT current_user AS name')).rows[0].name,'musitu_ci_app');
    await owner.query("INSERT INTO connect_qualification.tenants(tenant_id,status,daily_limit,minute_limit) VALUES('tenant_tls','active',1,1)");
    await owner.query("INSERT INTO connect_qualification.credentials(credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk) VALUES('cred_tls','tenant_tls',$1,'active',clock_timestamp()+INTERVAL '1 day',true,false)",[HASH]);
    const env={CONNECT_NEON_MODE:'isolated-synthetic-only',CONNECT_NEON_HTTP_ENABLED:true,
      CONNECT_NEON_HTTP_ORIGIN:ORIGIN,CONNECT_NEON_DB:{query:({text,values})=>pool.query(text,values)}};
    server=createServer({key:privateKey,cert:certificate},async(req,res)=>{
      try{
        const workerRequest=new Request(ORIGIN+req.url,{method:req.method,headers:req.headers});
        const reply=await handle(workerRequest,env);
        res.writeHead(reply.status,Object.fromEntries(reply.headers));
        res.end(await reply.text());
      }catch{
        res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
        res.end('{"ok":false,"error":"CUSTOMER_NEON_UNAVAILABLE"}');
      }
    });
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));
    const port=server.address().port;
    const send=(id,{trust=true,servername}={})=>new Promise((resolve,reject)=>{
      const opts={hostname:'127.0.0.1',port,path:PATH,method:'POST',
        rejectUnauthorized:true,headers:{
          authorization:'Bearer '+TOKEN,'x-musitu-request-id':id
        }};
      if(trust)opts.ca=certificate;
      if(servername!==undefined)opts.servername=servername;
      const req=httpsRequest(opts,response=>{
        const encrypted=response.socket.encrypted===true;
        const verified=response.socket.authorized===true;
        const pieces=[];
        response.on('data',chunk=>pieces.push(chunk));
        response.on('error',reject);
        response.on('end',()=>{
          try{
            resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(pieces).toString('utf8')),
              encrypted,verified,cache:response.headers['cache-control']});
          }catch(e){reject(e)}
        });
      });
      req.on('error',reject);
      req.end();
    });
    // No system trust for our short-lived CI certificate: verification is mandatory.
    await assert.rejects(send(OTHER_ID,{trust:false}),err=>
      /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(String(err.code??'')));
    // A trusted CA with the wrong server name still cannot authenticate.
    await assert.rejects(send(OTHER_ID,{servername:'wrong.invalid'}),err=>
      /ALTNAME|CERT/.test(String(err.code??'')));
    const first=await send(ID);
    assert.equal(first.encrypted,true);
    assert.equal(first.verified,true);
    assert.equal(first.status,200);
    assert.deepEqual(first.body,{ok:true,request_id:ID,scope:'mining.plan'});
    assert.equal(first.cache,'no-store');
    const replay=await send(ID);
    assert.equal(replay.status,409);
    assert.equal(replay.verified,true);
    assert.deepEqual(replay.body,{ok:false,error:'REQUEST_ID_CONFLICT'});
    assert.equal((await send(OTHER_ID)).status,429);
    assert.doesNotMatch(JSON.stringify({first,replay}),/mct_|Bearer|tenant_tls|token_sha256/);
    const counters=await owner.query("SELECT (SELECT count(*)::integer FROM connect_qualification.events WHERE tenant_id='tenant_tls') AS events,(SELECT used FROM connect_qualification.daily_usage WHERE tenant_id='tenant_tls') AS daily,(SELECT used FROM connect_qualification.minute_usage WHERE tenant_id='tenant_tls') AS minute");
    assert.deepEqual(Object.values(counters.rows[0]).map(Number),[1,1,1]);
    console.log('NEON_LOOPBACK_TLS_CERT_CHAIN_AND_HOSTNAME=PASS');
    console.log('NEON_LOOPBACK_TLS_RESTRICTED_LOGIN_ADMISSION=PASS');
    console.log('CUSTOMER_RELEASE_AUTHORIZED=false');
  }finally{
    if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    await pool.end();
    await owner.end();
  }
});
