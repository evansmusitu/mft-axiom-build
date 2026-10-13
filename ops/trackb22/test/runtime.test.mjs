import {describe,it,expect} from 'vitest';
import {SELF,env,runInDurableObject} from 'cloudflare:test';
import {utcDay,canonicalName} from '../../trackb16/src/identity.mjs';
import {journalName} from '../src/worker.mjs';

const ACCOUNT='axiom-s0-isolated';
function fixture(agent,ordinal){return {agent,ordinal:String(ordinal),raw_b64:btoa(JSON.stringify({
  model:'b12-synthetic',stream:false,messages:[{role:'user',content:'synthetic OpenHands SDK request'}],
  tools:[{function:{name:'file_editor'}},{function:{name:'finish'}}]
}))};}
function post(agent,ordinal,secret=env.AXIOM_B22_TEST_SECRET){return SELF.fetch('http://localhost/_internal_s0_admit',{
  method:'POST',headers:{'content-type':'application/json','X-Axiom-B21-Local-Secret':secret},
  body:JSON.stringify(fixture(agent,ordinal))});}
const journal=()=>env.AXIOM_JOURNAL_S0.getByName(journalName(ACCOUNT,utcDay()));
const quota=()=>env.AXIOM_QUOTA_S0.getByName(canonicalName(ACCOUNT,utcDay()));

describe('B22 S0 real local Workerd integration and negative proofs',()=>{
 it('one signed quota permission generates one journaled transport attempt, never two',async()=>{
   expect((await SELF.fetch('http://localhost/')).status).toBe(403);
   expect((await post('agent-a',0,'unauthorized')).status).toBe(403);
   const first=await post('agent-a',0);
   expect(first.status).toBe(200);
   expect(await first.json()).toMatchObject({status:'COMPLETED',synthetic:true,dispatch_allowed:false,request_id:'b22-agent-a-0'});
   const duplicate=await post('agent-a',0);
   expect(duplicate.status).toBe(409);
   expect((await duplicate.json()).dispatch_allowed).toBe(false);
   const [a,b]=await Promise.all([post('agent-a',1),post('agent-b',0)]);
   expect([a.status,b.status]).toEqual([200,200]);
   await runInDurableObject(journal(),async(_instance,state)=>{
     const rows=state.storage.sql.exec('SELECT request_id,state FROM b22_dispatch ORDER BY request_id').toArray();
     expect(rows).toEqual([
       {request_id:'b22-agent-a-0',state:'COMPLETED'},
       {request_id:'b22-agent-a-1',state:'COMPLETED'},
       {request_id:'b22-agent-b-0',state:'COMPLETED'},
     ]);
   });
   await runInDurableObject(quota(),async(_instance,state)=>{
     expect(state.storage.sql.exec('SELECT * FROM reservations').toArray()).toHaveLength(3);
   });
   const result=await journal().begin({account_id:ACCOUNT,utc_day:utcDay(),request_id:'b22-agent-a-0',
     tenant_id:'tenant-b22-synthetic',workload_id:'agent-a',body_sha:(await journal().lookup({request_id:'b22-agent-a-0'})).body_sha,
     quota_grant_id:'b22-local-agent-a'});
   expect(result).toMatchObject({state:'COMPLETED',send_allowed:false});
 });
 it('forged alternative journal object cannot initialize or reserve',async()=>{
   const fake=env.AXIOM_JOURNAL_S0.getByName(journalName(ACCOUNT,utcDay())+':attacker');
   expect(fake.name).not.toBe(journal().name);
   expect(await fake.begin({})).toMatchObject({status:'DENIED',send_allowed:false,reason:'NONCANONICAL_JOURNAL_OBJECT'});
   await runInDurableObject(fake,async(instance,state)=>{
     expect(instance.journal).toBe(null);
     expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='b22_dispatch'").toArray()).toEqual([]);
   });
 });
});
