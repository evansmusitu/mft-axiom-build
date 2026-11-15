/** REAL local workerd SQLite DO + R2, SYNTHETIC GitHub and custody.
 * The temporary initializer/reset routes below exist ONLY in a test string.
 * Neither serving Worker nor production Wrangler config imports this harness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {publishGithubCheckpoint} from '../../integrations/independent-ledger/github-anchor.mjs';
import {sha256Json} from '../../integrations/independent-ledger/protocol.mjs';
import {externalHighwaterFence} from '../../integrations/security-authority2/external-highwater-fence.mjs';
import {genesisBarrierKey} from '../../integrations/security-authority2/authority2-genesis-candidate.mjs';
import {wormKey} from '../../integrations/security-authority2/authority2-r2-worm.mjs';
import {githubFixture} from './github-anchor-fixture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=x=>createHash('sha256').update(x).digest('hex');
const ENTRY=`
import {Authority2Highwater as ServingAuthority} from './integrations/security-authority2/authority2-highwater-worker.mjs';
import {provisionAuthority2Genesis} from './integrations/security-authority2/authority2-genesis-candidate.mjs';
export class GenesisQualification extends ServingAuthority {
  async fetch(r){
    const path=new URL(r.url).pathname;
    if(path==='/__qualification/state')return Response.json({
      tip:await this.ctx.storage.get('highwater/tip')??null,
      pending:await this.ctx.storage.get('highwater/pending')??null});
    if(path==='/__qualification/erase-do-only'){
      await this.ctx.storage.deleteAll();return Response.json({local_test_only:true});}
    if(path==='/__qualification/genesis'){
      const r2=this.env.HIGHWATER_WORM,mode=r.headers.get('x-test-failure');
      const bucket={list:opts=>r2.list(opts),head:k=>r2.head(k),get:k=>r2.get(k),
        put:async(...args)=>{
          if(mode==='competing-barrier')await r2.put(args[0],'retained competing barrier');
          const written=await r2.put(...args);
          if(mode==='lost-ack')throw Error('synthetic lost ACK after genuine local R2 PUT');
          return written;}};
      try{return Response.json(await provisionAuthority2Genesis({
        storage:this.ctx.storage,bucket,pin:JSON.parse(this.env.HW_CONFIG_JSON),
        ...JSON.parse(this.env.GENESIS_PUBLIC_INPUT_JSON),
        anchor_read_token:this.env.SYNTHETIC_READ_TOKEN,
        fetchImpl:(url,init)=>this.env.SYNTHETIC_CHECKPOINT.fetch(url,init)}));}
      catch(e){return Response.json({error:e.code||'GENESIS_UNCONFIRMED_HOLD',dispatch_allowed:false},{status:503});}
    }
    return super.fetch(r);
  }
}
export default {fetch(r,env){const c=JSON.parse(env.HW_CONFIG_JSON);
 return env.HIGHWATER_STATE.get(env.HIGHWATER_STATE.idFromName('highwater/'+c.ledger_id+'/'+c.namespace)).fetch(r);}};
`;
let bundlePromise;
async function bundledHarness(){
  bundlePromise??=build({stdin:{contents:ENTRY,resolveDir:root,sourcefile:'qualification-only-genesis-entry.mjs'},
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  return (await bundlePromise).outputFiles[0].text;
}
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'axiom-a2-genesis-workerd-'));
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.privateKey);
  const pin={account_id:'67469478aa9349fa0a57fe3a72da200a',ledger_id:'workerd-genesis-ledger',
    namespace:'ax-workerd-genesis',key_id:'ephemeral-workerd-test-key',
    public_key_jwk:{kty:'OKP',crv:'Ed25519',x:jwk.x}};
  const commitment={schema:'musitu.axiom.authority2.pre-genesis-commitment.v1',ledger_sequence:0,
    kind:'AUTHORITY2_PREGENESIS',...pin,
    reviewed_bundle_sha256:'d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210',
    genesis_nonce:'f'.repeat(64),initial_sequence:-1,initial_head:'0'.repeat(64)};
  const github=githubFixture('ax-workerd-genesis-anchor');
  const proof=await publishGithubCheckpoint({pin:github.pin,token:github.token,
    payload:commitment,fetchImpl:github.fetchImpl});
  let reads=0,recreateAfterFirstProof=false,mf;
  const settings={modules:true,script:await bundledHarness(),compatibilityDate:'2026-07-01',
    durableObjects:{HIGHWATER_STATE:{className:'GenesisQualification',useSQLite:true}},
    r2Buckets:['HIGHWATER_WORM'],durableObjectsPersist:join(directory,'do'),r2Persist:join(directory,'r2'),
    bindings:{HW_CONFIG_JSON:JSON.stringify(pin),HW_SIGNING_JWK:JSON.stringify(jwk),
      HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify({write:hash('w'.repeat(40)),read:hash('r'.repeat(40))}),
      GENESIS_PUBLIC_INPUT_JSON:JSON.stringify({anchor_pin:github.pin,commitment,anchor_proof:proof,
        expected_commitment_sha256:await sha256Json(commitment)}),SYNTHETIC_READ_TOKEN:github.readToken},
    serviceBindings:{SYNTHETIC_CHECKPOINT:async request=>{
      assert.equal(request.method,'GET','genesis uses read-only GitHub requests');
      reads++;if(recreateAfterFirstProof&&reads===5)github.simulateRepositoryResurrection();
      return github.fetchImpl(request);
    }}};
  mf=new Miniflare(settings);
  t.after(async()=>{await mf.dispose();await rm(directory,{recursive:true,force:true});});
  const request=(path,init={})=>mf.dispatchFetch('https://synthetic.invalid'+path,{method:'POST',...init});
  const state=async()=>{const r=await request('/__qualification/state');assert.equal(r.status,200);return r.json();};
  const genesis=mode=>request('/__qualification/genesis',mode?{headers:{'x-test-failure':mode}}:{});
  return {pin,github,state,genesis,request,
    bucket:()=>mf.getR2Bucket('HIGHWATER_WORM'),
    recreateOnSecondProof:()=>{recreateAfterFirstProof=true;},
    restart:async()=>{await mf.dispose();mf=new Miniflare(settings);},
    fence:()=>externalHighwaterFence({pin:{...pin,origin:'https://synthetic.invalid'},
      event:{ledger_id:pin.ledger_id,namespace:pin.namespace,sequence:0,previous_sequence:-1,
        previous_head:'0'.repeat(64),head:'b'.repeat(64),event_digest:'c'.repeat(64),
        artifact_sha256:'d'.repeat(64),action_sha256:'e'.repeat(64)},
      write_token:'w'.repeat(40),read_token:'r'.repeat(40),
      fetchImpl:(url,init)=>mf.dispatchFetch(url,init)})};
}

test('real workerd: empty state HOLD, reviewed pre-genesis, sequence-zero signed append and replay denial',{timeout:60000},async t=>{
  const f=await fixture(t);await assert.rejects(f.fence(),/HIGHWATER_REMOTE_DENIAL_HOLD/);
  const result=await f.genesis();assert.equal(result.status,200);
  assert.equal((await result.json()).dispatch_allowed,false);
  assert.equal((await f.state()).tip.sequence,-1);
  assert.equal((await f.fence()).sequence,0);
  await assert.rejects(f.fence(),/HIGHWATER_REMOTE_DENIAL_HOLD/);
  assert.equal((await f.genesis()).status,503);
});

test('real workerd: eight concurrent initializers commit one R2 barrier and one DO tip',{timeout:60000},async t=>{
  const f=await fixture(t),results=await Promise.all(Array.from({length:8},()=>f.genesis()));
  assert.equal(results.filter(r=>r.status===200).length,1);
  const objects=await (await f.bucket()).list();assert.equal(objects.objects.length,1);
  assert.equal((await f.state()).tip.sequence,-1);
});

test('real workerd: erased SQLite DO cannot reinitialize while genuine local R2 barrier survives',{timeout:60000},async t=>{
  const f=await fixture(t);assert.equal((await f.genesis()).status,200);
  await f.request('/__qualification/erase-do-only');
  const r=await f.genesis();assert.equal(r.status,503);
  assert.equal((await r.json()).error,'A2_GENESIS_EXISTING_R2_HISTORY_HOLD');
  const s=await f.state();assert.equal(s.tip,null);assert.ok(s.pending);
  await assert.rejects(f.fence(),/HIGHWATER_REMOTE_DENIAL_HOLD/);
});

test('real workerd: lost ACK after actual R2 write preserves pending across process restart',{timeout:60000},async t=>{
  const f=await fixture(t),first=await f.genesis('lost-ack');assert.equal(first.status,503);
  assert.ok(await (await f.bucket()).head(genesisBarrierKey(f.pin)));
  await f.restart();
  const s=await f.state();assert.equal(s.tip,null);assert.ok(s.pending);
  assert.equal((await f.genesis()).status,503);
  await assert.rejects(f.fence(),/HIGHWATER_REMOTE_DENIAL_HOLD/);
});

test('real workerd: post-R2 immutable-checkpoint identity failure keeps DO pending',{timeout:60000},async t=>{
  const f=await fixture(t);f.recreateOnSecondProof();
  const r=await f.genesis();assert.equal(r.status,503);
  assert.equal((await r.json()).error,'ANCHOR_REPOSITORY_IDENTITY_CHANGED_HOLD');
  assert.ok(await (await f.bucket()).head(genesisBarrierKey(f.pin)));
  const s=await f.state();assert.equal(s.tip,null);assert.ok(s.pending);
});

test('real workerd: committed pre-genesis survives process restart without a new initializer',{timeout:60000},async t=>{
  const f=await fixture(t);assert.equal((await f.genesis()).status,200);await f.restart();
  assert.equal((await f.genesis()).status,503);
  assert.equal((await f.fence()).sequence,0);
  assert.equal((await f.state()).tip.sequence,0);
});

test('real workerd: orphan later R2 checkpoint prevents provisioning a new pre-genesis',{timeout:60000},async t=>{
  const f=await fixture(t);await (await f.bucket()).put(wormKey(f.pin,9),'retained orphan');
  const r=await f.genesis();assert.equal(r.status,503);
  assert.equal((await r.json()).error,'A2_GENESIS_EXISTING_R2_HISTORY_HOLD');
  const s=await f.state();assert.equal(s.tip,null);assert.ok(s.pending);
});

test('real workerd: actual conditional PUT cannot overwrite a barrier created after empty listing',{timeout:60000},async t=>{
  const f=await fixture(t),r=await f.genesis('competing-barrier');
  assert.equal(r.status,503);assert.equal((await r.json()).error,'A2_GENESIS_R2_BARRIER_UNCONFIRMED_HOLD');
  const retained=await (await f.bucket()).get(genesisBarrierKey(f.pin));
  assert.equal(await retained.text(),'retained competing barrier');
  const s=await f.state();assert.equal(s.tip,null);assert.ok(s.pending);
});
