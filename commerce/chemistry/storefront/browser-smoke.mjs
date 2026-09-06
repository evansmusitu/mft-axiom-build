import http from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url);
const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');

const mode=process.argv[2]||'test';
const workerPath=process.argv[3]||process.env.WORKER_PATH;
const origin=process.env.STOREFRONT_ORIGIN||'http://127.0.0.1:8787';
if(!workerPath) throw new Error('worker path required');

async function loadWorker(){
  return import(pathToFileURL(workerPath).href+`?v=${Date.now()}`);
}

async function createServer(){
  const {handleRequest}=await loadWorker();
  return http.createServer(async(req,res)=>{
    try{
      const url=origin+req.url;
      const request=new Request(url,{method:req.method,headers:req.headers});
      const response=await handleRequest(request,{});
      res.statusCode=response.status;
      for(const [k,v] of response.headers) res.setHeader(k,v);
      const body=Buffer.from(await response.arrayBuffer());
      res.end(body);
    }catch(err){
      res.statusCode=500;res.setHeader('content-type','text/plain');res.end(String(err?.stack||err));
    }
  });
}

if(mode==='serve'){
  const server=await createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',resolve)});
  console.log('STORE_SERVER_READY '+origin);
  const stop=()=>server.close(()=>process.exit(0));
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  await new Promise(()=>{});
}

if(mode!=='test') throw new Error('mode must be serve or test');
const server=await createServer();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',resolve)});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1280,height:900}});
const page=await context.newPage();
const paths=['/chemistry/','/chemistry/plans','/chemistry/verify','/chemistry/support','/chemistry/releases','/chemistry/checkout/start?plan=annual'];
const evidence={schema:'musitu.chemistry.global_storefront.browser_preflight.v1',pages:{},keyboard:{},mobile:{},reduced_motion:{},ax_tree:{},field_inp_status:'unavailable_no_field_dataset'};
try{
  for(const path of paths){
    const response=await page.goto(origin+path,{waitUntil:'networkidle'});
    if(!response||response.status()!==200) throw new Error(`HTTP ${response?.status()} ${path}`);
    await page.addScriptTag({content:axeSource});
    const axe=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    const bad=axe.violations.filter(v=>['serious','critical'].includes(v.impact));
    if(bad.length) throw new Error(`axe serious/critical ${path}: `+bad.map(v=>v.id).join(','));
    const controls=await page.locator('a[href],button,input,select,textarea').evaluateAll(els=>els.filter(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.disabled&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';
    }).map(el=>({tag:el.tagName.toLowerCase(),id:el.id||'',name:el.getAttribute('aria-label')||el.textContent?.trim()||el.getAttribute('name')||''})));
    if(controls.some(c=>!c.name)) throw new Error(`unnamed control ${path}`);
    const csp=response.headers()['content-security-policy']||'';
    if(!csp.includes("style-src 'self'")||!csp.includes("script-src 'self'")||/unsafe-inline|unsafe-eval/.test(csp)) throw new Error(`CSP failure ${path}: ${csp}`);
    for(const [name,needle] of [['x-content-type-options','nosniff'],['x-frame-options','DENY'],['referrer-policy','no-referrer']]){
      if((response.headers()[name]||'')!==needle) throw new Error(`header ${name} ${path}`);
    }
    evidence.pages[path]={axe_violations_total:axe.violations.length,axe_serious_or_critical:bad.length,visible_controls:controls.length,csp};
  }

  await page.goto(origin+'/chemistry/',{waitUntil:'networkidle'});
  await page.keyboard.press('Tab');
  const first=await page.evaluate(()=>({text:document.activeElement?.textContent?.trim(),cls:document.activeElement?.className||''}));
  if(first.text!=='Skip to main content') throw new Error('first tab is not skip link');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  const focusedAfterSkip=await page.evaluate(()=>({id:document.activeElement?.id||'',tag:document.activeElement?.tagName?.toLowerCase()||''}));
  if(focusedAfterSkip.id!=='main') throw new Error('skip link did not move focus to main');
  const interactiveCount=await page.locator('a[href],button,input,select,textarea').evaluateAll(els=>els.filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.disabled&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}).length);
  await page.evaluate(()=>document.body.focus());
  const seen=[];
  for(let i=0;i<interactiveCount+8;i++){
    await page.keyboard.press('Tab');
    const x=await page.evaluate(()=>{const e=document.activeElement;return e?`${e.tagName}:${e.id||''}:${e.getAttribute('href')||''}:${(e.textContent||'').trim().slice(0,50)}`:''});
    if(x) seen.push(x);
  }
  if(new Set(seen).size<Math.max(1,interactiveCount-1)) throw new Error(`keyboard traversal did not reach visible controls ${new Set(seen).size}/${interactiveCount}`);
  const focusVisual=await page.locator('.button').first().evaluate(el=>{el.focus();const s=getComputedStyle(el);return {outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor};});
  if(focusVisual.outlineStyle==='none'||parseFloat(focusVisual.outlineWidth||'0')<2) throw new Error('focus indicator not visible');
  evidence.keyboard={first_tab:first,skip_target:focusedAfterSkip,visible_controls:interactiveCount,unique_focus_targets:new Set(seen).size,focus_visual:focusVisual};

  await page.setViewportSize({width:320,height:568});
  await page.goto(origin+'/chemistry/',{waitUntil:'networkidle'});
  const mobile=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,smallControls:Array.from(document.querySelectorAll('a.button,button,input,select')).filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<44||r.height<44)}).map(el=>({tag:el.tagName,id:el.id||'',w:Math.round(r.width),h:Math.round(r.height)}))}));
  if(mobile.scrollWidth>mobile.clientWidth) throw new Error(`horizontal overflow ${mobile.scrollWidth}>${mobile.clientWidth}`);
  if(mobile.smallControls.length) throw new Error('undersized controls '+JSON.stringify(mobile.smallControls));
  evidence.mobile=mobile;

  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await page.locator('.button').first().evaluate(el=>{const s=getComputedStyle(el);return {transitionDuration:s.transitionDuration,animationDuration:s.animationDuration,scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior};});
  const durationMs=v=>Math.max(...String(v).split(',').map(x=>{x=x.trim();return x.endsWith('ms')?parseFloat(x):x.endsWith('s')?parseFloat(x)*1000:0;}));
  if(durationMs(reduced.transitionDuration)>1||durationMs(reduced.animationDuration)>1) throw new Error('reduced motion not enforced');
  evidence.reduced_motion=reduced;

  const cdp=await context.newCDPSession(page);await cdp.send('Accessibility.enable');const ax=await cdp.send('Accessibility.getFullAXTree');
  const semantic=ax.nodes.filter(n=>['main','navigation','heading','link','button','form','textbox','combobox'].includes(n.role?.value)).slice(0,80).map(n=>({role:n.role?.value||'',name:n.name?.value||''}));
  if(!semantic.some(n=>n.role==='main')||!semantic.some(n=>n.role==='navigation')||!semantic.some(n=>n.role==='heading')) throw new Error('accessibility tree landmarks missing');
  evidence.ax_tree={semantic_nodes:semantic};
  fs.writeFileSync(process.env.BROWSER_EVIDENCE||'browser-evidence.json',JSON.stringify(evidence,null,2)+'\n');
  console.log('MUSITU_CHEMISTRY_GLOBAL_BROWSER_PREFLIGHT_PASS');
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
