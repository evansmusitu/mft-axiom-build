import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {handleEnterpriseWorkspace} from '../enterprise-workspace.mjs';

const TEAM='https://musitu-test.cloudflareaccess.com', AUD='audience_12345678';
const TENANT='tenant_alpha001', OTHER='tenant_bravo002', ITEM='artifact_entry_001', NOW=1800000000;
const b64=v=>Buffer.from(v).toString('base64url'), pack=v=>b64(JSON.stringify(v));
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey);
const jwks=async()=>new Response(JSON.stringify({keys:[{...jwk,alg:'RS256',use:'sig',kid:'test_key123'}]}));
const message=pack({alg:'RS256',kid:'test_key123'})+'.'+pack({iss:TEAM,aud:[AUD],sub:'account_A_123',iat:NOW-100,exp:NOW+200});
const token=message+'.'+b64(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(message)));
const envelope={version:1,iv:b64(Buffer.alloc(12,4)),ciphertext:b64(Buffer.alloc(35,5))};

class SQLiteD1 {
  constructor(){
    this.sql=new DatabaseSync(':memory:');
    this.sql.exec('PRAGMA foreign_keys=ON;');
    this.sql.exec(readFileSync(new URL('../migrations/0001_enterprise_workspace.sql',import.meta.url),'utf8'));
    this.sql.prepare('INSERT INTO tenants VALUES (?)').run(TENANT);
    this.sql.prepare('INSERT INTO tenants VALUES (?)').run(OTHER);
    this.sql.prepare('INSERT INTO tenant_memberships VALUES (?,?,?,?)').run(TENANT,'account_A_123','editor','active');
    this.trigger=null;
  }
  prepare(query){return {bind:(...args)=>({query,args,first:async()=>{
    const row=this.sql.prepare(query).get(...args);
    if(this.trigger && query.startsWith('SELECT role FROM tenant_memberships')){
      const callback=this.trigger;this.trigger=null;callback(this.sql);
    }
    return row??null;
  }})};}
  async batch(stmts){
    const results=[];this.sql.exec('BEGIN');
    try{
      for(const stmt of stmts){
        const result=this.sql.prepare(stmt.query).run(...stmt.args);
        results.push({meta:{changes:result.changes}});
      }
      this.sql.exec('COMMIT');return results;
    }catch(error){this.sql.exec('ROLLBACK');throw error;}
  }
  count(table){return this.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;}
  close(){this.sql.close();}
}
async function request(db,method='GET'){
  const headers={origin:'https://evansmusitu.github.io','cf-access-jwt-assertion':token};
  if(method==='PUT')headers['content-type']='application/json';
  const req=new Request('https://test.invalid/api/enterprise/tenants/'+TENANT+'/artifacts?id='+ITEM,{
    method,headers,body:method==='PUT'?JSON.stringify(envelope):undefined});
  return handleEnterpriseWorkspace(req,{WORKSPACE_DB:db,ACCESS_TEAM_DOMAIN:TEAM,ACCESS_AUDIENCE:AUD},{fetchJwks:jwks,now:NOW});
}
const seed=db=>db.sql.prepare('INSERT INTO tenant_artifacts VALUES (?,?,?,?,?,?)').run(TENANT,ITEM,envelope.iv,envelope.ciphertext,1,NOW);
const revoke=db=>db.prepare('UPDATE tenant_memberships SET status=? WHERE tenant_id=? AND subject=?').run('revoked',TENANT,'account_A_123');
const downgrade=db=>db.prepare('UPDATE tenant_memberships SET role=? WHERE tenant_id=? AND subject=?').run('viewer',TENANT,'account_A_123');

test('revocation between preflight and GET never discloses ciphertext',async()=>{
  const db=new SQLiteD1();try{seed(db);db.trigger=revoke;
    const res=await request(db,'GET');assert.equal(res.status,404);assert.equal((await res.json()).code,'NOT_FOUND');
  }finally{db.close();}
});
test('revocation or downgrade between preflight and PUT prevents storage and audit',async()=>{
  for(const trigger of [revoke,downgrade]){
    const db=new SQLiteD1();try{db.trigger=trigger;
      assert.equal((await request(db,'PUT')).status,404);
      assert.equal(db.count('tenant_artifacts'),0);assert.equal(db.count('tenant_audit'),0);
    }finally{db.close();}
  }
});
test('revocation between preflight and DELETE cannot delete or log',async()=>{
  const db=new SQLiteD1();try{seed(db);db.trigger=revoke;
    assert.equal((await request(db,'DELETE')).status,404);
    assert.equal(db.count('tenant_artifacts'),1);assert.equal(db.count('tenant_audit'),0);
  }finally{db.close();}
});
test('normal encrypted PUT/GET/DELETE work, missing delete does not write false audit',async()=>{
  const db=new SQLiteD1();try{
    db.sql.prepare('INSERT INTO tenant_artifacts VALUES (?,?,?,?,?,?)').run(OTHER,ITEM,envelope.iv,envelope.ciphertext,1,NOW);
    assert.equal((await request(db,'PUT')).status,200);
    const res=await request(db,'GET');assert.equal(res.status,200);
    assert.deepEqual((await res.json()).envelope,envelope);
    assert.equal((await request(db,'DELETE')).status,200);
    assert.equal(db.count('tenant_artifacts'),1);
    assert.equal(db.count('tenant_audit'),2);
    assert.equal((await request(db,'DELETE')).status,404);
    assert.equal(db.count('tenant_audit'),2);
  }finally{db.close();}
});
