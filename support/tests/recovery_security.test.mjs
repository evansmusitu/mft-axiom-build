import assert from 'node:assert/strict';
import test from 'node:test';
import {createCaseRecord,inspectSecretMaterial,recoveryIdentityHash,sha256} from '../control_plane.js';
import {D1CaseStore} from '../d1_case_store.js';
import {encryptSupportPayload,importSupportDataKey} from '../crypto_envelope.js';
import {verifyCustomerRecoveryAccess} from '../worker.js';

class Statement{
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(/FROM support_case_approvals a/.test(this.sql)){
      if(!this.db.approvedRow)return null;
      return this.db.rotations.some(r=>r.approval_id===this.db.approvedRow.approval_id)?null:this.db.approvedRow;
    }
    if(/FROM support_case_recovery_requests q/.test(this.sql)){
      if(!this.db.requestRow)return null;
      const rotatedAfter=this.db.rotations.some(r=>Date.parse(r.created_at)>=Date.parse(this.db.requestRow.created_at));
      return rotatedAfter?null:this.db.requestRow;
    }
    if(/FROM support_case_recovery_bindings/.test(this.sql))return this.db.bindingRow;
    if(/FROM support_cases/.test(this.sql))return this.db.caseRow;
    return null;
  }
  async all(){return {results:[]};}
}
class FakeD1{
  constructor(row){this.caseRow=row;this.bindingRow=null;this.requestRow=null;this.approvedRow=null;this.rotations=[];this.batches=[];}
  prepare(sql){return new Statement(this,sql);}
  async batch(stmts){
    this.batches.push(stmts);
    for(const s of stmts){
      if(/INSERT INTO support_case_recovery_bindings/.test(s.sql)){
        this.bindingRow={identity_hash:s.args[1],provider:s.args[2],created_at:s.args[4]};
      }
      if(/INSERT INTO support_case_recovery_requests/.test(s.sql)){
        this.requestRow={request_id:s.args[0],evidence_hash:s.args[3],created_at:s.args[5],identity_hash:s.args[2]};
      }
      if(/UPDATE support_cases SET recovery_hash=/.test(s.sql)){
        this.caseRow.recovery_hash=s.args[0]; this.caseRow.last_event_hash=s.args[1]; this.caseRow.updated_at=s.args[2];
      }else if(/UPDATE support_cases SET last_event_hash=/.test(s.sql)){
        this.caseRow.last_event_hash=s.args[0]; this.caseRow.updated_at=s.args[1];
      }
      if(/INSERT INTO support_case_recovery_rotations/.test(s.sql)){
        this.rotations.push({rotation_id:s.args[0],approval_id:s.args[2],created_at:s.args[6]});
      }
    }
    return stmts.map(()=>({success:true}));
  }
}
async function fixture(category='bug'){
  const oldCode='01234567-89ABCDEF-GHJKMNPQ';
  const bundle=await createCaseRecord({
    surface:'web_app',category,affected_scope:'self',summary:'Synthetic recovery test',
    description:'Synthetic only.',reproduction:'None.',impact:'None.',evidence_refs:[],consent_to_process:true,
  },{at:'2026-10-08T15:30:00Z',caseId:'AX-0123456789AB',recoveryCode:oldCode});
  const key=await importSupportDataKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
  const encrypted=await encryptSupportPayload({
    summary:'Synthetic recovery test',description:'Synthetic only.',reproduction:'None.',impact:'None.',evidence_refs:[],
  },{key,caseId:bundle.case_record.case_id});
  const db=new FakeD1({...bundle.case_record,public_json:JSON.stringify({
    case_id:bundle.case_record.case_id,state:'NEW',priority:bundle.case_record.priority,surface:'web_app',category,
    created_at:bundle.case_record.created_at,updated_at:bundle.case_record.updated_at,
  }),encrypted_payload:JSON.stringify(encrypted)});
  return {oldCode,bundle,key,db,store:new D1CaseStore({database:db,encryptionKey:key})};
}

test('verified binding plus rotation invalidates old code and only the same opaque identity can rotate',async()=>{
  const {oldCode,bundle,store,db}=await fixture('bug');
  const identity={issuer:'https://team.cloudflareaccess.com',subject:'opaque-customer-1'};
  const other={issuer:'https://team.cloudflareaccess.com',subject:'opaque-customer-2'};
  assert.equal((await store.bindRecoveryIdentity(bundle.case_record.case_id,oldCode,identity)).bound,true);
  assert.equal(await store.bindRecoveryIdentity(bundle.case_record.case_id,oldCode,other),null);
  assert.equal(await store.rotateRecoveryCredential(bundle.case_record.case_id,other,{recoveryCode:'11111111-22222222-33333333'}),null);
  const newCode='ABCDEFGH-JKLMNPQR-STUVWXYZ';
  const rotated=await store.rotateRecoveryCredential(bundle.case_record.case_id,identity,{recoveryCode:newCode});
  assert.equal(rotated.status,'ROTATED');
  assert.equal(db.caseRow.recovery_hash,await sha256(newCode));
  assert.notEqual(db.caseRow.recovery_hash,await sha256(oldCode));
  assert.equal(await store.getAuthorized(bundle.case_record.case_id,oldCode),null);
  assert.equal((await store.getAuthorized(bundle.case_record.case_id,newCode)).details.summary,'Synthetic recovery test');
});

