import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const browser=process.env.BROWSER_BIN;
if(!browser) throw new Error('BROWSER_BIN is required');
if(typeof WebSocket!=='function') throw new Error('Node WebSocket runtime is required for CDP qualification');
const version=spawnSync(browser,['--version'],{encoding:'utf8'});
if(version.status!==0) throw new Error('browser version check failed: '+version.stderr);
console.log('BROWSER_RUNTIME='+version.stdout.trim());

const repoRoot=process.cwd();
const mime=new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8']]);
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    const decoded=decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file=path.resolve(repoRoot,decoded||'index.html');
    if(!file.startsWith(repoRoot+path.sep)) throw new Error('path outside repository');
    const body=await readFile(file);
    res.writeHead(200,{'content-type':mime.get(path.extname(file))||'application/octet-stream','cache-control':'no-store'});
    res.end(body);
  }catch(error){
    res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});
    res.end('not found: '+error.message);
  }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
const origin=`http://127.0.0.1:${port}`;
const profile=await mkdtemp(path.join(tmpdir(),'axiom-phase2-browser-profile-'));
const debugPort=9333;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitJson(url,timeoutMs=10000){
  const deadline=Date.now()+timeoutMs;
  let last;
  while(Date.now()<deadline){
    try{const response=await fetch(url);if(response.ok)return response.json();last=new Error('HTTP '+response.status);}catch(error){last=error;}
    await sleep(100);
  }
  throw new Error('CDP endpoint unavailable: '+(last?.message||'timeout'));
}
async function cdpSession(wsUrl){
  const ws=new WebSocket(wsUrl);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('CDP websocket open timeout')),5000);
    ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    ws.addEventListener('error',event=>{clearTimeout(timer);reject(new Error('CDP websocket error '+String(event?.message||'')));},{once:true});
  });
  let id=0;
  const pending=new Map();
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(!message.id)return;
    const waiter=pending.get(message.id);
    if(!waiter)return;
    pending.delete(message.id);
    if(message.error)waiter.reject(new Error(message.error.message||'CDP error'));
    else waiter.resolve(message.result);
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const callId=++id;
    pending.set(callId,{resolve,reject});
    ws.send(JSON.stringify({id:callId,method,params}));
  });
  return {ws,call};
}

async function launchSeparateTabRace(){
  const chrome=spawn(browser,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,`--remote-debugging-port=${debugPort}`,'about:blank',
  ],{stdio:['ignore','pipe','pipe']});
  let stderr='';
  chrome.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const openTarget=async phase=>{
    const targetUrl=`${origin}/axiom_interface/vnext/tests/product_intelligence_browser_execution_idempotency.html?phase=${encodeURIComponent(phase)}`;
    const created=await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`,{method:'PUT'});
    if(!created.ok)throw new Error('CDP target creation failed HTTP '+created.status);
    const target=await created.json();
    return cdpSession(target.webSocketDebuggerUrl);
  };
  const readResult=async cdp=>{
    const result=await cdp.call('Runtime.evaluate',{expression:"document.querySelector('#result')?.textContent || ''",returnByValue:true});
    return String(result?.result?.value||'');
  };
  const waitFor=async(cdp,predicate,label,timeoutMs=12000)=>{
    const deadline=Date.now()+timeoutMs;
    let value='';
    while(Date.now()<deadline){
      value=await readResult(cdp);
      if(predicate(value))return value;
      await sleep(100);
    }
    throw new Error(label+' timeout with '+value);
  };
  try{
    await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    const a=await openTarget('tab-race');
    const b=await openTarget('tab-race');
    await Promise.all([
      waitFor(a,value=>value==='MUSITU_AXIOM_PHASE2_BROWSER_TAB_CALLER_READY','tab A ready'),
      waitFor(b,value=>value==='MUSITU_AXIOM_PHASE2_BROWSER_TAB_CALLER_READY','tab B ready'),
    ]);
    await Promise.all([
      a.call('Runtime.evaluate',{expression:"window.__axiomStart(); 'STARTED_A'",returnByValue:true}),
      b.call('Runtime.evaluate',{expression:"window.__axiomStart(); 'STARTED_B'",returnByValue:true}),
    ]);
    const results=await Promise.all([
      waitFor(a,value=>Boolean(value)&&value!=='MUSITU_AXIOM_PHASE2_BROWSER_TAB_CALLER_READY','tab A execution'),
      waitFor(b,value=>Boolean(value)&&value!=='MUSITU_AXIOM_PHASE2_BROWSER_TAB_CALLER_READY','tab B execution'),
    ]);
    console.log('TAB_A_RESULT='+results[0]);
    console.log('TAB_B_RESULT='+results[1]);
    for(const value of results){
      if(value.startsWith('MUSITU_AXIOM_PHASE2_BROWSER_IDEMPOTENCY_FAIL:'))throw new Error(value);
      if(!value.startsWith('MUSITU_AXIOM_PHASE2_BROWSER_TAB_CALLER_FULFILLED:')&&value!=='MUSITU_AXIOM_PHASE2_BROWSER_TAB_CALLER_FAIL_CLOSED')throw new Error('unexpected separate-tab result '+value);
    }
    const inspect=await openTarget('tab-inspect');
    const inspected=await waitFor(inspect,value=>Boolean(value)&&value!=='MUSITU_AXIOM_PHASE2_BROWSER_IDEMPOTENCY_RUNNING','tab inspect');
    console.log('TAB_INSPECT_RESULT='+inspected);
    if(inspected!=='MUSITU_AXIOM_PHASE2_BROWSER_SEPARATE_TAB_ATOMIC_PASS')throw new Error('separate-tab inspect failed: '+inspected);
    for(const cdp of [a,b,inspect]){try{cdp.ws.close();}catch{}}
    try{
      const versionInfo=await waitJson(`http://127.0.0.1:${debugPort}/json/version`,2000);
      const browserCdp=await cdpSession(versionInfo.webSocketDebuggerUrl);
      try{await browserCdp.call('Browser.close');}catch{}
      browserCdp.ws.close();
    }catch{}
    const exit=await Promise.race([
      new Promise(resolve=>chrome.once('exit',(code,signal)=>resolve({code,signal}))),
      sleep(5000).then(()=>null),
    ]);
    if(!exit){chrome.kill('SIGTERM');await new Promise(resolve=>chrome.once('exit',resolve));}
    await sleep(300);
    console.log('MUSITU_AXIOM_PHASE2_BROWSER_SEPARATE_TAB_QUALIFICATION_PASS');
  }catch(error){
    chrome.kill('SIGTERM');
    console.error('BROWSER_STDERR='+stderr.slice(-4000));
    throw error;
  }
}

