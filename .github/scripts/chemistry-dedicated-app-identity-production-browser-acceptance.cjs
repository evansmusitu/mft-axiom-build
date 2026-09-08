const fs=require('fs');
const crypto=require('crypto');
const {chromium}=require('playwright');

(async()=>{
  const base=process.env.BASE_URL;
  const evidence=process.env.EVIDENCE_DIR||'/tmp/mchem-dedicated-browser-evidence';
  const nonce=crypto.randomBytes(8).toString('hex');
  const strict=h=>{
    const csp=h['content-security-policy']||'';
    return csp.includes("style-src 'self'")&&csp.includes("script-src 'self'")&&csp.includes("connect-src 'self'")&&csp.includes("manifest-src 'self'")&&!csp.includes('unsafe-inline')&&!csp.includes('unsafe-eval')&&h['referrer-policy']==='no-referrer'&&h['x-frame-options']==='DENY'&&h['x-content-type-options']==='nosniff';
  };
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
  let context,installedContext;
  try{
    fs.mkdirSync(evidence,{recursive:true});
    const browserErrors=[];
    const attachErrors=p=>{
      p.on('console',m=>{
        if(m.type()!=='error')return;
        const text=m.text();
        if(/ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(text))return;
        browserErrors.push(text);
      });
      p.on('pageerror',e=>browserErrors.push('pageerror:'+e.message));
    };

    context=await browser.newContext({viewport:{width:430,height:900},userAgent:'MUSITU-Dedicated-App-Identity-Production-Acceptance/2.0'});
    const page=await context.newPage();
    attachErrors(page);
    const direct=async(path,accept='text/html')=>{
      const sep=path.includes('?')?'&':'?';
      const r=await context.request.get(base+path+sep+'__mchem_accept='+nonce,{headers:{Accept:accept,'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'}});
      return {status:r.status(),headers:r.headers(),body:await r.body()};
    };
    const parseManifest=async path=>{
      const r=await direct(path,'application/manifest+json');
      if(r.status!==200)throw new Error('manifest HTTP '+r.status+' '+path);
      const m=JSON.parse(r.body.toString('utf8'));
      if(m.name!=='MUSITU Chemistry'||m.short_name!=='MUSITU Chemistry'||m.id!=='/chemistry/app'||m.start_url!=='/chemistry/app'||m.scope!=='/chemistry/'||m.display!=='standalone'||/Rescue/i.test(m.description||''))throw new Error('dedicated manifest rejected '+path+' '+JSON.stringify(m));
      return m;
    };
    const htmlSnapshot=async p=>p.locator('html').evaluate(el=>el.outerHTML);
    const assertNoPublicChrome=async(p,label)=>{
      if(await p.locator('.site-header,.site-footer').count()!==0)throw new Error(label+' leaked public site chrome');
    };
    const assertHome=async p=>{
      const html=await htmlSnapshot(p);
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
    const dismissOnboarding=async p=>{
      const onboarding=p.locator('#app-onboarding:not([hidden])');
      if(await onboarding.count()){
        const skip=p.locator('#app-onboarding-skip');
        if(await skip.count()!==1)throw new Error('visible onboarding has no skip control');
        await skip.click();
        await onboarding.waitFor({state:'hidden'});
      }
    };

    const installResponse=await page.goto(base+'/chemistry/install?__mchem_live='+nonce,{waitUntil:'networkidle'});
    if(installResponse?.status()!==200||!strict(installResponse.headers()))throw new Error('install route rejected');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('versioned manifest discovery missing on install');
    const installHtml=await htmlSnapshot(page);
    if(!installHtml.includes('Get MUSITU Chemistry on this device'))throw new Error('install product identity missing');
    if(installHtml.includes('Download verified Android APK')||installHtml.includes('href="/chemistry/download/'))throw new Error('direct customer APK CTA exposed');
    const installedPanel=page.locator('[data-install-panel="installed"]');
    if(await installedPanel.count()!==1)throw new Error('installed panel missing');
    const installedPanelHtml=await installedPanel.evaluate(el=>el.outerHTML);
    if(!installedPanelHtml.includes('href="/chemistry/app">Open MUSITU Chemistry'))throw new Error('installed handoff is not /chemistry/app');
    if(installedPanelHtml.includes('Open Chemistry Rescue'))throw new Error('installed panel still exposes Rescue launch');

    const versionedManifest=await parseManifest('/chemistry/manifest.webmanifest?v=2');
    const unversionedManifest=await parseManifest('/chemistry/manifest.webmanifest');
    if(JSON.stringify(versionedManifest)!==JSON.stringify(unversionedManifest))throw new Error('versioned/unversioned manifest semantics diverged');

    const sw=(await direct('/chemistry/sw.js','application/javascript')).body.toString('utf8');
    if(!sw.includes('musitu-chemistry-install-v8')||!sw.includes('/chemistry/manifest.webmanifest?v=2')||!sw.includes("const APP='/chemistry/app'")||!sw.includes('/chemistry/app?view=exam')||!sw.includes('/chemistry/app?view=premium')||!sw.includes('/chemistry/app?view=help')||!sw.includes('checkout|return|claim|telemetry|plans'))throw new Error('service worker v8 dedicated-app boundary rejected');
    const appJs=(await direct('/chemistry/assets/app-shell.js?v=4','application/javascript')).body.toString('utf8');
    for(const x of ['musitu.scientific_response_graph.v1','let viewMode=response.activeMode','finalized:parsed.finalized===true','same-scientific-concept'])if(!appJs.includes(x))throw new Error('live app JS missing '+x);

    const appResponse=await page.goto(base+'/chemistry/app?__mchem_app='+nonce,{waitUntil:'networkidle'});
    if(appResponse?.status()!==200||appResponse.headers()['cache-control']!=='no-store'||!strict(appResponse.headers()))throw new Error('app route rejected');
    await assertHome(page);
    await assertNoPublicChrome(page,'Home');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('versioned manifest discovery missing on app');

    const rescueResponse=await page.goto(base+'/chemistry/rescue?src=direct&__mchem_public_rescue='+nonce,{waitUntil:'networkidle'});
    if(rescueResponse?.status()!==200||!strict(rescueResponse.headers()))throw new Error('public Rescue rejected');
    if(await page.getByRole('heading',{name:'MUSITU Chemistry Rescue 2026'}).count()!==1)throw new Error('public Rescue campaign missing');
    if(await page.locator('.site-header').count()!==1)throw new Error('Rescue public chrome unexpectedly removed');
    if(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count()!==1)throw new Error('Rescue does not discover versioned Chemistry manifest');

    installedContext=await browser.newContext({viewport:{width:430,height:900},userAgent:'MUSITU-Dedicated-App-Identity-Standalone-Acceptance/2.0'});
    await installedContext.addInitScript(()=>{
      const native=window.matchMedia.bind(window);
      window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,media:q,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}}:native(q);
    });
    const installedPage=await installedContext.newPage();
    attachErrors(installedPage);
    const installedResponse=await installedPage.goto(base+'/chemistry/install?__mchem_installed='+nonce,{waitUntil:'networkidle'});
    if(installedResponse?.status()!==200)throw new Error('installed-mode install page HTTP rejected');
    if(await installedPage.locator('#install-concierge').getAttribute('data-install-mode')!=='installed')throw new Error('standalone install mode not detected');
    const openApp=installedPage.getByRole('link',{name:'Open MUSITU Chemistry'});
    if(await openApp.count()!==1||await openApp.getAttribute('href')!=='/chemistry/app')throw new Error('standalone installed handoff rejected');
    if(await installedPage.getByRole('link',{name:'Open Chemistry Rescue'}).count()!==0)throw new Error('standalone installed mode still Rescue-bound');
    await openApp.click();
    await installedPage.waitForLoadState('networkidle');
    if(new URL(installedPage.url()).pathname!=='/chemistry/app')throw new Error('installed handoff landed on '+installedPage.url());
    await assertHome(installedPage);
    await assertNoPublicChrome(installedPage,'Installed Home');
    await dismissOnboarding(installedPage);

    const prove=installedPage.locator('a.app-primary[href="/chemistry/app?view=exam"]');
    if(await prove.count()!==1)throw new Error('Home primary Prove action missing');
    await prove.click();
    await installedPage.waitForLoadState('networkidle');
    if(new URL(installedPage.url()).pathname!=='/chemistry/app'||new URL(installedPage.url()).searchParams.get('view')!=='exam')throw new Error('Home primary did not enter Prove');
    if(await installedPage.getByRole('heading',{name:'Answer Chemistry as Chemistry.'}).count()!==1)throw new Error('Scientific Response OS missing');
    await assertNoPublicChrome(installedPage,'Prove');
    const proveHtml=await htmlSnapshot(installedPage);
    for(const x of ['data-scientific-response-os','Certified exam mode.','Scientific Response Graph','Reaction Mechanism','Molecular Structure','Scientific Graph','Lab Apparatus','Particle Model','Scientific Argument','Accessibility Description'])if(!proveHtml.includes(x))throw new Error('Prove missing '+x);

    await installedPage.evaluate(()=>navigator.serviceWorker.ready);
    await installedPage.reload({waitUntil:'networkidle'});
    await dismissOnboarding(installedPage);
    await installedPage.waitForFunction(()=>navigator.serviceWorker.controller!==null);

    const equation=installedPage.locator('[data-sr-equation]');
    await equation.fill('2H₂ + O₂ ');
    await installedPage.locator('[data-sr-symbol="→"]').click();
    await equation.pressSequentially(' 2H₂O');
    if(await equation.inputValue()!=='2H₂ + O₂ → 2H₂O')throw new Error('equation interaction rejected');

    await installedPage.locator('[data-sr-mode="structure"]').click();
    const structure=installedPage.locator('[data-sr-panel="structure"]');
    await structure.locator('[data-sr-add="atom"][data-sr-label="C"]').click();
    await structure.locator('[data-sr-add="atom"][data-sr-label="O"]').click();
    const structureNodes=structure.locator('[data-sr-node]');
    if(await structureNodes.count()!==2)throw new Error('structure board did not create two objects');
    await structureNodes.nth(0).click();
    await structureNodes.nth(1).click();
    await structure.locator('[data-sr-connect="double-bond"]').click();

    await installedPage.locator('[data-sr-mode="particle"]').click();
    const particle=installedPage.locator('[data-sr-panel="particle"]');
    await particle.locator('[data-sr-add="molecule"]').click();
    if(await particle.locator('[data-sr-node]').count()!==1)throw new Error('particle board not independent');
    await particle.locator('[data-sr-node]').click();
    await installedPage.locator('[data-sr-mode="structure"]').click();
    await structure.locator('[data-sr-node]').nth(0).click();
    await structure.locator('[data-sr-link-representation]').click();

    await installedPage.locator('[data-sr-mode="argument"]').click();
    await installedPage.locator('[data-sr-argument="claim"]').fill('Increasing pressure changes the equilibrium position.');
    await installedPage.locator('[data-sr-argument="evidence"]').fill('The two sides contain different total gaseous mole counts.');
    await installedPage.locator('[data-sr-argument="principle"]').fill('Le Chatelier principle.');
    await installedPage.locator('[data-sr-argument="conclusion"]').fill('The equilibrium shifts toward fewer gaseous moles.');

    await installedPage.locator('[data-sr-mode="graph-data"]').click();
    const parseGraph=async()=>JSON.parse(await installedPage.locator('[data-sr-graph-output]').textContent()||'{}');
    const graph=await parseGraph();
    if(graph.schema!=='musitu.scientific_response_graph.v1'||graph.examMode!=='certified'||graph.text!=='2H₂ + O₂ → 2H₂O')throw new Error('SRG identity/text rejected');
    if(!graph.objects.some(x=>x.mode==='structure'&&x.label==='C')||!graph.objects.some(x=>x.mode==='structure'&&x.label==='O')||!graph.objects.some(x=>x.mode==='particle'&&x.kind==='molecule'))throw new Error('SRG objects rejected');
    if(!graph.edges.some(x=>x.kind==='double-bond')||!graph.edges.some(x=>x.mode==='cross'&&x.kind==='same-scientific-concept'))throw new Error('SRG edges rejected');
    if(graph.argument.principle!=='Le Chatelier principle.')throw new Error('SRG argument rejected');

    await installedPage.locator('[data-sr-finalize]').click();
    if(await equation.getAttribute('readonly')!=='')throw new Error('finalized equation not readonly');
    if(!await installedPage.locator('[data-sr-add="atom"]').first().isDisabled())throw new Error('finalized construction still enabled');
    if(!await installedPage.locator('[data-sr-reset]').isDisabled())throw new Error('finalized destructive clear still enabled');
    if(!/locked for review/i.test(await installedPage.locator('[data-sr-status]').textContent()||''))throw new Error('finalized status missing');
    await installedPage.waitForFunction(()=>document.querySelector('[data-sr-live]')?.textContent?.includes('No network submission has occurred'));

    const frozenBefore=await parseGraph();
    const frozenStorageBefore=await installedPage.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
    await installedPage.locator('[data-sr-mode="equation"]').click();
    await installedPage.locator('[data-sr-mode="structure"]').click();
    await installedPage.locator('[data-sr-mode="graph-data"]').click();
    const frozenAfterReview=await parseGraph();
    if(JSON.stringify(frozenAfterReview)!==JSON.stringify(frozenBefore))throw new Error('finalized SRG mutated during review navigation');

    await installedPage.reload({waitUntil:'networkidle'});
    if(!/locked for review/i.test(await installedPage.locator('[data-sr-status]').textContent()||''))throw new Error('finalized lock lost on reload');
    if(await installedPage.locator('[data-sr-equation]').getAttribute('readonly')!=='')throw new Error('equation unlocked on reload');
    if(!await installedPage.locator('[data-sr-reset]').isDisabled())throw new Error('clear unlocked on reload');
    const frozenStorageAfter=await installedPage.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
    if(frozenStorageAfter!==frozenStorageBefore)throw new Error('persisted finalized SRG mutated on reload');
    const frozenAfterReload=await parseGraph();
    if(JSON.stringify(frozenAfterReload)!==JSON.stringify(frozenBefore))throw new Error('finalized SRG semantics changed on reload');

    await installedPage.locator('[data-sr-reopen]').click();
    if(await installedPage.locator('[data-sr-add="atom"]').first().isDisabled())throw new Error('reopen did not unlock construction');
    if(await installedPage.locator('[data-sr-reset]').isDisabled())throw new Error('reopen did not unlock clear');

    const onlineViewHeadings={premium:'Unlock full mastery.',help:'Help without leaving MUSITU.'};
    for(const [view,heading] of Object.entries(onlineViewHeadings)){
      await installedPage.goto(base+'/chemistry/app?view='+view,{waitUntil:'networkidle'});
      if(new URL(installedPage.url()).pathname!=='/chemistry/app'||new URL(installedPage.url()).searchParams.get('view')!==view)throw new Error(view+' escaped app route');
      await installedPage.getByRole('heading',{name:heading}).waitFor();
      await assertNoPublicChrome(installedPage,view);
    }

    for(const view of ['exam','premium','help']){
      await installedPage.goto(base+'/chemistry/app?view='+view,{waitUntil:'networkidle'});
      await installedPage.evaluate(()=>navigator.serviceWorker.ready);
    }
    await installedPage.goto(base+'/chemistry/app?view=exam',{waitUntil:'networkidle'});
    await installedPage.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    await installedContext.setOffline(true);
    await installedPage.reload({waitUntil:'domcontentloaded'});
    await installedPage.getByRole('heading',{name:'Answer Chemistry as Chemistry.'}).waitFor();
    await assertNoPublicChrome(installedPage,'Offline Prove');

    const sensitive=await installedPage.evaluate(async()=>{
      const paths=['/chemistry/checkout','/chemistry/return','/chemistry/claim','/chemistry/telemetry','/chemistry/plans'];
      const out={};
      for(const p of paths){
        try{const r=await fetch(p,{cache:'no-store'});out[p]={resolved:true,status:r.status}}
        catch{out[p]={resolved:false}}
      }
      return out;
    });
    for(const [path,v] of Object.entries(sensitive))if(v.resolved)throw new Error('sensitive route resolved offline '+path+' '+JSON.stringify(v));

    await installedPage.locator('.app-nav a[href="/chemistry/app?view=premium"]').click();
    await installedPage.getByRole('heading',{name:'Unlock full mastery.'}).waitFor();
    await assertNoPublicChrome(installedPage,'Offline Premium');
    await installedPage.locator('.app-nav a[href="/chemistry/app?view=help"]').click();
    await installedPage.getByRole('heading',{name:'Help without leaving MUSITU.'}).waitFor();
    await assertNoPublicChrome(installedPage,'Offline Help');
    await installedContext.setOffline(false);
    await installedPage.reload({waitUntil:'networkidle'});
    await installedPage.getByRole('heading',{name:'Help without leaving MUSITU.'}).waitFor();
    await assertNoPublicChrome(installedPage,'Reconnected Help');

    const health=JSON.parse((await direct('/chemistry/healthz','application/json')).body.toString('utf8'));
    if(health.ok!==true||health.raw_paynow_key_present!==false||health.payment_authority_bound!==true||health.transport_bound!==true)throw new Error('health/payment authority rejected '+JSON.stringify(health));
    for(const path of ['/chemistry/install','/chemistry/app','/chemistry/app?view=exam','/chemistry/app?view=premium','/chemistry/app?view=help','/chemistry/rescue?src=direct']){
      const r=await direct(path);if(r.status!==200||!strict(r.headers))throw new Error('strict headers rejected '+path);
    }
    const apk=await direct('/chemistry/download/MUSITU_Chemistry_Mastery_1.2.0.apk','application/vnd.android.package-archive');
    const apkHash=crypto.createHash('sha256').update(apk.body).digest('hex');
    if(apk.status!==200||apk.body.length!==5314934||apkHash!==process.env.APK_SHA256)throw new Error('legacy APK provenance changed');
    if(browserErrors.length)throw new Error('browser console/page errors '+JSON.stringify(browserErrors));

    const result={
      schema:'musitu.chemistry.dedicated_app_identity.production_browser_acceptance.v2',
      tested_at_utc:new Date().toISOString(),github_sha:process.env.GITHUB_SHA,deployed_source_sha:process.env.DEPLOYED_SOURCE_SHA,identity_migration_source_sha:process.env.IDENTITY_MIGRATION_SOURCE_SHA,production_worker_sha256:process.env.PRODUCTION_WORKER_SHA256,
      read_only_verification:true,deployment_performed:false,source_modification_performed:false,real_money_settlement_performed:false,physical_fresh_install_claimed:false,physical_device_claimed:false,physical_device_certified:false,
      install_http_200:true,versioned_manifest_discovery_pass:true,customer_apk_cta_absent:true,
      manifest_http_200:true,manifest_name:versionedManifest.name,manifest_short_name:versionedManifest.short_name,manifest_id:versionedManifest.id,manifest_start_url:versionedManifest.start_url,manifest_scope:versionedManifest.scope,manifest_display:versionedManifest.display,manifest_description_not_rescue:true,unversioned_manifest_same_identity_pass:true,
      dedicated_dark_app_shell_pass:true,public_chrome_absent_from_app_pass:true,standalone_installed_mode_pass:true,installed_open_action_label:'Open MUSITU Chemistry',installed_open_action_target:'/chemistry/app',installed_handoff_click_pass:true,
      scientific_response_route_pass:true,equation_interaction_pass:true,molecular_structure_pass:true,particle_model_pass:true,cross_representation_link_pass:true,scientific_argument_pass:true,scientific_response_graph_pass:true,finalized_review_immutable_pass:true,finalized_reload_persistence_pass:true,reopen_pass:true,
      premium_internal_pass:true,help_internal_pass:true,public_rescue_pass:true,rescue_versioned_manifest_discovery_pass:true,service_worker_v8_pass:true,service_worker_versioned_manifest_pass:true,
      offline_prove_pass:true,offline_premium_pass:true,offline_help_pass:true,sensitive_routes_offline_fail_closed_pass:true,reconnect_pass:true,
      strict_security_headers_pass:true,health_ok:true,raw_paynow_key_present:false,payment_authority_bound:true,transport_bound:true,
      legacy_apk_sha256:apkHash,legacy_apk_bytes:apk.body.length
    };
    fs.writeFileSync(evidence+'/result.json',JSON.stringify(result,null,2)+'\n');
    fs.writeFileSync(evidence+'/sensitive-offline.json',JSON.stringify(sensitive,null,2)+'\n');
    console.log('MUSITU_CHEMISTRY_DEDICATED_APP_IDENTITY_PRODUCTION_BROWSER_ACCEPTANCE=PASS');
    console.log(JSON.stringify(result));
  }finally{
    if(installedContext)await installedContext.close();
    if(context)await context.close();
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exit(1)});
