/** Synthetic two-host B27 destructive-replay test; NOT Cloudflare or custody attestation.
 * Producer on host A signs a checkpoint using a temporary Ed25519 key.
 * Host B verifies the signed commitment and exercises the ACTUAL R2 continuity
 * guard on a restored (stale) authority tip. The private key stays on host A.
 * GitHub Actions artifacts can be deleted by administrators: NOT immutable WORM.
 */
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify,createPublicKey} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {wormAppend,wormReadback,wormKey} from './authority2-r2-worm.mjs';

const SCHEMA='musitu.axiom.b27.crosshost.synthetic.v1';
const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
const H64=/^[0-9a-f]{64}$/;
const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':
  x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(canon(x)).digest('hex');
const exact=(o,keys)=>{assert.ok(o&&typeof o==='object'&&!Array.isArray(o));assert.deepEqual(Object.keys(o).sort(),keys.sort());};
const pin={account_id:ACCOUNT,ledger_id:'synthetic-crosshost-ledger',
  namespace:'ax-crosshost-synthetic',key_id:'synthetic-operator-ephemeral'};
const prevHead='a'.repeat(64);
const record0={...pin,sequence:0,head:prevHead};
const event={schema:'synthetic-admission',action:'consume-once',source:'host-a'};
const record1={schema:'musitu.axiom.external-highwater.v1',...pin,
  sequence:1,previous_sequence:0,previous_head:prevHead,
  head:digest({previous_sha256:prevHead,event}),
  event_digest:digest(event),artifact_sha256:'b'.repeat(64),
  action_sha256:digest({action:'consume-once'}),challenge:digest({challenge:'synthetic-a'}),
  decision:'ALLOW_ONCE'};
