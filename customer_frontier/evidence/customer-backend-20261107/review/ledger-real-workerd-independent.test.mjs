import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../customer-hosted-acceptance-20261107/customer_frontier/runtime_acceptance/package.json',import.meta.url));
const {Miniflare}=require('miniflare');
const root=resolve(import.meta.dirname,'../customer-hosted-acceptance-20261107');
const ledger=await readFile(join(root,'customer_frontier/customer_control_plane/ledger.mjs'),'utf8');
const plan=JSON.parse(await readFile(join(root,'customer_frontier/qualification/customer-hosted-plan-20261106.json')));
const hash=createHash('sha256').update(ledger).digest('hex');
const script=`import {reserve,finishHold,balance} from './ledger.mjs';
export default {async fetch(request,env){
 const input=await request.json(),tenant='controlled-'+input.label;
 await env.DB.batch([env.DB.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').bind(tenant,'CONTROLLED_NOT_CUSTOMER'),env.DB.prepare('INSERT INTO credit_ledger(id,tenant_id,delta,source_key) VALUES(?,?,10,?)').bind(tenant+'-grant',tenant,'CONTROLLED_NOT_PAYMENT')]);
 const h=await reserve(env.DB,tenant,tenant+'-reservation',7);
 let readers=0,release;const gate=new Promise(r=>release=r);
 const wrap=(real,sql)=>({_raw:real,bind(...p){return wrap(real.bind(...p),sql);},async first(...p){const row=await real.first(...p);if(sql==='SELECT * FROM holds WHERE id=? AND tenant_id=?'){if(++readers===2)release();await gate;}return row;},all(...p){return real.all(...p);},run(...p){return real.run(...p);}});
 const db={prepare:sql=>wrap(env.DB.prepare(sql),sql),batch:items=>env.DB.batch(items.map(p=>p._raw))};
 const outcomes=await Promise.allSettled(input.modes.map(mode=>finishHold(db,tenant,h.id,mode)));
 const hold=await env.DB.prepare('SELECT state FROM holds WHERE id=?').bind(h.id).first();
 const credit=await balance(env.DB,tenant),charges=(await env.DB.prepare('SELECT delta FROM credit_ledger WHERE source_key=?').bind('usage:'+h.id).all()).results;
 return Response.json({state:hold.state,booked:credit.booked,charges:charges.map(x=>x.delta),outcomes:outcomes.map(x=>({status:x.status,error:x.reason?.message})),readers});
}};`;
test('native D1 concurrent terminal races conserve credit for both mixed orders and duplicate finishes',async()=>{
 const folder=await mkdtemp(resolve(import.meta.dirname,'workerd-ledger-'));let mf;
 try{
  mf=new Miniflare({cf:false,host:'127.0.0.1',modulesRoot:folder,modules:[{type:'ESModule',path:join(folder,'worker.mjs'),contents:script},{type:'ESModule',path:join(folder,'ledger.mjs'),contents:ledger}],compatibilityDate:'2026-07-01',d1Databases:{DB:'only-local-ledger-race'},outboundService:()=>{throw Error('external_egress_denied');}});
  const db=await mf.getD1Database('DB');await db.batch(plan.statements.map(s=>db.prepare(s)));
  for(const [i,modes]of [['released','committed'],['committed','released'],['committed','committed'],['released','released']].entries()){
   const response=await mf.dispatchFetch('https://fixture.test/race',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:String(i),modes})});assert.equal(response.status,200,await response.clone().text());const out=await response.json();assert.equal(out.readers,2);assert(['released','committed'].includes(out.state));assert.equal(out.charges.length,out.state==='committed'?1:0);assert.equal(out.booked,out.state==='committed'?3:10);assert(out.charges.every(x=>x===-7));console.log(JSON.stringify({case:modes,ledger_sha256:hash,result:out}));
  }
 }finally{if(mf)await mf.dispose();await rm(folder,{recursive:true,force:true});}
});
test('native D1 abort after provisional debit rolls debit and terminal state back together',async()=>{
 const folder=await mkdtemp(resolve(import.meta.dirname,'workerd-ledger-abort-'));let mf;
 try{
  const abortScript=`import {reserve,finishHold,balance} from './ledger.mjs';export default {async fetch(req,env){const h=await reserve(env.DB,'fixture-abort','fixture-reservation',7);let error;try{await finishHold(env.DB,'fixture-abort',h.id,'committed');}catch(e){error=e.message;}return Response.json({error,state:(await env.DB.prepare('SELECT state FROM holds WHERE id=?').bind(h.id).first()).state,credit:await balance(env.DB,'fixture-abort'),charges:(await env.DB.prepare("SELECT count(*) AS n FROM credit_ledger WHERE source_key LIKE 'usage:%'").first()).n});}};`;
  mf=new Miniflare({cf:false,host:'127.0.0.1',modulesRoot:folder,modules:[{type:'ESModule',path:join(folder,'worker.mjs'),contents:abortScript},{type:'ESModule',path:join(folder,'ledger.mjs'),contents:ledger}],compatibilityDate:'2026-07-01',d1Databases:{DB:'only-local-ledger-abort'},outboundService:()=>{throw Error('external_egress_denied');}});
  const db=await mf.getD1Database('DB');await db.batch([...plan.statements.map(s=>db.prepare(s)),db.prepare("INSERT INTO tenants(id,name) VALUES('fixture-abort','CONTROLLED_NOT_CUSTOMER')"),db.prepare("INSERT INTO credit_ledger(id,tenant_id,delta,source_key) VALUES('grant','fixture-abort',10,'CONTROLLED_NOT_PAYMENT')"),db.prepare("CREATE TRIGGER fixture_abort_update BEFORE UPDATE OF state ON holds WHEN NEW.state='committed' BEGIN SELECT RAISE(ABORT,'fixture_transition_abort'); END")]);
  const response=await mf.dispatchFetch('https://fixture.test/abort');assert.equal(response.status,200);const out=await response.json();assert(out.error);assert.equal(out.state,'open');assert.equal(out.credit.booked,10);assert.equal(out.credit.reserved,7);assert.equal(out.charges,0);console.log(JSON.stringify({ledger_sha256:hash,abort:out}));
 }finally{if(mf)await mf.dispose();await rm(folder,{recursive:true,force:true});}
});
