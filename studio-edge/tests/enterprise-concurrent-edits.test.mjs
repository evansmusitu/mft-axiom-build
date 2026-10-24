import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {handleEnterpriseWorkspace} from '../enterprise-workspace.mjs';

const TEAM='https://musitu-test.cloudflareaccess.com',AUD='audience_12345678',NOW=1800000000;
const TA='tenant_alpha001',TB='tenant_bravo002',ITEM='artifact_entry_001';
const b64=x=>Buffer.from(x).toString('base64url'),j64=x=>b64(JSON.stringify(x));
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
const fetchJwks=async()=>new Response(JSON.stringify({keys:[{...jwk,kid:'test_key123',alg:'RS256',use:'sig'}]}));
const payload=j64({iss:TEAM,aud:[AUD],sub:'account_A_123',iat:NOW-100,exp:NOW+500});
const input=j64({alg:'RS256',kid:'test_key123'})+'.'+payload;
const token=input+'.'+b64(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input)));
const encrypted=n=>({version:1,iv:b64(Buffer.alloc(12,n)),ciphertext:b64(Buffer.alloc(60,n))});
class D1{
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON');for(const p of [new URL('../migrations/0001_enterprise_workspace.sql',import.meta.url),new URL('../migrations/0002_enterprise_tenant_artifact_limit.sql',import.meta.url),new URL('../migrations/0003_enterprise_artifact_revision.sql',import.meta.url)]this.db.exec(readFileSync(p,'utf8'));
 for(const t of [TA,TB]){this.db.prepare('INSERT INTO tenants VALUES (?)').run(t);this.db.prepare('INSERT INTO tenant_memberships VALUES (?,?,?,?)').run(t,'account_A_123','editor','active');}}
 prepare(query){return {bind:(...args)=>({query,args,first:async()=>this.db.prepare(query).get(...args)??null})};}
 async batch(stmts){const results=[];this.db.exec('BEGIN');try{for(const x of stmts){const v=this.db.prepare(x.query).run(...x.args);results.push({meta:{changes:v.changes}});}this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 count(){return this.db.prepare('SELECT COUNT(*) AS n FROM tenant_audit').get().n;}
 close(){this.db.close();}
}
async function call(db,method='GET',tenant=TA,headers={},body){
 const req=new Request('https://test.invalid/api/enterprise/tenants/'+tenant+'/artifacts?id='+ITEM,{
  method,headers:{'origin':'https://evansmusitu.github.io','cf-access-jwt-assertion':token,...headers},
  body:body===undefined?undefined:JSON.stringify(body)});
 return handleEnterpriseWorkspace(req,{WORKSPACE_DB:db,ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUDIENCE:AUD},{fetchJwks,now:NOW});
}
const put=(db,tenant,value,etag)=>call(db,'PUT',tenant,{'content-type':'application/json',...(etag===null?{}:etag==='*'?{'if-none-match':'*'}:{'if-match':etag})},encrypted(value));
const del=(db,tenant,etag)=>call(db,'DELETE',tenant,etag?{'if-match':etag}:{});

test('workspace create/replace/delete require explicit conditional versions, stale writes never overwrite',async()=>{
 const db=new D1();try{
  assert.equal((await put(db,TA,1,null)).status,428);
  const created=await put(db,TA,1,'*');assert.equal(created.status,200);
  const tag1=created.headers.get('etag');assert.match(tag1,/^"[a-f0-9-]{36}"$/);
  const first=await call(db,'GET');assert.equal(first.status,200);assert.equal(first.headers.get('etag'),tag1);
  assert.deepEqual((await first.json()).envelope,encrypted(1));
  assert.equal((await put(db,TA,2,'*')).status,412);
  assert.equal((await put(db,TA,2,null)).status,428);
  const updated=await put(db,TA,2,tag1);assert.equal(updated.status,200);
  const tag2=updated.headers.get('etag');assert.notEqual(tag2,tag1);
  const auditBefore=db.count();
  assert.equal((await put(db,TA,3,tag1)).status,412);
  assert.equal((await del(db,TA,tag1)).status,412);
  assert.equal(db.count(),auditBefore);
  const current=await call(db,'GET');assert.equal(current.headers.get('etag'),tag2);
  assert.deepEqual((await current.json()).envelope,encrypted(2));
  assert.equal((await del(db,TA,null)).status,428);
  assert.equal((await del(db,TA,tag2)).status,200);
  assert.equal((await del(db,TA,tag2)).status,412);
  const recreated=await put(db,TA,4,'*');assert.equal(recreated.status,200);
  assert.notEqual(recreated.headers.get('etag'),tag2);
  assert.equal((await put(db,TA,5,tag2)).status,412);
 }finally{db.close();}
});
test('versions are tenant-scoped and same artifact ID cannot cross-overwrite',async()=>{
 const db=new D1();try{
  const a=await put(db,TA,1,'*'),b=await put(db,TB,2,'*');
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.notEqual(a.headers.get('etag'),b.headers.get('etag'));
  assert.equal((await put(db,TB,3,a.headers.get('etag'))).status,412);
  assert.equal((await call(db,'GET',TB)).headers.get('etag'),b.headers.get('etag'));
 }finally{db.close();}
});
test('conditional headers are allowed by CORS and malformed ETags rejected',async()=>{
 const db=new D1();try{
  const origin='https://evansmusitu.github.io';
  const preflight=await handleEnterpriseWorkspace(new Request('https://test.invalid/api/enterprise/tenants/'+TA+'/artifacts?id='+ITEM,{method:'OPTIONS',headers:{origin}}),{WORKSPACE_DB:db,ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUDIENCE:AUD});
  assert.equal(preflight.status,204);
  assert.match(preflight.headers.get('access-control-allow-headers'),/if-match/);
  assert.match(preflight.headers.get('access-control-expose-headers'),/etag/i);
  assert.equal((await put(db,TA,1,'W/"weak"')).status,400);
  assert.equal((await put(db,TA,1,'"nonsense"')).status,400);
 }finally{db.close();}
});
