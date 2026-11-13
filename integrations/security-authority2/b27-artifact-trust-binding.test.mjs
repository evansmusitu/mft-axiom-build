/** The signed high-water commitment must bind the operator-approved artifact,
 * even if the ledger's signed receipt does not repeat the artifact SHA-256.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyExternalHighwaterReceipt} from './external-highwater-fence.mjs';
import {configuredExternalLedger} from '../independent-ledger/client.mjs';

const account_id='67469478aa9349fa0a57fe3a72da200a';
const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':
  x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(canon(x)).digest('hex');
const h=x=>x.repeat(64);

async function scenario(witnessArtifact){
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
 const pin={account_id,ledger_id:'fixture-ledger',namespace:'ax-authority2-isolated',
   key_id:'authority2-fixture',origin:'https://custody.example.com',
   public_key_jwk:{kty:'OKP',crv:'Ed25519',x:jwk.x}};
 async function signed(payload){
   const sig=await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(canon(payload)));
   return {payload,signature:Buffer.from(sig).toString('base64url')};
 }
 const before={ledger_sequence:1,chain_sha256:h('a'),operation:'consume'};
 const commit=await signed({schema:'musitu.axiom.external-highwater.v1',kind:'commit',
   account_id,ledger_id:pin.ledger_id,namespace:pin.namespace,key_id:pin.key_id,
   decision:'ALLOW_ONCE',challenge:h('b'),sequence:1,head:h('a'),
   event_digest:digest(before),artifact_sha256:witnessArtifact});
 const witness={status:'EXTERNAL_CAS_COMMITTED_AND_INDEPENDENTLY_READ_BACK',
   account_id,namespace:pin.namespace,sequence:1,head:h('a'),
   commit_envelope:commit,readback_envelope:{}};
 const ledger_payload={...before,highwater:witness};
 const fetchImpl=async(url,opts)=>{
   assert.ok(url.startsWith(pin.origin));
   const request=JSON.parse(opts.body);
   return {status:200,text:async()=>JSON.stringify(await signed({
     schema:'musitu.axiom.external-highwater.v1',kind:'readback',
     account_id,ledger_id:pin.ledger_id,namespace:pin.namespace,
     key_id:pin.key_id,challenge:request.challenge,sequence:1,head:h('a')}))};
 };
 return {pin,ledger_payload,read_token:'r'.repeat(40),fetchImpl};
}

test('rejects a validly signed wrong execution artifact when ledger receipt omits that field',async()=>{
 const args=await scenario(h('f')); // attacker-controlled/wrong artifact in witness proof
 assert.equal(Object.hasOwn(args.ledger_payload,'execution_artifact_sha256'),false);
 await assert.rejects(verifyExternalHighwaterReceipt({
   ...args,expected_artifact_sha256:h('a')}),
   /HIGHWATER_COMMIT_ARTIFACT_MISMATCH_HOLD/);
});

test('accepts validly signed artifact commitment matching independent trusted config',async()=>{
 const args=await scenario(h('a'));
 assert.equal(await verifyExternalHighwaterReceipt({
   ...args,expected_artifact_sha256:h('a')}),true);
});

test('B27 explicitly required highwater cannot be silently disabled by optional ledger flag',async()=>{
  await assert.rejects(
    configuredExternalLedger({AXIOM_EXTERNAL_LEDGER_REQUIRED:'false',AXIOM_HIGHWATER_REQUIRED:'true'}),
    /HIGHWATER_REQUIRES_EXTERNAL_LEDGER_HOLD/,
    'server required independent highwater but no ledger is enabled');
});
test('B27 explicitly required highwater also vetoes undefined ledger flag',async()=>{
  await assert.rejects(
    configuredExternalLedger({AXIOM_HIGHWATER_REQUIRED:'true'}),
    /HIGHWATER_REQUIRES_EXTERNAL_LEDGER_HOLD/);
});
