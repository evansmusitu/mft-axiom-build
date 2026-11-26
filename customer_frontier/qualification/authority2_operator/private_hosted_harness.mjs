// NEW separately reviewable disposable hosted fault/recovery harness.
// No public entry point. No production identity. No signer generation.
// Destructive actions require the exact approved qualification pin, a short
// operator window and a once-only R2 guard outside the restorable DO state.
import {Authority2Highwater as ServingAuthority} from './approved-serving.mjs';
import {wormKey,wormReadback} from './approved-r2.mjs';
import {verifyGithubCheckpoint} from './approved-anchor.mjs';
import {externalHighwaterFence} from './approved-fence.mjs';
import {PIN,CHECKPOINT_REPO,CHECKPOINT_ID,canonical,need,HEX64} from './pins.mjs';
const enc=new TextEncoder(),path='/__private_operator/qualified-disposable-tests';
const json=(s,x)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
const hash=async x=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(x)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const decode=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function keys(env){
 const jwk=JSON.parse(env.HW_SIGNING_JWK);need(jwk?.x===PIN.public_key_jwk.x&&jwk.kty==='OKP'&&jwk.crv==='Ed25519'&&typeof jwk.d==='string','A2QUAL_SIGNER_PIN_HOLD');
 return {privateKey:await crypto.subtle.importKey('jwk',{kty:'OKP',crv:'Ed25519',x:jwk.x,d:jwk.d},'Ed25519',false,['sign']),publicKey:await crypto.subtle.importKey('jwk',PIN.public_key_jwk,'Ed25519',false,['verify'])};
}
async function signed(env,payload){const k=await keys(env);return {payload,signature:encode(await crypto.subtle.sign('Ed25519',k.privateKey,enc.encode(canonical(payload))))};}
async function verified(env,envelope){const k=await keys(env);need(envelope&&typeof envelope.signature==='string'&&await crypto.subtle.verify('Ed25519',k.publicKey,decode(envelope.signature),enc.encode(canonical(envelope.payload))),'A2QUAL_SIGNATURE_HOLD');return envelope.payload;}
function control(env){
 need(canonical(JSON.parse(env.HW_CONFIG_JSON))===canonical(PIN),'A2QUAL_DISPOSABLE_PIN_HOLD');
 const p=JSON.parse(env.HW_GENESIS_CONTROL_JSON),now=Date.now();
 need(p.schema==='musitu.axiom.authority2.private-hosted-plan.v1'&&['HOSTED_CASES','REVOCATION'].includes(p.phase)&&HEX64.test(p.nonce)&&HEX64.test(p.genesis_sha256)&&typeof p.cron==='string'&&Number.isSafeInteger(p.not_before_ms)&&Number.isSafeInteger(p.not_after_ms)&&p.not_after_ms>now&&p.not_before_ms<=now&&p.not_after_ms-p.not_before_ms>0&&p.not_after_ms-p.not_before_ms<=900000,'A2QUAL_WINDOW_OR_PLAN_HOLD');
 need(Array.isArray(p.events)&&p.events.length===4&&Array.isArray(p.anchors)&&p.anchors.length===4,'A2QUAL_EVENT_PLAN_HOLD');
 need(p.anchor_pin?.repository===CHECKPOINT_REPO&&p.anchor_pin.repository_id===CHECKPOINT_ID&&p.anchor_pin.namespace===PIN.namespace&&/^[a-f0-9]{40}$/.test(p.anchor_pin.target_commitish)&&Array.isArray(p.anchor_payloads)&&p.anchor_payloads.length===4,'A2QUAL_IMMUTABLE_REPOSITORY_PIN_HOLD');
 for(let i=0;i<4;i++)need(p.events[i].sequence===i&&p.events[i].previous_sequence===i-1&&p.events[i].ledger_id===PIN.ledger_id&&p.events[i].namespace===PIN.namespace&&p.events[i].previous_head===(i?p.events[i-1].head:'0'.repeat(64))&&['head','previous_head','event_digest','artifact_sha256','action_sha256'].every(k=>HEX64.test(p.events[i][k])),'A2QUAL_EVENT_PLAN_HOLD');
 for(const v of [env.HW_GENESIS_CONTROL_TOKEN,p.read_token,p.write_token])need(typeof v==='string'&&/^[A-Za-z0-9_-]{32,200}$/.test(v),'A2QUAL_PRIVATE_CAPABILITY_HOLD');
 need(p.read_token!==p.write_token,'A2QUAL_DISTINCT_ROLES_HOLD');return p;
}
const storageKey=k=>['highwater/genesis','highwater/tip','highwater/pending'].includes(k)||/^highwater\/event\/00000000000[0-3]$/.test(k);
async function snapshot(ctx,env){const m=await ctx.storage.list();need(m instanceof Map&&m.size<=8&&[...m.keys()].every(storageKey)&&await ctx.storage.getAlarm()===null,'A2QUAL_DISPOSABLE_STATE_HOLD');return signed(env,{schema:'musitu.axiom.authority2.disposable-snapshot.v1',pin:PIN,entries:[...m.entries()]});}
function snapshotMap(s){need(s?.schema==='musitu.axiom.authority2.disposable-snapshot.v1'&&canonical(s.pin)===canonical(PIN)&&Array.isArray(s.entries)&&s.entries.length<=8,'A2QUAL_SNAPSHOT_SCOPE_HOLD');const m=new Map(s.entries);need(m.size===s.entries.length&&[...m.keys()].every(storageKey),'A2QUAL_SNAPSHOT_KEYS_HOLD');return m;}
async function replace(ctx,m){
 // This is a deliberate, separately approved DISPOSABLE fault/recovery action.
 // No bucket or checkpoint is erased, and there is no production reset path.
 await ctx.storage.transaction(async tx=>{const current=await tx.list();need([...current.keys()].every(storageKey)&&current.size<=8,'A2QUAL_STATE_CHANGED_HOLD');for(const k of current.keys())await tx.delete(k);for(const [k,v]of m)await tx.put(k,v);});await ctx.storage.sync();
}
async function anchor(env,p,event){const i=event.sequence;await verifyGithubCheckpoint({pin:p.anchor_pin,token:env.HW_GENESIS_GITHUB_READ_TOKEN,payload:{...p.anchor_payloads[i],anchor:p.anchors[i]}});}
async function guard(bucket,p,operation){const key='operator-qualification/'+p.nonce+'/'+p.phase+'/'+operation+'.json';const r=await bucket.put(key,canonical({schema:'musitu.axiom.authority2.one-shot-hosted-action.v1',nonce:p.nonce,phase:p.phase,operation}),{onlyIf:new Headers({'if-none-match':'*'})});need(!!r,'A2QUAL_ONCE_GUARD_HOLD');}
export class Authority2Highwater extends ServingAuthority{
 async fetch(request){
  if(new URL(request.url).pathname!==path)return super.fetch(request);
  try{
   const p=control(this.env);need(request.method==='POST'&&request.headers.get('authorization')==='Bearer '+this.env.HW_GENESIS_CONTROL_TOKEN,'A2QUAL_PRIVATE_CHANNEL_HOLD');
   const text=await request.text();need(text.length<=32768,'A2QUAL_PRIVATE_INPUT_SIZE_HOLD');const v=JSON.parse(text);need(canonical(v)===text&&typeof v.operation==='string','A2QUAL_PRIVATE_INPUT_HOLD');
   if(v.operation==='SNAPSHOT')return json(200,await snapshot(this.ctx,this.env));
   await guard(this.env.HIGHWATER_WORM,p,v.operation);
   if(v.operation==='CHECK_GENESIS'){
    const g=await this.ctx.storage.get('highwater/genesis'),t=await this.ctx.storage.get('highwater/tip');
    need(g?.commitment_sha256===p.genesis_sha256&&t?.sequence===-1&&t.head==='0'.repeat(64),'A2QUAL_GENESIS_STATE_HOLD');
    const o=await this.env.HIGHWATER_WORM.get(g.barrier_key);need(o&&o.size<8192&&JSON.parse(await o.text()).commitment_sha256===p.genesis_sha256,'A2QUAL_GENESIS_BARRIER_HOLD');
    return json(200,{checked:true,sequence:-1});
   }
   if(v.operation==='INJECT_STALE'||v.operation==='RECOVER_SNAPSHOT'){
    const s=await verified(this.env,v.snapshot),m=snapshotMap(s);need(!m.has('highwater/pending'),'A2QUAL_RECOVERY_PENDING_SNAPSHOT_HOLD');
    if(v.operation==='INJECT_STALE')need(m.get('highwater/tip')?.sequence===-1,'A2QUAL_STALE_TARGET_HOLD');
    else{const tip=m.get('highwater/tip');need(tip?.sequence===0,'A2QUAL_RECOVERY_SEQUENCE_HOLD');await anchor(this.env,p,p.events[0]);await wormReadback(this.env.HIGHWATER_WORM,PIN,tip);}
    await replace(this.ctx,m);return json(200,{restored:true,dispatch_allowed:false});
   }
   if(v.operation==='AMBIGUOUS_APPEND'){
    const e=p.events[1];await anchor(this.env,p,e);let committed=false;const original=this.worm;
    this.worm={head:(...a)=>original.head(...a),get:(...a)=>original.get(...a),put:async(...a)=>{const r=await original.put(...a);if(r){committed=true;throw Error('INJECTED_ACK_LOSS_AFTER_REAL_R2_WRITE');}return r;}};
    let r;try{r=await super.fetch(appendRequest(e,p.write_token));}finally{this.worm=original;}
    need(committed&&r.status===503&&!!(await this.ctx.storage.get('highwater/pending'))&&!!(await original.head(wormKey(PIN,1))),'A2QUAL_REAL_COMMIT_FAULT_HOLD');
    return json(200,{actual_r2_commit_observed:true,caller_result:503,pending_retained:true,dispatch_allowed:false});
   }
   if(v.operation==='RECOVER_PENDING'){
    const s=await verified(this.env,v.snapshot),m=snapshotMap(s),pending=m.get('highwater/pending');
    need(canonical([...await this.ctx.storage.list()])===canonical(s.entries)&&pending?.record?.sequence===1&&pending.next?.sequence===1,'A2QUAL_PENDING_SNAPSHOT_HOLD');
    await anchor(this.env,p,p.events[1]);const o=await this.env.HIGHWATER_WORM.get(wormKey(PIN,1));need(o&&o.size<4096&&await o.text()===canonical(pending.record),'A2QUAL_PENDING_R2_READBACK_HOLD');
    await wormReadback(this.env.HIGHWATER_WORM,PIN,pending.next);m.set('highwater/event/000000000001',pending.record);m.set('highwater/tip',pending.next);m.delete('highwater/pending');
    await replace(this.ctx,m);return json(200,{recovered_sequence:1,dispatch_allowed:false});
   }
   if(v.operation==='LOCK_TEST'){
    const b=this.env.HIGHWATER_WORM,free='operator-delete-control/'+p.nonce,locked='b27/operator-lock-canary/'+p.nonce,body=canonical({nonce:p.nonce,purpose:'NEW_DISPOSABLE_RETENTION_CANARY'});
    need(!await b.head(free)&&!await b.head(locked),'A2QUAL_CANARY_PREEXISTS_HOLD');
    need(!!await b.put(free,body,{onlyIf:new Headers({'if-none-match':'*'})}),'A2QUAL_DELETE_CONTROL_PUT_HOLD');await b.delete(free);need(!await b.head(free),'A2QUAL_DELETE_CONTROL_HOLD');
    need(!!await b.put(locked,body,{onlyIf:new Headers({'if-none-match':'*'})}),'A2QUAL_LOCK_CANARY_PUT_HOLD');try{await b.delete(locked);}catch{}
    const remain=await b.get(locked);need(remain&&await remain.text()===body,'A2QUAL_RETENTION_DELETE_NOT_DENIED_HOLD');
    return json(200,{unlocked_control_deleted:true,new_retained_canary_delete_denied:true,existing_history_targeted:false});
   }
   need(false,'A2QUAL_OPERATION_NOT_ALLOWED_HOLD');
  }catch(e){return json(503,{error:typeof e?.code==='string'&&/^A2QUAL_[A-Z0-9_]+$/.test(e.code)?e.code:'A2QUAL_HOSTED_OPERATION_UNKNOWN_HOLD',dispatch_allowed:false});}
 }
}
function common(){return {schema:'musitu.axiom.external-highwater.v1',account_id:PIN.account_id,ledger_id:PIN.ledger_id,namespace:PIN.namespace,key_id:PIN.key_id,challenge:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')};}
function appendRequest(e,token){return new Request('https://private.invalid/v1/highwater/append',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:canonical({...common(),...e})});}
async function runHosted(controller,env){
 controller.noRetry();const p=control(env);need(controller.cron===p.cron&&controller.scheduledTime>=p.not_before_ms&&controller.scheduledTime<p.not_after_ms,'A2QUAL_SCHEDULE_CONTEXT_HOLD');
 await guard(env.HIGHWATER_WORM,p,'WHOLE_PLAN');
 const stub=env.HIGHWATER_STATE.get(env.HIGHWATER_STATE.idFromName('highwater/'+PIN.ledger_id+'/'+PIN.namespace)),cases=[];
 const op=async(operation,extra={})=>{const r=await stub.fetch(new Request('https://private.invalid'+path,{method:'POST',headers:{authorization:'Bearer '+env.HW_GENESIS_CONTROL_TOKEN,'content-type':'application/json'},body:canonical({operation,...extra})}));const body=await r.json();need(r.status===200,typeof body.error==='string'&&/^A2QUAL_[A-Z0-9_]+$/.test(body.error)?body.error:'A2QUAL_PRIVATE_CASE_HOLD');return body;};
 const read=async token=>stub.fetch(new Request('https://private.invalid/v1/highwater/readback',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:canonical(common())}));
 const pass=(name,details={})=>cases.push({name,status:'PASS',...details});
 if(p.phase==='REVOCATION'){
  need((await read(p.old_read_token)).status===403&&(await stub.fetch(appendRequest(p.events[3],p.old_write_token))).status===403,'A2QUAL_OLD_ROLES_NOT_REVOKED_HOLD');pass('provider_backed_old_role_credentials_denied');
  const before=await read(p.read_token);need(before.status===200,'A2QUAL_NEW_READ_ROLE_HOLD');const b=await verified(env,await before.json());need(b.sequence===2,'A2QUAL_REVOCATION_TIP_HOLD');
  await anchor(env,p,p.events[3]);const r=await stub.fetch(appendRequest(p.events[3],p.write_token));need(r.status===200,'A2QUAL_NEW_WRITE_ROLE_HOLD');const c=await verified(env,await r.json());need(c.sequence===3,'A2QUAL_NEW_WRITE_ROLE_HOLD');
  need((await stub.fetch(appendRequest(p.events[3],p.write_token))).status===409,'A2QUAL_NEW_ROLE_REPLAY_HOLD');pass('new_roles_operate_and_consumed_sequence_still_denied');
 }else{
  await op('CHECK_GENESIS');const initial=await op('SNAPSHOT');pass('actual_genesis_DO_and_R2_barrier_correspond');
  pass('actual_indefinite_retention_enforced',await op('LOCK_TEST'));
  await anchor(env,p,p.events[0]);const first=await externalHighwaterFence({pin:{...PIN,origin:'https://private.invalid'},event:p.events[0],write_token:p.write_token,read_token:p.read_token,fetchImpl:(u,o)=>stub.fetch(new Request(u,o))});need(first.sequence===0,'A2QUAL_BOOTSTRAP_HOLD');pass('actual_signed_bootstrap_and_separate_readback');
  need((await stub.fetch(appendRequest(p.events[0],p.write_token))).status===409,'A2QUAL_REPLAY_HOLD');pass('consumed_sequence_replay_denied');
  need((await stub.fetch(appendRequest(p.events[1],p.read_token))).status===403&&(await read(p.write_token)).status===403,'A2QUAL_ROLE_SEPARATION_HOLD');pass('distinct_read_and_write_roles_enforced');
  const latest=await op('SNAPSHOT');await op('INJECT_STALE',{snapshot:initial});
  need((await stub.fetch(appendRequest(p.events[0],p.write_token))).status===503&&(await read(p.read_token)).status===503,'A2QUAL_STALE_RESTORE_NOT_HELD_HOLD');pass('actual_stale_DO_restore_cannot_reissue_permission');
  await op('RECOVER_SNAPSHOT',{snapshot:latest});const restored=await read(p.read_token);need(restored.status===200&&(await verified(env,await restored.json())).sequence===0,'A2QUAL_SNAPSHOT_RECOVERY_HOLD');
  need((await stub.fetch(appendRequest(p.events[0],p.write_token))).status===409,'A2QUAL_RECOVERED_REPLAY_HOLD');pass('operator_snapshot_recovery_verified_against_R2_and_immutable_GitHub');
  const ambiguous=await op('AMBIGUOUS_APPEND');need(ambiguous.pending_retained===true,'A2QUAL_PENDING_NOT_RETAINED_HOLD');
  need((await stub.fetch(appendRequest(p.events[1],p.write_token))).status===503&&(await read(p.read_token)).status===503,'A2QUAL_AMBIGUOUS_RETRY_NOT_HELD_HOLD');pass('actual_R2_commit_with_injected_lost_ack_retains_pending');
  const pending=await op('SNAPSHOT');await op('RECOVER_PENDING',{snapshot:pending});
  need((await stub.fetch(appendRequest(p.events[1],p.write_token))).status===409,'A2QUAL_RECONCILED_REPLAY_HOLD');pass('operator_pending_reconciliation_emits_no_dispatch_and_replay_denied');
  await anchor(env,p,p.events[2]);let committed=false,permitted=false;
  try{await externalHighwaterFence({pin:{...PIN,origin:'https://private.invalid'},event:p.events[2],write_token:p.write_token,read_token:p.read_token,fetchImpl:async(u,o)=>{const r=await stub.fetch(new Request(u,o));if(new URL(u).pathname.endsWith('/append')&&r.status===200){committed=true;throw new DOMException('Injected caller abort after external commit','AbortError');}return r;}});permitted=true;}catch{}
  need(committed&&!permitted,'A2QUAL_ABORT_DISPATCH_HOLD');const after=await read(p.read_token);need(after.status===200&&(await verified(env,await after.json())).sequence===2,'A2QUAL_ABORT_COMMIT_READBACK_HOLD');
  need((await stub.fetch(appendRequest(p.events[2],p.write_token))).status===409,'A2QUAL_ABORT_REPLAY_HOLD');pass('injected_caller_abort_after_actual_external_commit_never_returns_permit');
 }
 return signed(env,{schema:'musitu.axiom.authority2.hosted-disposable-results.v1',pin:PIN,nonce:p.nonce,phase:p.phase,genesis_sha256:p.genesis_sha256,cases,fault_origin:'OPERATOR_CONTROLLED_INJECTION_ON_ACTUAL_PROVIDER_STATE',private_hosted_tests_completed:true,independent_review_still_required:true,gate3_closed:false,B27:'FAILED_IN_SYNTHETIC_ATTACK',release_status:'NOT_RELEASE'});
}
export {runHosted};
export default{fetch(){return json(404,{error:'NO_PUBLIC_OPERATOR_ROUTE',dispatch_allowed:false});},async scheduled(controller,env){try{const r=await runHosted(controller,env);console.log('AXIOM_A2_OPERATOR_SIGNED_RESULT',JSON.stringify(r));}catch{console.error('AXIOM_A2_OPERATOR_HOSTED_UNKNOWN_HOLD');throw Error('AXIOM_A2_OPERATOR_HOSTED_UNKNOWN_HOLD');}}};
