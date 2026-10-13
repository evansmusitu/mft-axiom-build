import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

function runChild(file,start,kill=false){
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',new URL('./journal_child.mjs',import.meta.url).pathname],{
   env:{...process.env,B22_SQLITE_PATH:file,B22_START_FILE:start,B22_TERMINATE_AFTER_COMMIT:kill?'1':'0'},stdio:['ignore','pipe','pipe']});
 let out='',err='',readyResolve;
 const ready=new Promise(r=>{readyResolve=r;});
 child.stdout.on('data',d=>{out+=d;if(out.includes('B22_CHILD_READY'))readyResolve();});
 child.stderr.on('data',d=>err+=d);
 return {child,ready,wait:()=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CHILD_TIMEOUT '+out+' '+err.slice(-300)));},15000);
   child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,out,err});});
 })};
}
function setup(){
 const dir=mkdtempSync('/tmp/axiom-b22-multi-'),file=join(dir,'db.sqlite'),start=join(dir,'go');
 const db=new DatabaseSync(file);
 db.exec(`CREATE TABLE IF NOT EXISTS b22_dispatch (request_id TEXT PRIMARY KEY, account_id TEXT NOT NULL,utc_day TEXT NOT NULL,
   tenant_id TEXT NOT NULL,workload_id TEXT NOT NULL,body_sha TEXT NOT NULL,quota_grant_id TEXT NOT NULL,
   state TEXT NOT NULL CHECK(state IN ('ISSUED','COMPLETED','UNKNOWN')),
   result_sha TEXT,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL)`);
 db.close();return {dir,file,start};
}
test('eight separate broker processes cannot obtain two transport permits',async()=>{
 const {dir,file,start}=setup();
 try{
   const p=Array.from({length:8},()=>runChild(file,start));
   await Promise.race([Promise.all(p.map(x=>x.ready)),new Promise((_,reject)=>setTimeout(()=>reject(Error('CHILD_READY_TIMEOUT')),8000))]);
   writeFileSync(start,'GO');
   const receipts=await Promise.all(p.map(x=>x.wait()));
   for(const r of receipts)assert.equal(r.code,0,r.err+' '+r.out);
   const decisions=receipts.map(r=>{const line=r.out.split('\n').find(s=>s.startsWith('B22_CHILD_RECEIPT='));assert.ok(line,r.out);return JSON.parse(line.split('=',2)[1]);});
   assert.equal(decisions.filter(x=>x.send_allowed===true).length,1);
   assert.equal(decisions.filter(x=>x.send_allowed===false).length,7);
   const db=new DatabaseSync(file);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM b22_dispatch').get().n,1);db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('SIGKILL immediately after durable ISSUE leaves replay unable to resend',async()=>{
 const {dir,file,start}=setup();
 try{
   writeFileSync(start,'GO');
   const one=runChild(file,start,true);const first=await one.wait();
   assert.equal(first.signal,'SIGKILL',first.out+' '+first.err);
   assert.match(first.out, /"send_allowed":true/);
   const next=runChild(file,start);const recovered=await next.wait();
   assert.equal(recovered.code,0,recovered.err);
   assert.match(recovered.out,/"send_allowed":false/);
   const db=new DatabaseSync(file);assert.equal(db.prepare('SELECT state FROM b22_dispatch').get().state,'ISSUED');db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
