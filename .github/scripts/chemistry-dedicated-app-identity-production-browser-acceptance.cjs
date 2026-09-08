const fs=require('fs');
const crypto=require('crypto');
const {chromium}=require('playwright');

(async()=>{
  const base=process.env.BASE_URL;
  const evidence=process.env.EVIDENCE_DIR||'/tmp/mchem-id-browser-evidence';
  const nonce=crypto.randomBytes(8).toString('hex');
  const strict=h=>{
    const csp=h['content-security-policy']||'';
    return csp.includes("style-src 'self'")&&csp.includes("script-src 'self'")&&csp.includes("connect-src 'self'")&&csp.includes("manifest-src 'self'")&&!csp.includes('unsafe-inline')&&!csp.includes('unsafe-eval')&&h['referrer-policy']==='no-referrer'&&h['x-frame-options']==='DENY'&&h['x-content-type-options']==='nosniff';
  };
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
  let context,installedContext;
  try{
    context=await browser.newContext({viewport:{width:430,height:900},userAgent:'MUSITU-Dedicated-App-Identity-Production-Acceptance/1.0'});
    const page=await context.newPage();
    const browserErrors=[];
    page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/i.test(m.text()))browserErrors.push(m.text())});
    page.on('pageerror',e=>browserErrors.push('pageerror:'+e.message));
    const direct=async(path,accept='text/html')=>{
      const sep=path.includes('?')?'&':'?';
      const r=await context.request.get(base+path+sep+'__mchem_id_accept='+nonce,{headers:{Accept:accept,'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'}});
      return {status:r.status(),headers:r.headers(),body:await r.body()};
    };
    const parseManifest=async path=>{
      const r=await direct(path,'application/manifest+json');
      if(r.status!==200)throw new Error('manifest HTTP '+r.status+' '+path);
      const m=JSON.parse(r.body.toString('utf8'));
      if(m.id!=='/chemistry/app'||m.name!=='MUSITU Chemistry'||m.short_name!=='MUSITU Chemistry'||m.start_url!=='/chemistry/app'||m.scope!=='/chemistry/'||m.display!=='standalone'||/Rescue/i.test(m.description||''))throw new Error('dedicated manifest rejected '+path+' '+JSON.stringify(m));
      return m;
    };

    const installResponse=await page.goto(base+'/chemistry/install?__mchem_id_live='+nonce,{waitUntil:'networkidle'});
    if(installResponse?.status()!==200||!strict(installResponse.headers()))throw new Error('install route rejected');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('versioned manifest discovery missing on install');
    const installHtml=await page.locator('html').evaluate(el=>el.outerHTML);
    if(!installHtml.includes('Get MUSITU Chemistry on this device')||installHtml.includes('Download verified Android APK'))throw new Error('install customer surface rejected');
    const installedPanel=page.locator('[data-install-panel="installed"]');
    if(await installedPanel.count()!==1)throw new Error('installed panel missing');
    const installedAppLink=installedPanel.getByRole('link',{name:'Open MUSITU Chemistry'});
    if(await installedAppLink.count()!==1||await installedAppLink.getAttribute('href')!=='/chemistry/app')throw new Error('installed handoff is not /chemistry/app');
    if(await installedPanel.getByRole('link',{name:'Open Chemistry Rescue'}).count()!==0)throw new Error('installed panel still exposes Rescue launch');

    const versionedManifest=await parseManifest('/chemistry/manifest.webmanifest?v=2');
    const unversionedManifest=await parseManifest('/chemistry/manifest.webmanifest');
    if(JSON.stringify(versionedManifest)!==JSON.stringify(unversionedManifest))throw new Error('versioned/unversioned manifest semantics diverged');

    const sw=(await direct('/chemistry/sw.js','application/javascript')).body.toString('utf8');
    if(!sw.includes('musitu-chemistry-install-v8')||!sw.includes('/chemistry/manifest.webmanifest?v=2')||!sw.includes("const APP='/chemistry/app'")||!sw.includes('checkout|return|claim|telemetry|plans'))throw new Error('service worker v8 dedicated-app boundary rejected');

    const appResponse=await page.goto(base+'/chemistry/app?__mchem_id_app='+nonce,{waitUntil:'networkidle'});
    if(appResponse?.status()!==200||appResponse.headers()['cache-control']!=='no-store'||!strict(appResponse.headers()))throw new Error('app route rejected');
    if(await page.getByRole('heading',{name:'Your Chemistry workspace.'}).count()!==1)throw new Error('dedicated app workspace missing');
    if(await page.locator('.site-header,.site-footer').count()!==0)throw new Error('public website chrome leaked into app');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('versioned manifest discovery missing on app');
    if(await page.locator('.app-nav a[href="/chemistry/app?view=exam"]').count()!==1)throw new Error('Prove missing from installed app');

    const rescueResponse=await page.goto(base+'/chemistry/rescue?src=direct&__mchem_id_rescue='+nonce,{waitUntil:'networkidle'});
    if(rescueResponse?.status()!==200||!strict(rescueResponse.headers()))throw new Error('public Rescue rejected');
    if(await page.getByRole('heading',{name:'MUSITU Chemistry Rescue 2026'}).count()!==1)throw new Error('public Rescue campaign missing');
    if(await page.locator('.site-header').count()!==1)throw new Error('Rescue public chrome unexpectedly removed');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('Rescue does not discover migrated app manifest');

    installedContext=await browser.newContext({viewport:{width:430,height:900},userAgent:'MUSITU-Dedicated-App-Identity-Standalone-Acceptance/1.0'});
    await installedContext.addInitScript(()=>{
      const native=window.matchMedia.bind(window);
      window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,media:q,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}}:native(q);
    });
    const installedPage=await installedContext.newPage();
    const installedResponse=await installedPage.goto(base+'/chemistry/install?__mchem_id_installed='+nonce,{waitUntil:'networkidle'});
    if(installedResponse?.status()!==200)throw new Error('installed-mode install page HTTP rejected');
    if(await installedPage.locator('#install-concierge').getAttribute('data-install-mode')!=='installed')throw new Error('standalone install mode not detected');
    const openApp=installedPage.getByRole('link',{name:'Open MUSITU Chemistry'});
    if(await openApp.count()!==1||await openApp.getAttribute('href')!=='/chemistry/app')throw new Error('standalone installed handoff rejected');
    if(await installedPage.getByRole('link',{name:'Open Chemistry Rescue'}).count()!==0)throw new Error('standalone installed mode still Rescue-bound');
    await openApp.click();
    await installedPage.waitForLoadState('networkidle');
    if(new URL(installedPage.url()).pathname!=='/chemistry/app')throw new Error('installed handoff landed on '+installedPage.url());
    if(await installedPage.getByRole('heading',{name:'Your Chemistry workspace.'}).count()!==1)throw new Error('installed handoff did not enter Chemistry app workspace');
    if(await installedPage.locator('.site-header,.site-footer').count()!==0)throw new Error('installed handoff landed on public chrome');

    const health=JSON.parse((await direct('/chemistry/healthz','application/json')).body.toString('utf8'));
    if(health.ok!==true||health.raw_paynow_key_present!==false||health.payment_authority_bound!==true||health.transport_bound!==true)throw new Error('health/payment authority rejected '+JSON.stringify(health));
    for(const path of ['/chemistry/install','/chemistry/app','/chemistry/rescue?src=direct']){
      const r=await direct(path);if(r.status!==200||!strict(r.headers))throw new Error('strict headers rejected '+path);
    }
    const apk=await direct('/chemistry/download/MUSITU_Chemistry_Mastery_1.2.0.apk','application/vnd.android.package-archive');
    const apkHash=crypto.createHash('sha256').update(apk.body).digest('hex');
    if(apk.status!==200||apk.body.length!==5314934||apkHash!==process.env.APK_SHA256)throw new Error('legacy APK provenance changed');
    if(browserErrors.length)throw new Error('browser console/page errors '+JSON.stringify(browserErrors));

    const result={
      schema:'musitu.chemistry.dedicated_app_identity.production_browser_acceptance.v1',
      tested_at_utc:new Date().toISOString(),github_sha:process.env.GITHUB_SHA,deployed_source_sha:process.env.DEPLOYED_SOURCE_SHA,production_worker_sha256:process.env.PRODUCTION_WORKER_SHA256,
      versioned_manifest_url:'/chemistry/manifest.webmanifest?v=2',manifest_id:versionedManifest.id,manifest_name:versionedManifest.name,manifest_start_url:versionedManifest.start_url,manifest_scope:versionedManifest.scope,
      unversioned_manifest_same_identity_pass:true,install_manifest_discovery_pass:true,app_manifest_discovery_pass:true,rescue_manifest_discovery_pass:true,
      service_worker_v8_pass:true,installed_panel_app_handoff_pass:true,standalone_installed_handoff_click_pass:true,dedicated_dark_app_shell_pass:true,public_rescue_preserved:true,
      customer_apk_cta_absent:true,strict_security_headers_pass:true,health_ok:true,raw_paynow_key_present:false,payment_authority_bound:true,transport_bound:true,
      legacy_apk_sha256:apkHash,legacy_apk_bytes:apk.body.length,deployment_performed:false,physical_fresh_install_performed:false,physical_device_claimed:false,physical_device_certified:false,real_money_settlement_performed:false
    };
    fs.mkdirSync(evidence,{recursive:true});
    fs.writeFileSync(evidence+'/result.json',JSON.stringify(result,null,2)+'\n');
    console.log('MUSITU_CHEMISTRY_DEDICATED_APP_IDENTITY_PRODUCTION_BROWSER_ACCEPTANCE=PASS');
    console.log(JSON.stringify(result));
  }finally{
    if(installedContext)await installedContext.close();
    if(context)await context.close();
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exit(1)});
