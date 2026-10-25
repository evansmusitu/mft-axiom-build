/**
 * Private-canary rehearsal without cloud/network: opt-in SDK -> HTTP Request ->
 * real enterprise handler -> signed Access JWT -> actual SQLite D1 semantics.
 * Confirms the browser-to-Worker agreement and doesn't change production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {createTenantWorkspaceClient} from '../enterprise-client.mjs';
import {handleEnterpriseWorkspace} from '../enterprise-workspace.mjs';

const TEAM='https://musitu-test.cloudflareaccess.com';
const AUD='audience_12345678';
const BASE='https://musitu-private-canary.mft-education-nexus-93f395f5.workers.dev';
const ORIGIN='https://evansmusitu.github.io';
const TA='tenant_alpha001', TB='tenant_bravo002', ITEM='artifact_entry_001';
const clock=Math.floor(Date.now()/1000);
const b64=input=>Buffer.from(input).toString('base64url');
const j64=value=>b64(JSON.stringify(value));
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
const fetchJwks=async url=>{
  assert.equal(url,TEAM+'/cdn-cgi/access/certs');
  return new Response(JSON.stringify({keys:[{...jwk,kid:'key_12345678',alg:'RS256',use:'sig'}]}),{status:200});
};
async function tokenFor(sub){
  const header=j64({alg:'RS256',typ:'JWT',kid:'key_12345678'});
  const payload=j64({iss:TEAM,aud:[AUD],iat:clock-60,exp:clock+600,sub});
  const message=header+'.'+payload;
  const signature=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(message));
  return message+'.'+b64(new Uint8Array(signature));
}

class SQLiteD1{
  constructor(){
    this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON');
    for(const path of ['0001_enterprise_workspace.sql','0002_enterprise_tenant_artifact_limit.sql','0003_enterprise_artifact_revision.sql','0004_enterprise_mutation_budget.sql']){
      this.db.exec(readFileSync(new URL('../migrations/'+path,import.meta.url),'utf8'));
    }
    for(const tenant of [TA,TB])this.db.prepare('INSERT INTO tenants VALUES (?)').run(tenant);
    this.db.prepare('INSERT INTO tenant_memberships VALUES (?,?,?,?)').run(TA,'alice_signed_subject','editor','active');
    this.db.prepare('INSERT INTO tenant_memberships VALUES (?,?,?,?)').run(TB,'bob_signed_subject','owner','active');
  }
  prepare(sql){
    return {bind:(...args)=>({sql,args,
      first:async()=>this.db.prepare(sql).get(...args)||null,
      all:async()=>({results:this.db.prepare(sql).all(...args)})
    })};
  }
  async batch(statements){
    this.db.exec('BEGIN IMMEDIATE');const results=[];
    try{
      for(const st of statements){const changed=this.db.prepare(st.sql).run(...st.args);results.push({meta:{changes:changed.changes}});}
      this.db.exec('COMMIT');return results;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  count(table){return this.db.prepare('SELECT count(*) n FROM '+table).get().n;}
  close(){this.db.close();}
}
const makeHarness=()=>{
  const db=new SQLiteD1(),env={WORKSPACE_DB:db,ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUDIENCE:AUD};
  const requests=[];
  async function fetcher(url,options){
    const headers=new Headers(options.headers);headers.set('origin',ORIGIN);
    const request=new Request(url,{...options,headers});
    requests.push({url:String(url),method:request.method,headers:Object.fromEntries(headers)});
    return handleEnterpriseWorkspace(request,env,{fetchJwks,now:clock});
  }
  return {db,env,fetcher,requests};
};
const key=()=>webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const client=(h,tenantId,cryptoKey,getToken)=>createTenantWorkspaceClient({baseUrl:BASE,tenantId,key:cryptoKey,getToken,fetcher:h.fetcher});

test('real SQLite full client lifecycle, ciphertext-only D1, no cookie or plaintext transit, stale edit conflict',async()=>{
  const h=makeHarness();
  try{
    const k=await key(), t=await tokenFor('alice_signed_subject');
    const a=client(h,TA,k,async()=>t), b=client(h,TA,k,async()=>t);
    const first=await a.create({id:ITEM,text:'Confidential report 𝄞'});
    assert.match(first.etag,/^"[a-f0-9-]{36}"$/);
    const saved=h.db.db.prepare('SELECT iv,ciphertext,revision FROM tenant_artifacts WHERE tenant_id=? AND artifact_id=?').get(TA,ITEM);
    assert.ok(!saved.ciphertext.includes('Confidential'));
    assert.equal(saved.revision,first.etag.slice(1,-1));
    const older=await b.get({id:ITEM});
    assert.equal(older.text,'Confidential report 𝄞');
    const latest=await a.replace({id:ITEM,etag:first.etag,text:'Updated signed report'});
    await assert.rejects(b.replace({id:ITEM,etag:older.etag,text:'stale unauthorized overwrite'}),
      e=>e.status===412&&e.code==='PRECONDITION_FAILED');
    assert.equal((await a.get({id:ITEM})).text,'Updated signed report');
    const catalog=await a.list({limit:2});
    assert.deepEqual(catalog.items.map(row=>row.id),[ITEM]);
    assert.equal(catalog.items[0].revision,latest.etag.slice(1,-1));
    assert.ok(!JSON.stringify(catalog).includes('Updated signed report'));
    await assert.rejects(b.delete({id:ITEM,etag:older.etag}),e=>e.status===412);
    const del=await a.delete({id:ITEM,etag:latest.etag});
    assert.equal(del.deleted,true);
    await assert.rejects(a.get({id:ITEM}),e=>e.status===404);
    assert.equal(h.db.count('tenant_artifacts'),0);
    assert.deepEqual(h.db.db.prepare('SELECT event FROM tenant_audit ORDER BY id ASC').all().map(r=>r.event),['put','put','delete']);
    assert.ok(h.requests.every(r=>!('cookie' in r.headers)));
    assert.ok(h.requests.every(r=>!r.url.includes('Confidential')));
  }finally{h.db.close();}
});

test('signed tenant isolation and revocation fail closed across the real HTTP bridge',async()=>{
  const h=makeHarness();
  try{
    const alice=await tokenFor('alice_signed_subject'),bob=await tokenFor('bob_signed_subject');
    const a=client(h,TA,await key(),async()=>alice),b=client(h,TB,await key(),async()=>bob);
    const written=await a.create({id:ITEM,text:'tenant A private evidence'});
    const own=await b.create({id:ITEM,text:'tenant B separate record'});
    assert.notEqual(written.etag,own.etag);
    assert.equal((await b.get({id:ITEM})).text,'tenant B separate record');
    const cross=client(h,TA,await key(),async()=>bob);
    await assert.rejects(cross.get({id:ITEM}),e=>e.status===404);
    h.db.db.prepare("UPDATE tenant_memberships SET status='revoked' WHERE tenant_id=? AND subject=?").run(TA,'alice_signed_subject');
    await assert.rejects(a.get({id:ITEM}),e=>e.status===404);
    await assert.rejects(a.delete({id:ITEM,etag:written.etag}),e=>e.status===404);
    assert.equal(h.db.count('tenant_artifacts'),2);
    assert.equal((await b.get({id:ITEM})).text,'tenant B separate record');
  }finally{h.db.close();}
});

test('explicit portable export contains only encrypted sealed envelopes and never mutates D1',async()=>{
  const h=makeHarness();
  try{
    const k=await key(),t=await tokenFor('alice_signed_subject');
    const api=client(h,TA,k,async()=>t);
    const items=['artifact_entry_001','artifact_entry_002'];
    await api.create({id:items[0],text:'private export content A'});
    await api.create({id:items[1],text:'private export content B'});
    const auditBefore=h.db.count('tenant_audit');
    const portable=await api.exportEncryptedBundle();
    assert.equal(portable.kind,'musitu-enterprise-encrypted-export');
    assert.equal(portable.version,1);
    assert.equal(portable.tenantId,TA);
    assert.deepEqual(portable.artifacts.map(x=>x.id),items);
    for(const item of portable.artifacts){
      assert.deepEqual(Object.keys(item).sort(),['envelope','etag','id']);
      assert.deepEqual(Object.keys(item.envelope).sort(),['ciphertext','iv','version']);
      assert.match(item.etag,/^"[a-f0-9-]{36}"$/);
    }
    assert.ok(!JSON.stringify(portable).includes('private export content'));
    assert.equal(h.db.count('tenant_audit'),auditBefore);
  }finally{h.db.close();}
});

test('portable export refuses silently inconsistent cross-request snapshots',async()=>{
  const h=makeHarness();
  try{
    const k=await key(),t=await tokenFor('alice_signed_subject');
    const a=client(h,TA,k,async()=>t);
    await a.create({id:ITEM,text:'first version'});
    let injected=false;
    const intercept=async(url,options)=>{
      const result=await h.fetcher(url,options);
      const q=new URL(url);
      if(!injected&&options.method==='GET'&&!q.searchParams.has('id')&&result.status===200){
        injected=true;
        h.db.db.prepare('UPDATE tenant_artifacts SET revision=? WHERE tenant_id=? AND artifact_id=?')
          .run('00000000-0000-4000-8000-000000000999',TA,ITEM);
      }
      return result;
    };
    const api=createTenantWorkspaceClient({baseUrl:BASE,tenantId:TA,key:k,getToken:async()=>t,fetcher:intercept});
    await assert.rejects(api.exportEncryptedBundle(),error=>error.code==='EXPORT_CONFLICT');
    assert.equal(injected,true);
  }finally{h.db.close();}
});

test('portable export traverses encrypted multi-page inventory without new audit writes',async()=>{
  const h=makeHarness();
  try{
    const k=await key(),t=await tokenFor('alice_signed_subject');
    const {encryptTenantText}=await import('../client-encrypted-artifact.mjs');
    const ids=Array.from({length:12},(_,i)=>'artifact_entry_'+String(i).padStart(4,'0'));
    const insert=h.db.db.prepare('INSERT INTO tenant_artifacts(tenant_id,artifact_id,iv,ciphertext,version,updated_at,revision) VALUES(?,?,?,?,?,?,?)');
    for(const id of ids){
      const envelope=await encryptTenantText('Private historical '+id,k,TA,id);
      insert.run(TA,id,envelope.iv,envelope.ciphertext,1,clock,crypto.randomUUID());
    }
    const api=client(h,TA,k,async()=>t);
    const result=await api.exportEncryptedBundle();
    assert.equal(result.artifacts.length,12);
    assert.deepEqual(result.artifacts.map(x=>x.id),ids);
    assert.equal(h.db.count('tenant_audit'),0);
    assert.equal(h.requests.filter(r=>new URL(r.url).searchParams.has('limit')).length,4);
    assert.ok(!JSON.stringify(result).includes('Private historical'));
  }finally{h.db.close();}
});

test('portable export never includes tampered or undecryptable records',async()=>{
  const h=makeHarness();
  try{
    const k=await key(),t=await tokenFor('alice_signed_subject');
    const api=client(h,TA,k,async()=>t);
    await api.create({id:ITEM,text:'valid private evidence'});
    h.db.db.prepare('UPDATE tenant_artifacts SET ciphertext=? WHERE tenant_id=? AND artifact_id=?').run('tamperedCiphertext',TA,ITEM);
    await assert.rejects(api.exportEncryptedBundle());
  }finally{h.db.close();}
});

test('browser and Worker agree on supported 8000-byte plaintext budget',async()=>{
  const h=makeHarness();
  try{
    const k=await key(), jwt=await tokenFor('alice_signed_subject');
    const api=client(h,TA,k,async()=>jwt);
    const content='A'.repeat(7900);
    const created=await api.create({id:ITEM,text:content});
    assert.match(created.etag,/^"[a-f0-9-]{36}"$/);
    assert.equal((await api.get({id:ITEM})).text,content);
  }finally{h.db.close();}
});


test('explicit encrypted backup restoration uses real signed handler, preserves opaque ciphertext and rotates revision',async()=>{
  const h=makeHarness();try{
    const k=await key(),jwt=await tokenFor('alice_signed_subject');
    const api=client(h,TA,k,async()=>jwt);
    const id='artifact_saved_0001',text='Recovery-safe signed tenant evidence 𝄞';
    const first=await api.create({id,text});
    const bundle=await api.exportEncryptedBundle();
    const inspect=await api.inspectEncryptedBundle(bundle);
    assert.deepEqual(inspect,{tenantId:TA,count:1,ids:[id]});
    await assert.rejects(api.restoreEncryptedArtifact({bundle,id,acknowledgeCreateOnly:true}),
      e=>e.status===412&&e.code==='PRECONDITION_FAILED');
    await api.delete({id,etag:first.etag});
    const auditBefore=h.db.count('tenant_audit');
    const restored=await api.restoreEncryptedArtifact({bundle,id,acknowledgeCreateOnly:true});
    assert.equal(restored.created,true);
    assert.notEqual(restored.etag,first.etag);
    assert.equal((await api.get({id})).text,text);
    const saved=h.db.db.prepare('SELECT ciphertext,iv,revision FROM tenant_artifacts WHERE tenant_id=? AND artifact_id=?').get(TA,id);
    assert.equal(saved.ciphertext,bundle.artifacts[0].envelope.ciphertext);
    assert.equal(saved.iv,bundle.artifacts[0].envelope.iv);
    assert.equal(h.db.count('tenant_audit'),auditBefore+1);
    assert.ok(!h.requests.some(req=>req.url.includes(text)));
  }finally{h.db.close();}
});

test('offline restore cannot bring tenant A ciphertext to tenant B or use wrong local key',async()=>{
  const h=makeHarness();try{
    const aliceJwt=await tokenFor('alice_signed_subject'),bobJwt=await tokenFor('bob_signed_subject');
    const ownerKey=await key();
    const alice=client(h,TA,ownerKey,async()=>aliceJwt);
    const id='artifact_saved_0002';
    await alice.create({id,text:'Nontransferable signed tenant secret'});
    const bundle=await alice.exportEncryptedBundle();
    const bob=client(h,TB,ownerKey,async()=>bobJwt);
    const otherKey=client(h,TA,await key(),async()=>aliceJwt);
    const requestCount=h.requests.length,auditCount=h.db.count('tenant_audit');
    await assert.rejects(bob.restoreEncryptedArtifact({bundle,id,acknowledgeCreateOnly:true}));
    await assert.rejects(otherKey.restoreEncryptedArtifact({bundle,id,acknowledgeCreateOnly:true}));
    assert.equal(h.requests.length,requestCount);
    assert.equal(h.db.count('tenant_audit'),auditCount);
    assert.equal(h.db.count('tenant_artifacts'),1);
  }finally{h.db.close();}
});


test('export detects edits to earlier objects after they were read, before the export completes',async()=>{
  const h=makeHarness();try{
    const cryptoKey=await key(),jwt=await tokenFor('alice_signed_subject');
    const a=client(h,TA,cryptoKey,async()=>jwt);
    const firstId='artifact_entry_001',secondId='artifact_entry_002';
    await a.create({id:firstId,text:'first report from signed editor'});
    await a.create({id:secondId,text:'second report from signed editor'});
    let injected=false;
    const fetcher=async(url,options)=>{
      const response=await h.fetcher(url,options);
      const u=new URL(url);
      if(!injected&&options.method==='GET'&&u.searchParams.get('id')===secondId){
        injected=true;
        h.db.db.prepare('UPDATE tenant_artifacts SET revision=? WHERE tenant_id=? AND artifact_id=?')
          .run(crypto.randomUUID(),TA,firstId);
      }
      return response;
    };
    const exporter=createTenantWorkspaceClient({baseUrl:BASE,tenantId:TA,key:cryptoKey,getToken:async()=>jwt,fetcher});
    await assert.rejects(exporter.exportEncryptedBundle(),e=>e.code==='EXPORT_CONFLICT');
    assert.equal(injected,true);
  }finally{h.db.close();}
});
test('export notices a new artifact inserted after initial listing but before completion',async()=>{
  const h=makeHarness();try{
    const cryptoKey=await key(),jwt=await tokenFor('alice_signed_subject');
    const a=client(h,TA,cryptoKey,async()=>jwt),firstId='artifact_entry_001',secondId='artifact_entry_002';
    await a.create({id:firstId,text:'first signed report'});
    let injected=false;
    const fetcher=async(url,options)=>{
      const response=await h.fetcher(url,options);
      const u=new URL(url);
      if(!injected&&options.method==='GET'&&u.searchParams.get('id')===firstId){
        injected=true;
        const {encryptTenantText}=await import('../client-encrypted-artifact.mjs');
        const envelope=await encryptTenantText('late addition',cryptoKey,TA,secondId);
        h.db.db.prepare('INSERT INTO tenant_artifacts(tenant_id,artifact_id,iv,ciphertext,version,updated_at,revision) VALUES (?,?,?,?,?,?,?)')
          .run(TA,secondId,envelope.iv,envelope.ciphertext,1,clock,crypto.randomUUID());
      }
      return response;
    };
    const exporter=createTenantWorkspaceClient({baseUrl:BASE,tenantId:TA,key:cryptoKey,getToken:async()=>jwt,fetcher});
    await assert.rejects(exporter.exportEncryptedBundle(),e=>e.code==='EXPORT_CONFLICT');
    assert.equal(injected,true);
  }finally{h.db.close();}
});
