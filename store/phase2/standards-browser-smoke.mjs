import http from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const require=createRequire(import.meta.url);
const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const workerPath=process.argv[2]||process.env.WORKER_PATH;
const evidencePath=process.env.PHASE2_BROWSER_EVIDENCE||'/tmp/musitu-store-phase2/browser-standards-evidence.json';
if(!workerPath) throw new Error('worker path required');

const moduleUrl=pathToFileURL(workerPath).href+`?phase2=${Date.now()}`;
const workerModule=await import(moduleUrl);
const worker=workerModule.default;
if(!worker||typeof worker.fetch!=='function') throw new Error('worker default.fetch required');

const server=http.createServer(async(req,res)=>{
  try{
    const address=server.address();
    const origin=`http://127.0.0.1:${address.port}`;
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers});
    const response=await worker.fetch(request,{STORE_RUNTIME_PUBLICATION_STATE:'production'},{});
    res.statusCode=response.status;
    for(const [name,value] of response.headers) res.setHeader(name,value);
    if(req.method==='HEAD'){res.end();return;}
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){
    res.statusCode=500;
    res.setHeader('content-type','text/plain; charset=utf-8');
    res.end(String(error?.stack||error));
  }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const origin=`http://127.0.0.1:${server.address().port}`;

const browser=await chromium.launch({
  headless:true,
  executablePath:process.env.CHROME_PATH||undefined,
  args:['--no-sandbox','--disable-dev-shm-usage']
});

const evidence={
  schema:'musitu.store.phase2.standards_browser_smoke.v1',
  result:'PENDING',
  worker_path:workerPath,
  origin,
  automated_wcag_scope:'axe WCAG 2 A/AA, WCAG 2.1 AA and WCAG 2.2 AA tags plus keyboard/reflow/reduced-motion/AX-tree checks',
  manual_screen_reader_status:'PENDING_REAL_ASSISTIVE_TECHNOLOGY_SMOKE',
  pages:{},
  keyboard:{},
  mobile:{},
  reduced_motion:{},
  accessibility_tree:{},
  low_bandwidth:{},
  claim_boundary:'Automated browser evidence does not by itself establish complete WCAG 2.2 AA conformance; manual screen-reader smoke remains required.'
};

function assert(condition,message){if(!condition) throw new Error(message)}
function securityHeaders(headers,path){
  const csp=headers['content-security-policy']||'';
  assert(csp.includes("default-src 'none'"),`CSP default-src missing ${path}`);
  assert(csp.includes("style-src 'self'"),`CSP style-src missing ${path}`);
  assert(csp.includes("script-src 'self'"),`CSP script-src missing ${path}`);
  assert(csp.includes("frame-ancestors 'none'"),`CSP frame-ancestors missing ${path}`);
  assert(csp.includes("base-uri 'none'"),`CSP base-uri missing ${path}`);
  assert(!/unsafe-inline|unsafe-eval/.test(csp),`unsafe CSP token ${path}`);
  assert((headers['x-content-type-options']||'')==='nosniff',`x-content-type-options ${path}`);
  assert((headers['x-frame-options']||'')==='DENY',`x-frame-options ${path}`);
  assert((headers['referrer-policy']||'')==='no-referrer',`referrer-policy ${path}`);
  return csp;
}

const context=await browser.newContext({viewport:{width:1280,height:900},bypassCSP:true});
const page=await context.newPage();
const paths=['/store','/store/apps/chemistry','/store/install','/store/developer','/store/releases','/store/status','/store/offline'];