test('sensitive recovery creates one request, requires independent approval, and consumes approval once',async()=>{
  const {oldCode,bundle,store,db}=await fixture('security_report');
  const identity={issuer:'https://team.cloudflareaccess.com',subject:'opaque-sensitive-customer'};
  await store.bindRecoveryIdentity(bundle.case_record.case_id,oldCode,identity);
  const first=await store.rotateRecoveryCredential(bundle.case_record.case_id,identity,{recoveryCode:'AAAAAAAA-BBBBBBBB-CCCCCCCC'});
  assert.equal(first.status,'APPROVAL_REQUIRED');
  assert.match(first.request_id,/^AXQ-/);
  const batchCount=db.batches.length;
  const second=await store.rotateRecoveryCredential(bundle.case_record.case_id,identity,{recoveryCode:'AAAAAAAA-BBBBBBBB-CCCCCCCC'});
  assert.equal(second.request_id,first.request_id);
  assert.equal(db.batches.length,batchCount);
  assert.equal(db.batches.some(batch=>batch.some(s=>/RECOVERY_APPROVAL_REQUIRED/.test(JSON.stringify(s.args)))),true);

  db.approvedRow={approval_id:'AXA-0123456789ABCDEF'};
  const rotated=await store.rotateRecoveryCredential(bundle.case_record.case_id,identity,{recoveryCode:'DDDDDDDD-EEEEEEEE-FFFFFFFF'});
  assert.equal(rotated.status,'ROTATED');
  assert.equal(rotated.approval_id,'AXA-0123456789ABCDEF');
  const again=await store.rotateRecoveryCredential(bundle.case_record.case_id,identity,{recoveryCode:'GGGGGGGG-HHHHHHHH-JJJJJJJJ'});
  assert.equal(again.status,'APPROVAL_REQUIRED');
  assert.notEqual(again.request_id,first.request_id);
});

const enc=value=>Buffer.from(value).toString('base64url');
async function signedAccess(overrides={}){
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='recovery-kid';jwk.alg='RS256';jwk.use='sig';
  const now=Math.floor(Date.now()/1000);
  const payload={iss:'https://team.cloudflareaccess.com',aud:['recovery-aud'],sub:'opaque-subject',email:'customer@example.test',exp:now+300,iat:now-5,...overrides};
  const input=enc(JSON.stringify({alg:'RS256',kid:'recovery-kid',typ:'JWT'}))+'.'+enc(JSON.stringify(payload));
  const sig=await crypto.subtle.sign({name:'RSASSA-PKCS1-v1_5'},pair.privateKey,new TextEncoder().encode(input));
  return {token:input+'.'+Buffer.from(sig).toString('base64url'),jwk};
}
function accessEnv(jwk){
  return {
    ENVIRONMENT:'production',
    SUPPORT_RECOVERY_ACCESS_TEAM_DOMAIN:'https://team.cloudflareaccess.com',
    SUPPORT_RECOVERY_ACCESS_AUD:'recovery-aud',
    SUPPORT_RECOVERY_ACCESS_CERTS_FETCH:async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'content-type':'application/json'}}),
  };
}
test('customer recovery Access verification exposes only issuer and opaque subject',async()=>{
  const {token,jwk}=await signedAccess();
  const principal=await verifyCustomerRecoveryAccess(new Request('https://support.example/recovery/',{headers:{'cf-access-jwt-assertion':token}}),accessEnv(jwk));
  assert.deepEqual(principal,{issuer:'https://team.cloudflareaccess.com',subject:'opaque-subject'});
  assert.equal('email' in principal,false);
  const hash=await recoveryIdentityHash(principal);
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(hash,/customer/);
});

test('customer recovery Access verification fails closed on wrong audience, expiry, or absent subject',async()=>{
  for(const overrides of [
    {aud:['wrong-aud']},
    {exp:Math.floor(Date.now()/1000)-1},
    {sub:''},
  ]){
    const {token,jwk}=await signedAccess(overrides);
    assert.equal(await verifyCustomerRecoveryAccess(new Request('https://support.example/recovery/',{headers:{'cf-access-jwt-assertion':token}}),accessEnv(jwk)),null);
  }
});


test('valid SHA-256 evidence fields are not misclassified as payment cards, while ordinary fields remain protected',()=>{
  const hash='4111111111111111'+'a'.repeat(48);
  assert.equal(hash.length,64);
  assert.equal(inspectSecretMaterial({evidence_hash:hash},'event').safe,true);
  assert.equal(inspectSecretMaterial({evidence_hashes:[hash]},'event').safe,true);
  assert.equal(inspectSecretMaterial({evidence_hash:hash},'intake').safe,false);
  const ordinary=inspectSecretMaterial({note:hash});
  assert.equal(ordinary.safe,false);
  assert.equal(ordinary.findings.some(x=>x.type==='payment_card_number'),true);
});