const staleTip={sequence:0,head:prevHead};
function makeEvidence(){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const publicJwk=publicKey.export({format:'jwk'});
  const payload={schema:SCHEMA,run_id:process.env.GITHUB_RUN_ID,
    source_sha:process.env.GITHUB_SHA,account_id:ACCOUNT,
    producer_role:'ephemeral-synthetic-host-A',record0,record1,event,staleTip,
    retention:'GITHUB_JOB_ARTIFACT_DELETABLE_NOT_WORM',
    real_provider_custody_verified:false};
  const signature=sign(null,Buffer.from(canon(payload)),privateKey).toString('base64url');
  // Private key object is deliberately not serialized or transferred.
  return {payload,signature,public_key_jwk:publicJwk};
}
function verifyEnvelope(obj,expectedPublicKeySha256){
  assert.ok(H64.test(expectedPublicKeySha256),'separate producer-key pin required');
  exact(obj,['payload','signature','public_key_jwk']);
  exact(obj.payload,['schema','run_id','source_sha','account_id','producer_role',
    'record0','record1','event','staleTip','retention','real_provider_custody_verified']);
  assert.equal(obj.payload.schema,SCHEMA);
  assert.equal(obj.payload.run_id,process.env.GITHUB_RUN_ID);
  assert.equal(obj.payload.source_sha,process.env.GITHUB_SHA);
  assert.equal(obj.payload.account_id,ACCOUNT);
  assert.equal(obj.payload.retention,'GITHUB_JOB_ARTIFACT_DELETABLE_NOT_WORM');
  assert.equal(obj.payload.real_provider_custody_verified,false);
  assert.equal(obj.payload.producer_role,'ephemeral-synthetic-host-A');
  const jwk=obj.public_key_jwk;
  exact(jwk,['crv','kty','x']);
  assert.equal(jwk.kty,'OKP');assert.equal(jwk.crv,'Ed25519');
  assert.ok(typeof jwk.x==='string'&&jwk.x.length===43);
  assert.equal(digest(jwk),expectedPublicKeySha256,'public signer key was substituted');
  assert.ok(typeof obj.signature==='string'&&/^[a-zA-Z0-9_-]{86}$/.test(obj.signature));
  assert.equal(verify(null,Buffer.from(canon(obj.payload)),
    createPublicKey({key:jwk,format:'jwk'}),Buffer.from(obj.signature,'base64url')),true);
  const {record0:r0,record1:r1,staleTip:stale}=obj.payload;
  assert.equal(r0.account_id,ACCOUNT);assert.equal(r1.account_id,ACCOUNT);
  assert.equal(r1.ledger_id,pin.ledger_id);assert.equal(r1.namespace,pin.namespace);
  assert.equal(r1.key_id,pin.key_id);assert.equal(r0.sequence,0);
  assert.equal(r1.sequence,1);assert.equal(r1.previous_sequence,0);
  assert.equal(r1.previous_head,r0.head);assert.ok(H64.test(r1.head));
  assert.equal(stale.sequence,0);assert.equal(stale.head,r0.head);
  assert.notEqual(stale.head,r1.head);
  return obj.payload;
}
async function producer(dir){
  assert.ok(process.env.GITHUB_RUN_ID&&/^[0-9]+$/.test(process.env.GITHUB_RUN_ID));
  assert.ok(/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA??''));
  await mkdir(dir,{recursive:true});
  const evidence=makeEvidence();
  await writeFile(join(dir,'checkpoint.json'),canon(evidence)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile(join(dir,'public-key-pin.txt'),digest(evidence.public_key_jwk)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  console.log('B27_HOST_A_SIGNED_CHECKPOINT_CREATED_NO_PRIVATE_KEY_EXPORT');
}
async function verifier(dir){
  const path=join(dir,'checkpoint.json');
  const bytes=await readFile(path);
  assert.ok(bytes.byteLength>100&&bytes.byteLength<=8192,'bounded checkpoint artifact required');
  const obj=JSON.parse(bytes.toString('utf8'));
  // The expected public key arrives as an independent producer job output.
  // Never accept a signer solely because it signed the same transferred blob.
  const expectedPin=process.env.B27_PRODUCER_PUBLIC_KEY_SHA256;
  const payload=verifyEnvelope(obj,expectedPin);
  // Validate signature tests before trusting any restored state or metadata.
  assert.throws(()=>verifyEnvelope({...obj,payload:{...obj.payload,staleTip:{sequence:1,head:obj.payload.record1.head}}},expectedPin),
    /AssertionError|ERR_ASSERTION/,'tampered state must fail signature');
  assert.throws(()=>verifyEnvelope({...obj,signature:'a'.repeat(86)},expectedPin),
    /AssertionError|ERR_ASSERTION/,'forged signature must fail');
  const impostor=generateKeyPairSync('ed25519');
  const impostorJwk=impostor.publicKey.export({format:'jwk'});
  const impostorSignature=sign(null,Buffer.from(canon(obj.payload)),impostor.privateKey).toString('base64url');
  assert.throws(()=>verifyEnvelope({...obj,public_key_jwk:impostorJwk,signature:impostorSignature},expectedPin),
    /AssertionError|ERR_ASSERTION/,'replacing both evidence and signer must fail independent pin');
  const store=new Map([[wormKey(pin,0),canon(payload.record0)],[wormKey(pin,1),canon(payload.record1)]]);
  const r2={
    head:async key=>store.has(key)?{key}:null,
    get:async key=>store.has(key)?{size:Buffer.byteLength(store.get(key)),text:async()=>store.get(key)}:null,
    put:async()=>{throw Error('no R2 append allowed after stale restoration');},
  };
  const oldTip=payload.staleTip;
  await assert.rejects(()=>wormReadback(r2,pin,oldTip),
    /HIGHWATER_WORM_ROLLBACK_DETECTED_HOLD/,'host B must reject stale witness state');
  const attempted={...payload.record1,head:'f'.repeat(64)};
  await assert.rejects(()=>wormAppend(r2,pin,attempted),
    /HIGHWATER_WORM_ROLLBACK_DETECTED_HOLD/,'host B must deny destructive replay');
  assert.equal(await wormReadback(r2,pin,{sequence:1,head:payload.record1.head}),true);
  // Destroying the external checkpoint also destroys admission trust: never PASS.
  store.delete(wormKey(pin,1));
  await assert.rejects(()=>wormReadback(r2,pin,{sequence:1,head:payload.record1.head}),
    /HIGHWATER_WORM_PREDECESSOR_MISSING_HOLD/);
  console.log('AXIOM_B27_TWO_HOST_DESTRUCTIVE_REPLAY_DENIED_SYNTHETIC_NOT_RELEASE');
  console.log('B27_CLOUDFLARE_PROVIDER_INDEPENDENCE_AND_ADMIN_NONROLLBACK_NOT_PROVEN');
}
// Export only the pure proof verifier/fixture to run hostile signed-evidence
// regressions without triggering CLI mode or filesystem writes on import.
export {verifyEnvelope,makeEvidence,digest,canon};
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,dirArg]=process.argv.slice(2);
  if(!['produce','verify'].includes(mode)||!dirArg)
    throw Error('usage: node b27-crosshost-checkpoint.mjs produce|verify OUTPUT_DIR');
  const dir=resolve(dirArg);
  if(mode==='produce')await producer(dir);else await verifier(dir);
}
