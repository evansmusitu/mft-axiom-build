import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {handleEnterpriseWorkspace} from '../enterprise-workspace.mjs';

const TEAM='https://musitu-test.cloudflareaccess.com';
const AUD='audience_12345678';
const TA='tenant_alpha001',TB='tenant_bravo002';
const T=1800000000;
const b64=s=>Buffer.from(s).toString('base64url');
const pack=obj=>b64(JSON.stringify(obj));
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
const fetchJwks=async()=>new Response(JSON.stringify({keys:[{...jwk,kid:'test_key123',alg:'RS256',use:'sig'}]}));
async function signed(subject) {
 const m=pack({alg:'RS256',kid:'test_key123'})+'.'+pack({iss:TEAM,aud:[AUD],sub:subject,iat:T-80,exp:T+250});
 return m+'.'+b64(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(m)));
}
const ALICE=await signed('account_A_123'), BOB=await signed('account_B_123');
class D1{
 constructor(){
  this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON');
  for(const n of ['0001_enterprise_workspace.sql','0002_enterprise_tenant_artifact_limit.sql','0003_enterprise_artifact_revision.sql','0004_enterprise_mutation_budget.sql']){
   this.db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
  }
  for(const tenant of [TA,TB])this.db.prepare('INSERT INTO tenants VALUES (?)').run(tenant);
  this.db.prepare('INSERT INTO tenant_memberships VALUES (?,?,?,?)').run(TA,'account_A_123','editor','active');
  this.db.prepare('INSERT INTO tenant_memberships VALUES (?,?,?,?)').run(TB,'account_B_123','viewer','active');
  const insert=this.db.prepare('INSERT INTO tenant_artifacts(tenant_id,artifact_id,iv,ciphertext,version,updated_at,revision) VALUES (?,?,?,?,?,?,?)');
  for(let i=0;i<23;i++)insert.run(TA,'item_'+String(i).padStart(6,'0'),'fake-iv','encrypted-not-plaintext',1,T+i,'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
  for(let i=0;i<3;i++)insert.run(TB,'item_'+String(i).padStart(6,'0'),'secret-other','tenant-B-ciphertext',1,T+i,'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
 }
 prepare(query){return {bind:(...args)=>({first:async()=>this.db.prepare(query).get(...args)??null,all:async()=>({results:this.db.prepare(query).all(...args)})})};}
 close(){this.db.close();}
}
async function listing(db,subject=ALICE,query=''){
 const request=new Request('https://test.invalid/api/enterprise/tenants/'+(subject===BOB?TB:TA)+'/artifacts'+(query?'?'+query:''),{
  headers:{origin:'https://evansmusitu.github.io','cf-access-jwt-assertion':subject}});
 return handleEnterpriseWorkspace(request,{WORKSPACE_DB:db,ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUDIENCE:AUD},{fetchJwks,now:T});
}
test('authorized listing is bounded, sorted, cursor-paginated without exposing ciphertext or crossing tenants',async()=>{
 const db=new D1();try{
  let after='',all=[];
  for(let page=0;page<4;page++){
   const response=await listing(db,ALICE,'limit=7'+(after?'&after='+after:''));
   assert.equal(response.status,200);
   const data=await response.json();assert.equal(data.items.length,page<3?7:2);
   assert.equal(typeof data.nextAfter, data.items.length===7?'string':'object');
   for(const item of data.items){
     assert.deepEqual(Object.keys(item).sort(),['id','revision','updatedAt']);
     assert.ok(!JSON.stringify(item).includes('encrypted-not-plaintext'));
   }
   all=all.concat(data.items.map(x=>x.id));after=data.nextAfter||'';
  }
  assert.equal(all.length,23);assert.equal(new Set(all).size,23);
  assert.equal(all[0],'item_000000');assert.equal(all.at(-1),'item_000022');
  const other=await listing(db,BOB);
  assert.equal(other.status,200);
  assert.equal((await other.json()).items.length,3);
 }finally{db.close();}
});
test('bad, duplicate, mixed pagination parameters are rejected; no auth gives no listing',async()=>{
 const db=new D1();try{
  for(const query of ['limit=0','limit=11','limit=-1','limit=2.5','limit=NaN',
  'after=../traverse','after=','limit=2&limit=3','id=item_000000&after=item_000001',
  'id=item_000000&id=item_000001']){
   const result=await listing(db,ALICE,query);
   assert.equal(result.status,400,query);
  }
  const noAuth=await listing(db,'', 'limit=1');
  assert.equal(noAuth.status,401);
 }finally{db.close();}
});
test('revoked identity or wrong-tenant identity cannot discover metadata',async()=>{
 const db=new D1();try{
  db.db.prepare("UPDATE tenant_memberships SET status='revoked' WHERE tenant_id=?").run(TA);
  const denied=await listing(db);
  assert.equal(denied.status,404);
  const foreign=await handleEnterpriseWorkspace(new Request('https://test.invalid/api/enterprise/tenants/'+TB+'/artifacts?limit=2',{
   headers:{origin:'https://evansmusitu.github.io','cf-access-jwt-assertion':ALICE}
  }),{WORKSPACE_DB:db,ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUDIENCE:AUD},{fetchJwks,now:T});
  assert.equal(foreign.status,404);
 }finally{db.close();}
});