try{
  for(const path of paths){
    const response=await page.goto(origin+path,{waitUntil:'networkidle',timeout:30000});
    assert(response&&response.status()===200,`HTTP ${response?.status()} ${path}`);
    const headers=response.headers();
    const csp=securityHeaders(headers,path);
    await page.addScriptTag({content:axeSource});
    const axe=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    assert(axe.violations.length===0,`axe violations ${path}: ${axe.violations.map(v=>v.id).join(',')}`);
    const semantics=await page.evaluate(()=>({
      lang:document.documentElement.lang,
      main:document.querySelectorAll('main').length,
      h1:document.querySelectorAll('h1').length,
      skip:Boolean(document.querySelector('a.skip-link[href="#main"]')),
      unnamed:Array.from(document.querySelectorAll('a[href],button,input,select,textarea')).filter(el=>{
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        if(el.disabled||r.width<=0||r.height<=0||s.visibility==='hidden'||s.display==='none') return false;
        return !(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.textContent?.trim()||el.getAttribute('name')||el.getAttribute('title'));
      }).length
    }));
    assert(Boolean(semantics.lang),`html lang missing ${path}`);
    assert(semantics.main===1,`main landmark count ${path}: ${semantics.main}`);
    assert(semantics.h1>=1,`h1 missing ${path}`);
    assert(semantics.skip,`skip link missing ${path}`);
    assert(semantics.unnamed===0,`unnamed controls ${path}: ${semantics.unnamed}`);
    evidence.pages[path]={axe_violations:0,csp,semantics};
  }

  await page.goto(origin+'/store',{waitUntil:'networkidle'});
  await page.keyboard.press('Tab');
  const first=await page.evaluate(()=>({text:document.activeElement?.textContent?.trim()||'',className:document.activeElement?.className||''}));
  assert(first.text==='Skip to main content','first keyboard target is not skip link');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  const skipTarget=await page.evaluate(()=>({id:document.activeElement?.id||'',tag:document.activeElement?.tagName?.toLowerCase()||''}));
  assert(skipTarget.id==='main','skip link did not move focus to main');
  const focusVisual=await page.locator('a.button').first().evaluate(el=>{el.focus();const s=getComputedStyle(el);return {outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor};});
  assert(focusVisual.outlineStyle!=='none'&&parseFloat(focusVisual.outlineWidth||'0')>=2,'focus indicator is not at least 2px');
  evidence.keyboard={first_tab:first,skip_target:skipTarget,focus_visual:focusVisual};

  await page.setViewportSize({width:320,height:568});
  await page.goto(origin+'/store',{waitUntil:'networkidle'});
  const mobile=await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    clientWidth:document.documentElement.clientWidth,
    smallControls:Array.from(document.querySelectorAll('a.button,button,input,select')).filter(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&(r.width<44||r.height<44);
    }).map(el=>({tag:el.tagName,id:el.id||'',text:(el.textContent||'').trim().slice(0,50),w:Math.round(r.width),h:Math.round(r.height)}))
  }));
  assert(mobile.scrollWidth<=mobile.clientWidth,`horizontal overflow ${mobile.scrollWidth}>${mobile.clientWidth}`);
  assert(mobile.smallControls.length===0,'undersized touch controls '+JSON.stringify(mobile.smallControls));
  evidence.mobile=mobile;

  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await page.locator('a.button').first().evaluate(el=>{const s=getComputedStyle(el);return {transitionDuration:s.transitionDuration,animationDuration:s.animationDuration,scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior};});
  const durationMs=value=>Math.max(...String(value).split(',').map(x=>{x=x.trim();return x.endsWith('ms')?parseFloat(x):x.endsWith('s')?parseFloat(x)*1000:0;}));
  assert(durationMs(reduced.transitionDuration)<=1&&durationMs(reduced.animationDuration)<=1,'reduced-motion transition/animation remains active');
  evidence.reduced_motion=reduced;

  const cdp=await context.newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const ax=await cdp.send('Accessibility.getFullAXTree');
  const semanticNodes=ax.nodes.filter(n=>['main','navigation','heading','link','button'].includes(n.role?.value)).slice(0,100).map(n=>({role:n.role?.value||'',name:n.name?.value||''}));
  assert(semanticNodes.some(n=>n.role==='main'),'AX tree missing main');
  assert(semanticNodes.some(n=>n.role==='heading'),'AX tree missing heading');
  evidence.accessibility_tree={semantic_nodes:semanticNodes};

  const fullResponse=await fetch(origin+'/store');
  const fullBytes=Buffer.byteLength(await fullResponse.text());
  const liteResponse=await fetch(origin+'/store',{headers:{'Save-Data':'on'}});
  const liteText=await liteResponse.text();
  const liteBytes=Buffer.byteLength(liteText);
  assert(liteResponse.status===200,'Save-Data response failed');
  assert(/Low-bandwidth mode/.test(liteText),'Save-Data did not select low-bandwidth mode');
  assert(liteBytes<fullBytes,`low-bandwidth HTML is not smaller ${liteBytes}>=${fullBytes}`);
  assert((liteResponse.headers.get('vary')||'').toLowerCase().includes('save-data'),'Save-Data missing from Vary');

  const slowContext=await browser.newContext({viewport:{width:360,height:640},extraHTTPHeaders:{'Save-Data':'on'}});
  const slowPage=await slowContext.newPage();
  const failures=[];
  slowPage.on('requestfailed',request=>failures.push({url:request.url(),failure:request.failure()}));
  const slowCdp=await slowContext.newCDPSession(slowPage);
  await slowCdp.send('Network.enable');
  const profile={
    offline:false,
    latency_ms:400,
    download_bytes_per_second:51200,
    upload_bytes_per_second:16384,
    purpose:'reference constrained-network functional validation; not a contractual speed threshold'
  };
  await slowCdp.send('Network.emulateNetworkConditions',{
    offline:false,
    latency:profile.latency_ms,
    downloadThroughput:profile.download_bytes_per_second,
    uploadThroughput:profile.upload_bytes_per_second,
    connectionType:'cellular3g'
  });
  const started=Date.now();
  const slowResponse=await slowPage.goto(origin+'/store',{waitUntil:'load',timeout:30000});
  const observedLoadMs=Date.now()-started;
  assert(slowResponse&&slowResponse.status()===200,`constrained-network HTTP ${slowResponse?.status()}`);
  await slowPage.getByText('Low-bandwidth mode').waitFor({state:'visible',timeout:5000});
  assert(await slowPage.locator('a[href="/store/install"]').count()===1,'low-bandwidth Install action missing');
  assert(await slowPage.locator('a[href="/store/apps/chemistry"]').count()===1,'low-bandwidth Details action missing');
  const navTiming=await slowPage.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return n?{domContentLoaded_ms:Math.round(n.domContentLoadedEventEnd),load_ms:Math.round(n.loadEventEnd),transferSize:n.transferSize,encodedBodySize:n.encodedBodySize,decodedBodySize:n.decodedBodySize}:null;});
  assert(failures.length===0,'request failures under constrained network '+JSON.stringify(failures));
  evidence.low_bandwidth={
    result:'PASS',
    profile,
    full_html_bytes:fullBytes,
    save_data_html_bytes:liteBytes,
    save_data_reduction_bytes:fullBytes-liteBytes,
    observed_wall_load_ms:observedLoadMs,
    navigation_timing:navTiming,
    request_failures:failures,
    install_action_present:true,
    details_action_present:true,
    pass_rule:'functional correctness, explicit Save-Data mode selection, smaller HTML, required actions present, and zero failed requests; measured time is evidence only and is not treated as an invented product threshold'
  };
  await slowContext.close();

  evidence.result='PASS_AUTOMATED';
  fs.mkdirSync(new URL('.',`file://${evidencePath}`).pathname,{recursive:true});
  fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
  console.log('MUSITU_STORE_PHASE2_STANDARDS_BROWSER_AUTOMATION_PASS');
}finally{
  await context.close().catch(()=>{});
  await browser.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
}