async function launchPhase(phase,expectedMarker){
  const chrome=spawn(browser,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,`--remote-debugging-port=${debugPort}`,'about:blank',
  ],{stdio:['ignore','pipe','pipe']});
  let stderr='';
  chrome.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  try{
    await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targetUrl=`${origin}/axiom_interface/vnext/tests/product_intelligence_browser_execution_idempotency.html?phase=${encodeURIComponent(phase)}`;
    const created=await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`,{method:'PUT'});
    if(!created.ok)throw new Error('CDP target creation failed HTTP '+created.status);
    const target=await created.json();
    const cdp=await cdpSession(target.webSocketDebuggerUrl);
    const deadline=Date.now()+12000;
    let value='MUSITU_AXIOM_PHASE2_BROWSER_IDEMPOTENCY_RUNNING';
    while(Date.now()<deadline){
      const result=await cdp.call('Runtime.evaluate',{expression:"document.querySelector('#result')?.textContent || ''",returnByValue:true});
      value=String(result?.result?.value||'');
      if(value&&value!=='MUSITU_AXIOM_PHASE2_BROWSER_IDEMPOTENCY_RUNNING')break;
      await sleep(100);
    }
    console.log(`${phase.toUpperCase()}_RESULT=${value}`);
    if(value!==expectedMarker)throw new Error(`${phase} qualification expected ${expectedMarker} but received ${value}`);
    try{await cdp.call('Browser.close');}catch{}
    cdp.ws.close();
    const exit=await Promise.race([
      new Promise(resolve=>chrome.once('exit',(code,signal)=>resolve({code,signal}))),
      sleep(5000).then(()=>null),
    ]);
    if(!exit){chrome.kill('SIGTERM');await new Promise(resolve=>chrome.once('exit',resolve));}
    await sleep(300);
  }catch(error){
    chrome.kill('SIGTERM');
    console.error('BROWSER_STDERR='+stderr.slice(-4000));
    throw error;
  }
}

try{
  await launchPhase('seed','MUSITU_AXIOM_PHASE2_BROWSER_RESTART_SEED_PASS');
  await launchPhase('replay','MUSITU_AXIOM_PHASE2_BROWSER_RESTART_REPLAY_PASS');
  await launchPhase('concurrent','MUSITU_AXIOM_PHASE2_BROWSER_CROSS_INSTANCE_ATOMIC_PASS');
  await launchPhase('tab-seed','MUSITU_AXIOM_PHASE2_BROWSER_SEPARATE_TAB_SEED_PASS');
  await launchSeparateTabRace();
  await launchPhase('stale-seed','MUSITU_AXIOM_PHASE2_BROWSER_STALE_CLAIM_SEED_PASS');
  await launchPhase('stale-recover','MUSITU_AXIOM_PHASE2_BROWSER_STALE_CLAIM_RECOVERY_PASS');
  console.log('MUSITU_AXIOM_PHASE2_BROWSER_DURABLE_IDEMPOTENCY_QUALIFICATION_PASS');
}finally{
  server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
