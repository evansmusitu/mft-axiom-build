import test from 'node:test';import assert from 'node:assert/strict';
import {provision,STAGE} from '../src/staging/provision.mjs';
const dbId='11111111-2222-3333-4444-555555555555',queueId='a'.repeat(32),token='fake-local-credential-token-123456';
const schema="CREATE TABLE IF NOT EXISTS mail_messages (id TEXT); CREATE TABLE mail_provider_events (id TEXT)";
function fake({initial=true,failReadback=false}={}){
 const calls=[], state={db:initial,queue:initial};
 async function fetchImpl(url,opts){
  const u=new URL(url),path=u.pathname,method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):{};
  calls.push({path,method,body});
  let status=200,result;
  if(path===`/client/v4/accounts/${STAGE.account}`)result={id:STAGE.account};
  else if(path.endsWith('/d1/database')&&method==='GET')result=state.db?[{name:STAGE.database,uuid:dbId}]:[];
  else if(path.endsWith('/queues')&&method==='GET')result=state.queue?[{queue_name:STAGE.queue,queue_id:queueId}]:[];
  else if(path.endsWith('/d1/database')&&method==='POST'){state.db=true;result={name:STAGE.database,uuid:dbId};}
  else if(path.endsWith('/queues')&&method==='POST'){state.queue=true;result={queue_name:STAGE.queue,queue_id:queueId};}
  else if(path.endsWith('/d1/database/'+dbId)&&method==='GET')result={name:STAGE.database,uuid:dbId};
  else if(path.endsWith('/queues/'+queueId)&&method==='GET')result={queue_name:STAGE.queue,queue_id:queueId};
  else if(path.endsWith('/d1/database/'+dbId+'/query'))result=[{results:body.sql.startsWith('SELECT')&&!failReadback?['mail_messages','mail_suppressions','mail_provider_events','mail_sender_domains'].map(name=>({name})):[]}];
  else{status=404;result=null;}
  return {ok:status===200,status,json:async()=>({success:status===200,result})};
 }
 return{calls,fetchImpl};
}
test('wrong Cloudflare account fails before first HTTP request',async()=>{
 const m=fake();await assert.rejects(()=>provision({account:'different',dbToken:token,queueToken:token,schema,fetchImpl:m.fetchImpl,dryRun:false}),/ACCOUNT_SCOPE_MISMATCH/);assert.equal(m.calls.length,0);
});
test('read-only preflight creates absolutely no resources',async()=>{
 const m=fake({initial:false});const out=await provision({account:STAGE.account,dbToken:token,queueToken:token,schema,fetchImpl:m.fetchImpl});
 assert.equal(out.status,'READ_ONLY');assert.ok(m.calls.every(c=>c.method==='GET'));
});
test('stage creates ONLY exact named D1 and queue, proves four schema tables',async()=>{
 const m=fake({initial:false});const out=await provision({account:STAGE.account,dbToken:token,queueToken:token,schema,fetchImpl:m.fetchImpl,dryRun:false});
 assert.equal(out.status,'STAGING_RESOURCES_READY');assert.equal(out.tableCount,4);
 const writes=m.calls.filter(c=>c.method!=='GET');assert.equal(writes.length,4);
 assert.deepEqual(writes.map(c=>c.method),['POST','POST','POST','POST']);
 assert.equal(writes[0].body.name,STAGE.database);assert.equal(writes[1].body.queue_name,STAGE.queue);
 assert.ok(writes.every(x=>!x.path.includes('/workers/scripts/')&&!x.path.includes('/zones/')));
});
test('existing stage is idempotently verified and no resources recreated',async()=>{
 const m=fake();const out=await provision({account:STAGE.account,dbToken:token,queueToken:token,schema,fetchImpl:m.fetchImpl,dryRun:false});
 assert.equal(out.status,'STAGING_RESOURCES_READY');assert.equal(m.calls.filter(x=>x.method==='POST').length,2);
});
test('schema mismatch or cloud readback failure fails closed',async()=>{
 const m=fake({failReadback:true});await assert.rejects(()=>provision({account:STAGE.account,dbToken:token,queueToken:token,schema,fetchImpl:m.fetchImpl,dryRun:false}),/D1_SCHEMA_READBACK_FAILED/);
 const n=fake();await assert.rejects(()=>provision({account:STAGE.account,dbToken:token,queueToken:token,schema:'CREATE TABLE x',fetchImpl:n.fetchImpl,dryRun:false}),/UNEXPECTED_SCHEMA/);assert.equal(n.calls.length,0);
});

test('Cloudflare D1 account capacity error 7406 fails closed without queue mutation or billing fallback',async()=>{
  const m=fake({initial:false});
  const writes=[];
  const fetchImpl=async(url,opts)=>{
    const method=opts.method||'GET';
    if(method==='POST'&&new URL(url).pathname.endsWith('/d1/database')){
      writes.push('D1_DENIED');
      return {ok:false,status:403,json:async()=>({success:false,errors:[{code:7406}]})};
    }
    if(method==='POST')writes.push(new URL(url).pathname);
    return m.fetchImpl(url,opts);
  };
  await assert.rejects(()=>provision({account:STAGE.account,dbToken:token,queueToken:token,schema,fetchImpl,dryRun:false}),/D1_ACCOUNT_DATABASE_LIMIT/);
  assert.deepEqual(writes,['D1_DENIED']);
});
