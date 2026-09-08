const fs=require('fs');
const crypto=require('crypto');
const {chromium}=require('playwright');

(async()=>{
  const base=process.env.BASE_URL;
  const evidence=process.env.EVIDENCE_DIR||'/tmp/mchem-home-browser-evidence';
  const nonce=crypto.randomBytes(8).toString('hex');
  const strict=h=>{
    const csp=h['content-security-policy']||'';
    return csp.includes("style-src 'self'")&&csp.includes("script-src 'self'")&&csp.includes("connect-src 'self'")&&csp.includes("manifest-src 'self'")&&!csp.includes('unsafe-inline')&&!csp.includes('unsafe-eval')&&h['referrer-policy']==='no-referrer'&&h['x-frame-options']==='DENY'&&h['x-content-type-options']==='nosniff';
  };
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
  let context,installedContext;
  try{
    context=await browser.newContext({viewport:{width:430,height:900},userAgent:'MUSITU-Home-Product-Identity-Production-Acceptance/1.0'});
    const page=await context.newPage();
    const browserErrors=[];
    page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/i.test(m.text()))browserErrors.push(m.text())});
    page.on('pageerror',e=>browserErrors.push('pageerror:'+e.message));
    const direct=async(path,accept='text/html')=>{
      const sep=path.includes('?')?'&':'?';
      const r=await context.request.get(base+path+sep+'__mchem_home_accept='+nonce,{headers:{Accept:accept,'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'}});
      return {status:r.status(),headers:r.headers(),body:await r.body()};
    };
    const parseManifest=async path=>{
      const r=await direct(path,'application/manifest+json');
      if(r.status!==200)throw new Error('manifest HTTP '+r.status+' '+path);
      const m=JSON.parse(r.body.toString('utf8'));
      if(m.id!=='/chemistry/app'||m.name!=='MUSITU Chemistry'||m.short_name!=='MUSITU Chemistry'||m.start_url!=='/chemistry/app'||m.scope!=='/chemistry/'||m.display!=='standalone'||/Rescue/i.test(m.description||''))throw new Error('dedicated manifest rejected '+path+' '+JSON.stringify(m));
      return m;
    };
    const assertHome=async p=>{
      const html=await p.locator('html').evaluate(el=>el.outerHTML);
      for(const x of [
        'MUSITU Chemistry · Education Nexus','Your Chemistry workspace.',
        'class="app-primary" href="/chemistry/app?view=exam">Open Scientific Response OS',
        'class="app-action primary" href="/chemistry/app?view=exam">Open Scientific Response OS',
        'class="app-action" href="/chemistry/app?view=rescue">Chemistry Rescue',
        'Home, Rescue, Prove, Premium and Help stay inside the installed app surface'
      ]) if(!html.includes(x))throw new Error('Home missing '+x);
      for(const x of ['Chemistry Rescue 2026','Continue Chemistry Rescue','aria-label="MUSITU rescue method"','class="app-action primary" href="/chemistry/app?view=rescue">Continue Rescue','class="site-header"','class="site-footer"'])
        if(html.includes(x))throw new Error('Home exposed forbidden '+x);
    };

    const installResponse=await page.goto(base+'/chemistry/install?__mchem_home_live='+nonce,{waitUntil:'networkidle'});
    if(installResponse?.status()!==200||!strict(installResponse.headers()))throw new Error('install route rejected');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('versioned manifest discovery missing on install');
    const installHtml=await page.locator('html').evaluate(el=>el.outerHTML);
    if(!installHtml.includes('Get MUSITU Chemistry on this device')||installHtml.includes('Download verified Android APK'))throw new Error('install customer surface rejected');
    const installedPanel=page.locator('[data-install-panel="installed"]');
    if(await installedPanel.count()!==1)throw new Error('installed panel missing');
    const installedPanelHtml=await installedPanel.evaluate(el=>el.outerHTML);
    if(!installedPanelHtml.includes('href="/chemistry/app">Open MUSITU Chemistry'))throw new Error('hidden installed handoff is not /chemistry/app');
    if(installedPanelHtml.includes('Open Chemistry Rescue'))throw new Error('hidden installed panel still exposes Rescue launch');

    const versionedManifest=await parseManifest('/chemistry/manifest.webmanifest?v=2');
    const unversionedManifest=await parseManifest('/chemistry/manifest.webmanifest');
    if(JSON.stringify(versionedManifest)!==JSON.stringify(unversionedManifest))throw new Error('versioned/unversioned manifest semantics diverged');

    const sw=(await direct('/chemistry/sw.js','application/javascript')).body.toString('utf8');
    if(!sw.includes('musitu-chemistry-install-v8')||!sw.includes('/chemistry/manifest.webmanifest?v=2')||!sw.includes("const APP='/chemistry/app'")||!sw.includes('checkout|return|claim|telemetry|plans'))throw new Error('service worker v8 dedicated-app boundary rejected');

    const appResponse=await page.goto(base+'/chemistry/app?__mchem_home_app='+nonce,{waitUntil:'networkidle'});
    if(appResponse?.status()!==200||appResponse.headers()['cache-control']!=='no-store'||!strict(appResponse.headers()))throw new Error('app route rejected');
    await assertHome(page);
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('versioned manifest discovery missing on app');

    const rescueResponse=await page.goto(base+'/chemistry/rescue?src=direct&__mchem_home_public_rescue='+nonce,{waitUntil:'networkidle'});
    if(rescueResponse?.status()!==200||!strict(rescueResponse.headers()))throw new Error('public Rescue rejected');
    if(await page.getByRole('heading',{name:'MUSITU Chemistry Rescue 2026'}).count()!==1)throw new Error('public Rescue campaign missing');
    if(await page.locator('.site-header').count()!==1)throw new Error('Rescue public chrome unexpectedly removed');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('Rescue does not discover app manifest');

    installedContext=await browser.newContext({viewport:{width:430,height:900},userAgent:'MUSITU-Home-Product-Identity-Standalone-Acceptance/1.0'});
    await installedContext.addInitScript(()=>{
      const native=window.matchMedia.bind(window);
      window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,media:q,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}}:native(q);
    });
    const installedPage=await installedContext.newPage();
    const installedResponse=await installedPage.goto(base+'/chemistry/install?__mchem_home_installed='+nonce,{waitUntil:'networkidle'});
    if(installedResponse?.status()!==200)throw new Error('installed-mode install page HTTP rejected');
    if(await installedPage.locator('#install-concierge').getAttribute('data-install-mode')!=='installed')throw new Error('standalone install mode not detected');
    const openApp=installedPage.getByRole('link',{name:'Open MUSITU Chemistry'});
    if(await openApp.count()!==1||await openApp.getAttribute('href')!=='/chemistry/app')throw new Error('standalone installed handoff rejected');
    if(await installedPage.getByRole('link',{name:'Open Chemistry Rescue'}).count()!==0)throw new Error('standalone installed mode still Rescue-bound');
    await openApp.click();
    await installedPage.waitForLoadState('networkidle');
    if(new URL(installedPage.url()).pathname!=='/chemistry/app')throw new Error('installed handoff landed on '+installedPage.url());
    await assertHome(installedPage);

    const prove=installedPage.locator('a.app-primary[href="/chemistry/app?view=exam"]');
    if(await prove.count()!==1)throw new Error('Home primary Prove action missing');
    await prove.click();
    await installedPage.waitForLoadState('networkidle');
    if(new URL(installedPage.url()).searchParams.get('view')!=='exam')throw new Error('Home primary did not enter Prove');
    if(await installedPage.getByRole('heading',{name:'Answer Chemistry as Chemistry.'}).count()!==1)throw new Error('Prove workspace missing');
    if(await installedPage.locator('.site-header,.site-footer').count()!==0)throw new Error('Prove left installed shell');

    await installedPage.goto(base+'/chemistry/app?__mchem_home_return='+nonce,{waitUntil:'networkidle'});
    await assertHome(installedPage);
    const rescue=installedPage.locator('a.app-action[href="/chemistry/app?view=rescue"]',{hasText:'Chemistry Rescue'});
    if(await rescue.count()!==1)throw new Error('secondary internal Rescue action missing');
    await rescue.click();
    await installedPage.waitForLoadState('networkidle');
    if(new URL(installedPage.url()).searchParams.get('view')!=='rescue')throw new Error('secondary Rescue did not stay internal');
    if(await installedPage.getByRole('heading',{name:'Chemistry Rescue.'}).count()!==1)throw new Error('internal Rescue heading missing');
    if(!(await installedPage.locator('body').innerText()).includes('Your Rescue loop'))throw new Error('internal Rescue loop missing');
    if(await installedPage.locator('.site-header,.site-footer').count()!==0)throw new Error('internal Rescue leaked public chrome');

    const health=JSON.parse((await direct('/chemistry/healthz','application/json')).body.toString('utf8'));
    if(health.ok!==true||health.raw_paynow_key_present!==false||health.payment_authority_bound!==true||health.transport_bound!==true)throw new Error('health/payment authority rejected '+JSON.stringify(health));
    for(const path of ['/chemistry/install','/chemistry/app','/chemistry/app?view=rescue','/chemistry/app?view=exam','/chemistry/rescue?src=direct']){
      const r=await direct(path);if(r.status!==200||!strict(r.headers))throw new Error('strict headers rejected '+path);
    }
    const apk=await direct('/chemistry/download/MUSITU_Chemistry_Mastery_1.2.0.apk','application/vnd.android.package-archive');
    const apkHash=crypto.createHash('sha256').update(apk.body).digest('hex');
    if(apk.status!==200||apk.body.length!==5314934||apkHash!==process.env.APK_SHA256)throw new Error('legacy APK provenance changed');
    if(browserErrors.length)throw new Error('browser console/page errors '+JSON.stringify(browserErrors));

    const result={
      schema:'musitu.chemistry.home_product_identity.production_browser_acceptance.v1',
      tested_at_utc:new Date().toISOString(),github_sha:process.env.GITHUB_SHA,deployed_source_sha:process.env.DEPLOYED_SOURCE_SHA,production_worker_sha256:process.env.PRODUCTION_WORKER_SHA256,
      home_product_identity:'MUSITU Chemistry · Education Nexus',home_primary_action:'/chemistry/app?view=exam',rescue_secondary_internal:true,
      rescue_first_home_copy_absent:true,home_primary_prove_click_pass:true,internal_rescue_click_pass:true,public_rescue_preserved:true,
      versioned_manifest_url:'/chemistry/manifest.webmanifest?v=2',manifest_id:versionedManifest.id,manifest_name:versionedManifest.name,manifest_start_url:versionedManifest.start_url,manifest_scope:versionedManifest.scope,
      unversioned_manifest_same_identity_pass:true,service_worker_v8_pass:true,installed_panel_app_handoff_pass:true,standalone_installed_handoff_click_pass:true,dedicated_dark_app_shell_pass:true,
      customer_apk_cta_absent:true,strict_security_headers_pass:true,health_ok:true,raw_paynow_key_present:false,payment_authority_bound:true,transport_bound:true,
      legacy_apk_sha256:apkHash,legacy_apk_bytes:apk.body.length,deployment_performed:false,physical_reopen_performed:false,physical_device_claimed:false,physical_device_certified:false,real_money_settlement_performed:false
    };
    fs.mkdirSync(evidence,{recursive:true});
    fs.writeFileSync(evidence+'/result.json',JSON.stringify(result,null,2)+'\n');
    console.log('MUSITU_CHEMISTRY_HOME_PRODUCT_IDENTITY_PRODUCTION_BROWSER_ACCEPTANCE=PASS');
    console.log(JSON.stringify(result));
  }finally{
    if(installedContext)await installedContext.close();
    if(context)await context.close();
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exit(1)});
