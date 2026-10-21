import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Run real proof logic with fake provider. Never equivalent to hosted PITR.
const file=new URL('../../../ops/studio_v03_pitr_cron_kv_isolated_20261021.mjs',import.meta.url);
async function simulate(mode){
  const script=readFileSync(file,'utf8').replace("import {DurableObject} from 'cloudflare:workers';",'')
    .replace('export class StudioV03CronPitrProof','class StudioV03CronPitrProof')
    .replace('export default {','globalThis.worker={');
  const scope={DurableObject:class{},URL,Request,Response,setTimeout:f=>f(),console:{log(){}}};
  runInNewContext(script,scope);
  let rows=['later','original'],life;const calls=[],data=new Map();
  const respond=(body,status=200)=>new Response(JSON.stringify(body),{status});
  const env={STUDIO_PITR_RECEIPTS:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)},
    STUDIO_CRON_PITR:{idFromName:()=>1,get:()=>({fetch:async url=>{
      const path=new URL(url).pathname;calls.push(path);
      if(path==='/begin')return respond({ok:true,bookmark:'0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b',mutated:true});
      if(path==='/restore'){
        if(mode===409||mode===500)return respond({error:mode===409?'RESTORE_PREREQUISITE_FAILED':'EXPECTED_ABORT_DID_NOT_OCCUR'},mode);
        if(mode==='restart'){rows=['original'];throw Error('expected disconnect')}
        return respond({ok:true});
      }
      if(path==='/snapshot')return respond({ok:true,names:rows});
      throw Error('unexpected path');
    }})}};
  await scope.worker.scheduled({},env,{waitUntil:p=>life=p});await life;
  return {r:JSON.parse(data.get('receipt')),calls};
}
for(const [mode,outcome,stage,restored] of [
  [409,'HTTP_REJECTED','RESTORE_REQUEST',false],
  ['restart','DISCONNECTED','NONE',true],
  ['unrestored','HTTP_ACCEPTED','POLL_RESTORED_STATE',false],
  [500,'HTTP_SERVER_ERROR','POLL_RESTORED_STATE',false]
])test('private PITR diagnostic: '+mode,async()=>{
  const {r,calls}=await simulate(mode);
  assert.equal(r.restore_outcome,outcome);assert.equal(r.failure_stage,stage);
  assert.equal(r.restored,restored);assert.equal('bookmark' in r,false);
  if(mode===409){
    assert.equal(r.restore_http_status,409);
    assert.equal(r.restore_error_code,'RESTORE_PREREQUISITE_FAILED');
    assert.equal(calls.includes('/snapshot'),false);
  }else{
    assert.ok(calls.includes('/snapshot'));
    assert.equal(r.last_snapshot_state,restored?'ORIGINAL_ONLY':'MUTATED');
  }
  if(mode==='unrestored')assert.equal(r.snapshot_attempts,24);
});


test('a repeated Cron tick cannot re-run or overwrite the one-time hosted recovery proof',async()=>{
  const script=readFileSync(file,'utf8').replace("import {DurableObject} from 'cloudflare:workers';",'')
    .replace('export class StudioV03CronPitrProof','class StudioV03CronPitrProof')
    .replace('export default {','globalThis.worker={');
  const scope={DurableObject:class{},URL,Request,Response,setTimeout:f=>f(),console:{log(){}}};
  runInNewContext(script,scope);
  const data=new Map(),paths=[];
  const r=(body,status=200)=>new Response(JSON.stringify(body),{status});
  const env={STUDIO_PITR_RECEIPTS:{get:async k=>data.get(k)||null,put:async(k,v)=>data.set(k,v)},
    STUDIO_CRON_PITR:{idFromName:()=>1,get:()=>({fetch:async url=>{
      const p=new URL(url).pathname;paths.push(p);
      if(p==='/begin')return r({ok:true,bookmark:'0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b',mutated:true});
      if(p==='/restore')return r({ok:false,error:'RESTORE_PREREQUISITE_FAILED'},409);
      if(p==='/snapshot')return r({ok:true,names:['later','original']});
      throw Error('UNEXPECTED');
    }})}};
  let awaited;
  await scope.worker.scheduled({},env,{waitUntil:p=>awaited=p});await awaited;
  const first=data.get('receipt');assert.equal(JSON.parse(first).restored,false);
  await scope.worker.scheduled({},env,{waitUntil:p=>awaited=p});await awaited;
  assert.equal(paths.filter(x=>x==='/begin').length,1);
  assert.equal(data.get('receipt'),first);
  assert.equal(data.get('attempted'),'1');
});

test('the real disposable DO exposes only a fixed error when provider scheduling fails',async()=>{
  const script=readFileSync(file,'utf8').replace("import {DurableObject} from 'cloudflare:workers';",'')
    .replace('export class StudioV03CronPitrProof','globalThis.PitrDO=class StudioV03CronPitrProof')
    .replace('export default {','globalThis.worker={');
  const scope={DurableObject:class{},URL,Request,Response,setTimeout:f=>f(),console:{log(){}}};
  runInNewContext(script,scope);
  const sql={exec:s=>s.startsWith('SELECT name FROM')?[{name:'later'},{name:'original'}]:[]};
  let aborted=false;
  const object=new scope.PitrDO({storage:{sql,onNextSessionRestoreBookmark:async()=>{
    throw Error('private-provider-fault-details-must-not-leak');
  }},abort:()=>{aborted=true;}},{});
  const response=await object.fetch(new Request('https://internal.invalid/restore',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({bookmark:'0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b'})}));
  assert.equal(response.status,503);
  const body=await response.json();assert.equal(body.error,'RESTORE_SCHEDULE_FAILED');
  assert.equal(aborted,false);
  assert.equal(JSON.stringify(body).includes('private-provider'),false);
});
