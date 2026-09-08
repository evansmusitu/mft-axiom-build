const fs=require('fs');
const crypto=require('crypto');
const {chromium}=require('playwright');

(async()=>{
  const base=process.env.BASE_URL;
  const evidence=process.env.EVIDENCE_DIR||'/tmp/mchem-srg-browser-evidence';
  const nonce=crypto.randomBytes(8).toString('hex');
  const strict=h=>{
    const csp=h['content-security-policy']||'';
    return csp.includes("style-src 'self'")&&csp.includes("script-src 'self'")&&csp.includes("connect-src 'self'")&&csp.includes("manifest-src 'self'")&&!csp.includes('unsafe-inline')&&!csp.includes('unsafe-eval')&&h['referrer-policy']==='no-referrer'&&h['x-frame-options']==='DENY'&&h['x-content-type-options']==='nosniff';
  };

  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
  let context;
  try{
    context=await browser.newContext({viewport:{width:430,height:900},userAgent:'MUSITU-Scientific-Response-Production-Acceptance/1.0'});
    const page=await context.newPage();
    const browserErrors=[];
    page.on('console',m=>{
      if(m.type()!=='error')return;
      const text=m.text();
      if(/ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(text))return;
      browserErrors.push(text);
    });
    page.on('pageerror',e=>browserErrors.push('pageerror:'+e.message));

    const direct=async(path,accept='text/html')=>{
      const sep=path.includes('?')?'&':'?';
      const r=await context.request.get(base+path+sep+'__mchem_srg_accept='+nonce,{headers:{Accept:accept,'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'}});
      return {status:r.status(),headers:r.headers(),body:await r.body()};
    };
    const htmlHas=async(required=[],forbidden=[])=>{
      const html=await page.locator('html').evaluate(el=>el.outerHTML);
      for(const x of required)if(!html.includes(x))throw new Error('DOM missing '+x);
      for(const x of forbidden)if(html.includes(x))throw new Error('DOM exposed '+x);
      return html;
    };

    const examResponse=await page.goto(base+'/chemistry/app?view=exam&__mchem_live='+nonce,{waitUntil:'networkidle'});
    if(examResponse?.status()!==200)throw new Error('exam HTTP '+examResponse?.status());
    if(examResponse.headers()['cache-control']!=='no-store')throw new Error('exam cache-control not no-store');
    if(!strict(examResponse.headers()))throw new Error('exam strict headers rejected');
    await htmlHas(['Answer Chemistry as Chemistry.','data-scientific-response-os','Certified exam mode.','Scientific Response Graph','Reaction Mechanism','Molecular Structure','Scientific Graph','Lab Apparatus','Particle Model','Scientific Argument','Accessibility Description'],['class="site-header"','class="site-footer"']);
    if(await page.locator('#app-onboarding:not([hidden])').count())await page.locator('#app-onboarding-skip').click();

    const swText=(await direct('/chemistry/sw.js','application/javascript')).body.toString('utf8');
    if(!swText.includes('musitu-chemistry-install-v7')||!swText.includes('/chemistry/app?view=exam')||!swText.includes('checkout|return|claim|telemetry|plans'))throw new Error('service worker v7 boundary rejected');
    const appJs=(await direct('/chemistry/assets/app-shell.js','application/javascript')).body.toString('utf8');
    for(const x of ['musitu.scientific_response_graph.v1','let viewMode=response.activeMode','finalized:parsed.finalized===true','same-scientific-concept'])if(!appJs.includes(x))throw new Error('live app JS missing '+x);

    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload({waitUntil:'networkidle'});
    if(await page.locator('#app-onboarding:not([hidden])').count())await page.locator('#app-onboarding-skip').click();
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);

    const equation=page.locator('[data-sr-equation]');
    await equation.fill('2H₂ + O₂ ');
    await page.locator('[data-sr-symbol="→"]').click();
    await equation.pressSequentially(' 2H₂O');
    if(await equation.inputValue()!=='2H₂ + O₂ → 2H₂O')throw new Error('equation interaction rejected');

    await page.locator('[data-sr-mode="structure"]').click();
    const structure=page.locator('[data-sr-panel="structure"]');
    await structure.locator('[data-sr-add="atom"][data-sr-label="C"]').click();
    await structure.locator('[data-sr-add="atom"][data-sr-label="O"]').click();
    const structureNodes=structure.locator('[data-sr-node]');
    if(await structureNodes.count()!==2)throw new Error('structure board did not create two objects');
    await structureNodes.nth(0).click();
    await structureNodes.nth(1).click();
    await structure.locator('[data-sr-connect="double-bond"]').click();

    await page.locator('[data-sr-mode="particle"]').click();
    const particle=page.locator('[data-sr-panel="particle"]');
    await particle.locator('[data-sr-add="molecule"]').click();
    if(await particle.locator('[data-sr-node]').count()!==1)throw new Error('particle board not independent');
    await particle.locator('[data-sr-node]').click();
    await page.locator('[data-sr-mode="structure"]').click();
    await structure.locator('[data-sr-node]').nth(0).click();
    await structure.locator('[data-sr-link-representation]').click();

    await page.locator('[data-sr-mode="argument"]').click();
    await page.locator('[data-sr-argument="claim"]').fill('Increasing pressure changes the equilibrium position.');
    await page.locator('[data-sr-argument="evidence"]').fill('The two sides contain different total gaseous mole counts.');
    await page.locator('[data-sr-argument="principle"]').fill('Le Chatelier principle.');
    await page.locator('[data-sr-argument="conclusion"]').fill('The equilibrium shifts toward fewer gaseous moles.');

    await page.locator('[data-sr-mode="graph-data"]').click();
    const parseGraph=async()=>JSON.parse(await page.locator('[data-sr-graph-output]').textContent()||'{}');
    const graph=await parseGraph();
    if(graph.schema!=='musitu.scientific_response_graph.v1'||graph.examMode!=='certified'||graph.text!=='2H₂ + O₂ → 2H₂O')throw new Error('SRG identity/text rejected');
    if(!graph.objects.some(x=>x.mode==='structure'&&x.label==='C')||!graph.objects.some(x=>x.mode==='structure'&&x.label==='O')||!graph.objects.some(x=>x.mode==='particle'&&x.kind==='molecule'))throw new Error('SRG objects rejected');
    if(!graph.edges.some(x=>x.kind==='double-bond')||!graph.edges.some(x=>x.mode==='cross'&&x.kind==='same-scientific-concept'))throw new Error('SRG edges rejected');
    if(graph.argument.principle!=='Le Chatelier principle.')throw new Error('SRG argument rejected');

    await page.locator('[data-sr-finalize]').click();
    if(await equation.getAttribute('readonly')!=='')throw new Error('finalized equation not readonly');
    if(!await page.locator('[data-sr-add="atom"]').first().isDisabled())throw new Error('finalized construction still enabled');
    if(!await page.locator('[data-sr-reset]').isDisabled())throw new Error('finalized destructive clear still enabled');
    if(!/locked for review/i.test(await page.locator('[data-sr-status]').textContent()||''))throw new Error('finalized status missing');
    await page.waitForFunction(()=>document.querySelector('[data-sr-live]')?.textContent?.includes('No network submission has occurred'));

    const frozenBefore=await parseGraph();
    const frozenStorageBefore=await page.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
    await page.locator('[data-sr-mode="equation"]').click();
    await page.locator('[data-sr-mode="structure"]').click();
    await page.locator('[data-sr-mode="graph-data"]').click();
    const frozenAfterReview=await parseGraph();
    if(JSON.stringify(frozenAfterReview)!==JSON.stringify(frozenBefore))throw new Error('finalized SRG mutated during review navigation');

    await page.reload({waitUntil:'networkidle'});
    if(!/locked for review/i.test(await page.locator('[data-sr-status]').textContent()||''))throw new Error('finalized lock lost on reload');
    if(await page.locator('[data-sr-equation]').getAttribute('readonly')!=='')throw new Error('equation unlocked on reload');
    if(!await page.locator('[data-sr-reset]').isDisabled())throw new Error('clear unlocked on reload');
    const frozenStorageAfter=await page.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
    if(frozenStorageAfter!==frozenStorageBefore)throw new Error('persisted finalized SRG mutated on reload');
    const frozenAfterReload=await parseGraph();
    if(JSON.stringify(frozenAfterReload)!==JSON.stringify(frozenBefore))throw new Error('finalized SRG semantics changed on reload');

    await page.locator('[data-sr-reopen]').click();
    if(await page.locator('[data-sr-add="atom"]').first().isDisabled())throw new Error('reopen did not unlock construction');
    if(await page.locator('[data-sr-reset]').isDisabled())throw new Error('reopen did not unlock clear');

    for(const view of ['exam','premium','help']){
      await page.goto(base+'/chemistry/app?view='+view,{waitUntil:'networkidle'});
      await page.evaluate(()=>navigator.serviceWorker.ready);
    }
    await page.goto(base+'/chemistry/app?view=exam',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'Answer Chemistry as Chemistry.'}).waitFor();
    await htmlHas(['data-scientific-response-os','class="app-nav"'],['class="site-header"','class="site-footer"']);

    const sensitive=await page.evaluate(async()=>{
      const paths=['/chemistry/checkout','/chemistry/return','/chemistry/claim','/chemistry/telemetry','/chemistry/plans'];
      const out={};
      for(const p of paths){
        try{const r=await fetch(p,{cache:'no-store'});out[p]={resolved:true,status:r.status}}
        catch{out[p]={resolved:false}}
      }
      return out;
    });
    for(const [path,v] of Object.entries(sensitive))if(v.resolved)throw new Error('sensitive route resolved offline '+path+' '+JSON.stringify(v));

    await page.locator('.app-nav a[href="/chemistry/app?view=premium"]').click();
    await page.getByRole('heading',{name:'Unlock full mastery.'}).waitFor();
    await page.locator('.app-nav a[href="/chemistry/app?view=help"]').click();
    await page.getByRole('heading',{name:'Help without leaving MUSITU.'}).waitFor();
    await context.setOffline(false);
    await page.reload({waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Help without leaving MUSITU.'}).waitFor();

    const rescue=await direct('/chemistry/rescue?src=direct');
    const rescueText=rescue.body.toString('utf8');
    if(rescue.status!==200||!rescueText.includes('Help another Chemistry student before exams'))throw new Error('public Rescue rejected');
    const install=await direct('/chemistry/install');
    const installText=install.body.toString('utf8');
    if(installText.includes('Download verified Android APK')||installText.includes('href="/chemistry/download/'))throw new Error('customer APK CTA returned');

    const manifest=JSON.parse((await direct('/chemistry/manifest.webmanifest','application/manifest+json')).body.toString('utf8'));
    if(manifest.id!=='/chemistry/rescue?src=direct'||manifest.start_url!=='/chemistry/app'||manifest.scope!=='/chemistry/'||manifest.display!=='standalone')throw new Error('manifest identity changed');
    const health=JSON.parse((await direct('/chemistry/healthz','application/json')).body.toString('utf8'));
    if(health.ok!==true||health.raw_paynow_key_present!==false||health.payment_authority_bound!==true||health.transport_bound!==true)throw new Error('health authority rejected '+JSON.stringify(health));
    for(const path of ['/chemistry/app?view=exam','/chemistry/install','/chemistry/rescue?src=direct']){
      const r=await direct(path);
      if(r.status!==200||!strict(r.headers))throw new Error('strict security headers rejected '+path);
    }

    const apk=await direct('/chemistry/download/MUSITU_Chemistry_Mastery_1.2.0.apk','application/vnd.android.package-archive');
    const apkHash=crypto.createHash('sha256').update(apk.body).digest('hex');
    if(apk.status!==200||apk.body.length!==5314934||apkHash!==process.env.APK_SHA256)throw new Error('legacy APK provenance changed');

    if(browserErrors.length)throw new Error('browser console/page errors: '+JSON.stringify(browserErrors));
    const result={
      schema:'musitu.chemistry.scientific_response.production_browser_acceptance.v1',
      tested_at_utc:new Date().toISOString(),
      github_sha:process.env.GITHUB_SHA,
      deployed_source_sha:process.env.DEPLOYED_SOURCE_SHA,
      production_worker_sha256:process.env.PRODUCTION_WORKER_SHA256,
      scientific_response_route_pass:true,
      equation_interaction_pass:true,
      molecular_structure_pass:true,
      particle_model_pass:true,
      cross_representation_link_pass:true,
      scientific_argument_pass:true,
      scientific_response_graph_pass:true,
      finalized_review_immutable_pass:true,
      finalized_reload_persistence_pass:true,
      reopen_pass:true,
      service_worker_v7_pass:true,
      offline_prove_pass:true,
      sensitive_routes_offline_fail_closed_pass:true,
      reconnect_pass:true,
      premium_help_internal_pass:true,
      public_rescue_pass:true,
      customer_apk_cta_absent:true,
      manifest_identity_preserved:true,
      strict_security_headers_pass:true,
      health_ok:true,
      raw_paynow_key_present:false,
      payment_authority_bound:true,
      transport_bound:true,
      legacy_apk_sha256:apkHash,
      legacy_apk_bytes:apk.body.length,
      deployment_performed:false,
      physical_device_claimed:false,
      physical_device_certified:false,
      real_money_settlement_performed:false
    };
    fs.writeFileSync(evidence+'/result.json',JSON.stringify(result,null,2)+'\n');
    fs.writeFileSync(evidence+'/sensitive-offline.json',JSON.stringify(sensitive,null,2)+'\n');
    console.log('MUSITU_CHEMISTRY_SCIENTIFIC_RESPONSE_PRODUCTION_BROWSER_ACCEPTANCE=PASS');
    console.log(JSON.stringify(result));
  } finally {
    if(context)await context.close();
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exit(1)});
