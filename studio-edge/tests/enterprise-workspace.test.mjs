import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import {verifyAccessJwt,handleEnterpriseWorkspace} from '../enterprise-workspace.mjs';
import {webcrypto} from 'node:crypto';

const TEAM='https://musitu-test.cloudflareaccess.com';
const AUD='audience_12345678';
const TA='tenant_alpha001';
const TB='tenant_bravo002';
const ID='artifact_entry_001';
const CLOCK=1800000000;
const ORIGIN='https://evansmusitu.github.io';
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const j64 = obj => b64(JSON.stringify(obj));
const ciphertext={version:1,iv:b64(Buffer.alloc(12,1)),ciphertext:b64(Buffer.alloc(64,9))};
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pairWrong=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pub=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
const fetchJwks=async url=>{assert.equal(url,TEAM+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[{...pub,alg:'RS256',use:'sig',kid:'key_12345678'}]}),{status:200});};
async function sign(claims={},key=pair.privateKey,header={}) {
  const a=j64({alg:'RS256',kid:'key_12345678',typ:'JWT',...header});
  const b=j64({iss:TEAM,aud:[AUD],sub:'subject-owner',iat:CLOCK-60,exp:CLOCK+300,...claims});
  const message=a+'.'+b;
  return message+'.'+b64(new Uint8Array(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message))));
}
class FakeDB {
  constructor(){this.members=new Map();this.items=new Map();this.audit=[];this.failBatch=false;}
  prepare(query){return {bind:(...v)=>({query,v,first:async()=>{
    if(query.startsWith('SELECT role'))return this.members.get(v[0]+'|'+v[1]) ?? null;
    if(query.startsWith('SELECT a.iv')){
      const member=this.members.get(v[1]+'|'+v[0]);
      return member && ['owner','editor','viewer'].includes(member.role) && member.status!=='revoked'
        ? this.items.get(v[1]+'|'+v[2]) ?? null : null;
    }
    throw Error('unexpected SQL');
  }})};}
  async batch(stmts){
    if(this.failBatch)throw Error('DB offline');
    const results=[];let changes=0;
    for(const {query,v} of stmts){
      if(query.startsWith('INSERT INTO tenant_artifacts')){
        const member=this.members.get(v[7]+'|'+v[8]);
        changes=member && ['owner','editor'].includes(member.role) && member.status!=='revoked' &&
          !this.items.has(v[0]+'|'+v[1]) ? 1 : 0;
        if(changes)this.items.set(v[0]+'|'+v[1],{iv:v[2],ciphertext:v[3],version:v[4],revision:v[6]});
      }else if(query.startsWith('UPDATE tenant_artifacts')){
        const member=this.members.get(v[8]+'|'+v[9]);const original=this.items.get(v[5]+'|'+v[6]);
        changes=member && ['owner','editor'].includes(member.role) && member.status!=='revoked' &&
          original?.revision===v[7] ? 1 : 0;
        if(changes)this.items.set(v[5]+'|'+v[6],{iv:v[0],ciphertext:v[1],version:v[2],revision:v[4]});
      }else if(query.startsWith('DELETE FROM tenant_artifacts')){
        const member=this.members.get(v[3]+'|'+v[4]);
        const original=this.items.get(v[0]+'|'+v[1]);
        changes=member && ['owner','editor'].includes(member.role) && member.status!=='revoked' &&
          original?.revision===v[2] && this.items.delete(v[0]+'|'+v[1]) ? 1 : 0;
      }else if(query.startsWith('INSERT INTO tenant_audit')){
        if(changes)this.audit.push(v);
        changes=changes?1:0;
      }else throw Error('unexpected SQL');
      results.push({meta:{changes}});
    }
    return results;
  }
}
function setup() {const db=new FakeDB();db.members.set(TA+'|subject-owner',{role:'owner'});db.members.set(TB+'|subject-other',{role:'viewer'});
return {env:{WORKSPACE_DB:db,ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUDIENCE:AUD},db};}
async function call(env,method,tenant=TA,id=ID, token='',body=null,origin=ORIGIN){
  const headers={'cf-access-jwt-assertion':token};
  if(origin!==null)headers.origin=origin;
  if(body!==null){headers['content-type']='application/json';headers['if-none-match']='*';}
  if(method==='DELETE')headers['if-match']='"'+(env?.WORKSPACE_DB?.items?.get(tenant+'|'+id)?.revision||'00000000-0000-4000-8000-000000000001')+'"';
  const req=new Request('https://example.test/api/enterprise/tenants/'+tenant+'/artifacts?id='+id,
    {method,headers,body:body===null?undefined:JSON.stringify(body)});
  return handleEnterpriseWorkspace(req,env,{fetchJwks,now:CLOCK});
}
test('RS256 identity checks signature, issuer, audience, time, asymmetric alg',async()=>{
  const token=await sign();
  assert.equal(await verifyAccessJwt(token,{teamDomain:TEAM,audience:AUD,fetchJwks,now:CLOCK}),'subject-owner');
  for(const forged of [await sign({iss:'https://other.cloudflareaccess.com'}),await sign({aud:['wrong_aud']}),
    await sign({exp:CLOCK-1}),await sign({iat:CLOCK+500}),await sign({nbf:CLOCK+500}),
    await sign({},pairWrong.privateKey),await sign({},pair.privateKey,{alg:'none'}),'invalid.token']) {
    await assert.rejects(verifyAccessJwt(forged,{teamDomain:TEAM,audience:AUD,fetchJwks,now:CLOCK}));
  }
});
test('fails closed without dedicated tenant database and Access configuration',async()=>{
 const token=await sign();
 for(const env of [{},{WORKSPACE_DB:new FakeDB()},{WORKSPACE_DB:new FakeDB(),ACCESS_TEAM_DOMAIN:'https://attacker.test',ACCESS_AUDIENCE:AUD}]) {
  const r=await call(env,'GET',TA,ID,token);assert.equal(r.status,503);assert.equal((await r.json()).code,'NOT_CONFIGURED');
 }
});
test('owner encrypted write/read, tenant isolation, revocation, viewer read-only and audit',async()=>{
 const {env,db}=setup();const token=await sign();
 assert.equal((await call(env,'PUT',TA,ID,token,ciphertext)).status,200);
 assert.deepEqual((await (await call(env,'GET',TA,ID,token)).json()).envelope,ciphertext);
 assert.equal((await call(env,'GET',TB,ID,token)).status,404);
 const spoof=await sign({sub:'subject-other',tenant_id:TA,role:'owner'});
 assert.equal((await call(env,'PUT',TA,ID,spoof,ciphertext)).status,404);
 assert.equal((await call(env,'PUT',TB,ID,spoof,ciphertext)).status,403);
 db.members.set(TA+'|subject-owner',{role:'viewer'});
 assert.equal((await call(env,'DELETE',TA,ID,token)).status,403);
 db.members.set(TA+'|subject-owner',{role:'owner'});
 assert.equal((await call(env,'DELETE',TA,ID,token)).status,200);
 assert.equal((await call(env,'GET',TA,ID,token)).status,404);
 assert.deepEqual(db.audit.map(x=>x[3]),['put','delete']);
 db.members.delete(TA+'|subject-owner');
 assert.equal((await call(env,'GET',TA,ID,token)).status,404);
});
test('invalid plaintext/encryption/ID/origin/identity are rejected without storage',async()=>{
 const {env,db}=setup();const token=await sign();
 for(const bad of [{plain:'secret'},{...ciphertext,iv:'badnonce'},{...ciphertext,ciphertext:'x'.repeat(13000)},
    {...ciphertext,secret:'extra'},{...ciphertext,iv:'Z'}]) {
  const r=await call(env,'PUT',TA,ID,token,bad);assert.equal(r.status,400);
 }
 assert.equal((await call(env,'PUT',TA,'../outside',token,ciphertext)).status,400);
 assert.equal((await call(env,'PUT',TA,ID,'not-signed',ciphertext)).status,401);
 assert.equal((await call(env,'PUT',TA,ID,token,ciphertext,'https://attacker.test')).status,403);
 assert.equal(db.items.size,0);assert.equal(db.audit.length,0);
});
test('write transaction failure refuses false success',async()=>{
 const {env,db}=setup();db.failBatch=true;
 const r=await call(env,'PUT',TA,ID,await sign(),ciphertext);
 assert.equal(r.status,503);assert.equal(db.items.size,0);assert.equal(db.audit.length,0);
});
test('worker integrates enterprise route while public health remains honest',async()=>{
 const {env}=setup();
 const denied=await worker.fetch(new Request('https://example.test/api/enterprise/tenants/'+TA+'/artifacts?id='+ID),env);
 assert.equal(denied.status,401);
 const health=await worker.fetch(new Request('https://example.test/api/health'),env);
 assert.equal(health.status,200);
 assert.equal((await health.json()).tools.some(x=>x.id==='enterprise'),false);
});
