import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {classifyInstallContext} from './install.mjs';

const UA={
  iphoneSafari:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipadSafari:'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneChrome:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneLinkedIn:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 LinkedInApp/9.99',
  androidChrome:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  samsung:'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  androidWebView:'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  desktopEdge:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
};
const matrix=[
  ['iPhone Safari',UA.iphoneSafari,'Apple Computer, Inc.',5,false,'ios-safari'],['iPad Safari',UA.ipadSafari,'Apple Computer, Inc.',5,false,'ios-safari'],['iPhone non-Safari',UA.iphoneChrome,'Apple Computer, Inc.',5,false,'ios-other'],['iOS in-app',UA.iphoneLinkedIn,'Apple Computer, Inc.',5,false,'ios-inapp'],['Android Chrome',UA.androidChrome,'Google Inc.',5,false,'android-chrome'],['Samsung Internet',UA.samsung,'Google Inc.',5,false,'samsung'],['Android WebView',UA.androidWebView,'Google Inc.',5,false,'android-inapp'],['Desktop Edge',UA.desktopEdge,'Google Inc.',0,false,'desktop-edge'],['Already installed',UA.androidChrome,'Google Inc.',5,true,'installed']
];
for(const [name,ua,vendor,maxTouchPoints,standalone,want] of matrix)assert.equal(classifyInstallContext({ua,vendor,maxTouchPoints,standalone}),want,name);

const origin=process.env.INSTALL_MATRIX_ORIGIN||'http://127.0.0.1:8787';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},userAgent:UA.androidChrome});
  const page=await context.newPage();
  const response=await page.goto(origin+'/chemistry/install',{waitUntil:'networkidle'});
  assert.equal(response?.status(),200);
  const root=page.locator('#install-concierge');
  assert.equal(await root.count(),1);
  assert.equal(await root.getAttribute('data-install-mode'),'android-ready');
  assert.equal(await page.getByRole('link',{name:'Use MUSITU now'}).count()>0,true);
  assert.equal(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count(),1);
  assert.equal(await page.locator('link[href="/chemistry/assets/install-concierge.css?v=4"]').count(),1);

  const manifestResponse=await page.request.get(origin+'/chemistry/manifest.webmanifest?v=2');
  assert.equal(manifestResponse.status(),200);
  const manifest=await manifestResponse.json();
  assert.equal(manifest.id,'/chemistry/app');
  assert.equal(manifest.name,'MUSITU Chemistry');
  assert.equal(manifest.short_name,'MUSITU Chemistry');
  assert.equal(manifest.start_url,'/chemistry/app');
  assert.equal(manifest.scope,'/chemistry/');
  assert.equal(manifest.display,'standalone');
  assert.doesNotMatch(manifest.description||'',/Rescue/i);

  await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.defineProperty(e,'prompt',{value:async()=>{}});Object.defineProperty(e,'userChoice',{value:Promise.resolve({outcome:'accepted'})});dispatchEvent(e)});
  assert.equal(await root.getAttribute('data-install-mode'),'native');
  await page.locator('#install-musitu').click();
  const swResponse=await page.request.get(origin+'/chemistry/sw.js');
  assert.equal(swResponse.status(),200);
  assert.match(swResponse.headers()['cache-control']||'',/no-cache/);
  const swText=await swResponse.text();
  assert.match(swText,/musitu-chemistry-install-v8/);
  assert.match(swText,/const APP='\/chemistry\/app'/);
  assert.match(swText,/\/chemistry\/app\?view=exam/);
  assert.match(swText,/\/chemistry\/app\?view=premium/);
  assert.match(swText,/\/chemistry\/app\?view=help/);
  assert.match(swText,/\/chemistry\/manifest\.webmanifest\?v=2/);
  assert.match(swText,/app-shell\.css\?v=4/);
  assert.match(swText,/app-shell\.js\?v=4/);
  assert.match(swText,/checkout\|return\|claim\|telemetry\|plans/);
  await page.evaluate(()=>navigator.serviceWorker?.ready);

  const onlineApp=await page.goto(origin+'/chemistry/app',{waitUntil:'networkidle'});
  assert.equal(onlineApp?.status(),200);
  assert.equal(await page.locator('link[href="/chemistry/manifest.webmanifest?v=2"]').count(),1);
  assert.equal(await page.getByRole('heading',{name:'Your Chemistry workspace.'}).count(),1);
  assert.equal(await page.locator('.site-header').count(),0,'public site header leaked into app shell');
  const firstLaunch=page.locator('#app-onboarding:not([hidden])');
  if(await firstLaunch.count())await page.locator('#app-onboarding-skip').click();
  assert.equal(await page.locator('#app-onboarding[hidden]').count(),1,'first-launch onboarding did not dismiss');

  await page.locator('.app-nav a[href="/chemistry/app?view=exam"]').click();
  await page.waitForLoadState('networkidle');
  assert.equal(new URL(page.url()).pathname,'/chemistry/app');
  assert.equal(new URL(page.url()).searchParams.get('view'),'exam');
  assert.equal(await page.getByRole('heading',{name:'Answer Chemistry as Chemistry.'}).count(),1);
  assert.equal(await page.locator('[data-scientific-response-os]').count(),1);
  assert.equal(await page.locator('.site-header').count(),0,'public site header leaked into Prove app view');

  const equation=page.locator('[data-sr-equation]');
  await equation.fill('2H₂ + O₂ ');
  await page.locator('[data-sr-symbol="→"]').click();
  await equation.pressSequentially(' 2H₂O');
  assert.equal(await equation.inputValue(),'2H₂ + O₂ → 2H₂O');

  await page.locator('[data-sr-mode="structure"]').click();
  const structure=page.locator('[data-sr-panel="structure"]');
  await structure.locator('[data-sr-add="atom"][data-sr-label="C"]').click();
  await structure.locator('[data-sr-add="atom"][data-sr-label="O"]').click();
  const structureNodes=structure.locator('[data-sr-node]');
  assert.equal(await structureNodes.count(),2);
  await structureNodes.nth(0).click();
  await structureNodes.nth(1).click();
  await structure.locator('[data-sr-connect="double-bond"]').click();

  await page.locator('[data-sr-mode="particle"]').click();
  const particle=page.locator('[data-sr-panel="particle"]');
  await particle.locator('[data-sr-add="molecule"]').click();
  assert.equal(await particle.locator('[data-sr-node]').count(),1,'particle board did not resolve independently');

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
  const graphText=await page.locator('[data-sr-graph-output]').textContent();
  const graph=JSON.parse(graphText||'{}');
  assert.equal(graph.schema,'musitu.scientific_response_graph.v1');
  assert.equal(graph.examMode,'certified');
  assert.equal(graph.text,'2H₂ + O₂ → 2H₂O');
  assert.ok(graph.objects.some(x=>x.mode==='structure'&&x.label==='C'));
  assert.ok(graph.objects.some(x=>x.mode==='structure'&&x.label==='O'));
  assert.ok(graph.objects.some(x=>x.mode==='particle'&&x.kind==='molecule'));
  assert.ok(graph.edges.some(x=>x.kind==='double-bond'));
  assert.ok(graph.edges.some(x=>x.mode==='cross'&&x.kind==='same-scientific-concept'));
  assert.equal(graph.argument.principle,'Le Chatelier principle.');

  await page.locator('[data-sr-finalize]').click();
  assert.equal(await page.locator('[data-sr-equation]').getAttribute('readonly'),'');
  assert.equal(await page.locator('[data-sr-add="atom"]').first().isDisabled(),true);
  assert.match(await page.locator('[data-sr-status]').textContent()||'',/locked for review/i);
  await page.waitForFunction(()=>document.querySelector('[data-sr-live]')?.textContent?.includes('No network submission has occurred'));
  assert.match(await page.locator('[data-sr-live]').textContent()||'',/No network submission has occurred/i);

  const frozenBefore=JSON.parse(await page.locator('[data-sr-graph-output]').textContent()||'{}');
  await page.locator('[data-sr-mode="equation"]').click();
  await page.locator('[data-sr-mode="structure"]').click();
  await page.locator('[data-sr-mode="graph-data"]').click();
  const frozenAfter=JSON.parse(await page.locator('[data-sr-graph-output]').textContent()||'{}');
  assert.deepEqual(frozenAfter,frozenBefore,'view-only navigation mutated a finalized Scientific Response Graph');
  assert.equal(await page.locator('[data-sr-reset]').isDisabled(),true,'finalized response allowed destructive clear before reopen');

  const frozenStorageBeforeReload=await page.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
  await page.reload({waitUntil:'networkidle'});
  assert.match(await page.locator('[data-sr-status]').textContent()||'',/locked for review/i,'finalized response did not stay locked across reload');
  assert.equal(await page.locator('[data-sr-equation]').getAttribute('readonly'),'','finalized equation became editable after reload');
  assert.equal(await page.locator('[data-sr-reset]').isDisabled(),true,'destructive clear unlocked after reload');
  const frozenStorageAfterReload=await page.evaluate(()=>localStorage.getItem('musitu_chem_scientific_response_v1'));
  assert.equal(frozenStorageAfterReload,frozenStorageBeforeReload,'reload mutated persisted finalized Scientific Response Graph');
  const frozenAfterReload=JSON.parse(await page.locator('[data-sr-graph-output]').textContent()||'{}');
  assert.deepEqual(frozenAfterReload,frozenBefore,'reload changed finalized Scientific Response Graph semantics');

  await page.locator('[data-sr-reopen]').click();
  assert.equal(await page.locator('[data-sr-add="atom"]').first().isDisabled(),false);
  assert.equal(await page.locator('[data-sr-reset]').isDisabled(),false);

  await page.locator('.app-nav a[href="/chemistry/app?view=premium"]').click();
  await page.waitForLoadState('networkidle');
  assert.equal(new URL(page.url()).pathname,'/chemistry/app');
  assert.equal(new URL(page.url()).searchParams.get('view'),'premium');
  assert.equal(await page.getByRole('heading',{name:'Unlock full mastery.'}).count(),1,'Premium left installed app shell');
  assert.equal(await page.locator('.site-header').count(),0,'public site header leaked into Premium app view');

  await page.locator('.app-nav a[href="/chemistry/app?view=help"]').click();
  await page.waitForLoadState('networkidle');
  assert.equal(new URL(page.url()).pathname,'/chemistry/app');
  assert.equal(new URL(page.url()).searchParams.get('view'),'help');
  assert.equal(await page.getByRole('heading',{name:'Help without leaving MUSITU.'}).count(),1,'Help left installed app shell');
  assert.equal(await page.locator('.site-header').count(),0,'public site header leaked into Help app view');

  await page.goto(origin+'/chemistry/app',{waitUntil:'networkidle'});
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(await page.getByRole('heading',{name:'Your Chemistry workspace.'}).count(),1,'offline app reload did not recover dedicated app shell');
  assert.equal(await page.locator('.site-header').count(),0,'offline app reload fell back to public website chrome');
  assert.equal(await page.locator('.app-nav').count(),1,'offline app navigation missing');

  await page.locator('.app-nav a[href="/chemistry/app?view=exam"]').click();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.getByRole('heading',{name:'Answer Chemistry as Chemistry.'}).count(),1,'offline Prove app view was not cached');
  assert.equal(await page.locator('[data-scientific-response-os]').count(),1,'offline Scientific Response OS missing');
  assert.equal(await page.locator('.site-header').count(),0,'offline Prove fell back to public chrome');

  await page.locator('.app-nav a[href="/chemistry/app?view=premium"]').click();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.getByRole('heading',{name:'Unlock full mastery.'}).count(),1,'offline Premium app view was not cached');
  assert.equal(await page.locator('.site-header').count(),0,'offline Premium fell back to public chrome');
  await page.locator('.app-nav a[href="/chemistry/app?view=help"]').click();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.getByRole('heading',{name:'Help without leaving MUSITU.'}).count(),1,'offline Help app view was not cached');
  assert.equal(await page.locator('.site-header').count(),0,'offline Help fell back to public chrome');

  await context.setOffline(false);
  await context.close();

  const installedContext=await browser.newContext({viewport:{width:390,height:844},userAgent:UA.androidChrome});
  await installedContext.addInitScript(()=>{const native=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,media:q,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}}:native(q)});
  const installedPage=await installedContext.newPage();
  await installedPage.goto(origin+'/chemistry/install',{waitUntil:'domcontentloaded'});
  assert.equal(await installedPage.locator('#install-concierge').getAttribute('data-install-mode'),'installed');
  const openApp=installedPage.getByRole('link',{name:'Open MUSITU Chemistry'});
  assert.equal(await openApp.count(),1);
  assert.equal(await openApp.getAttribute('href'),'/chemistry/app');
  assert.equal(await installedPage.getByRole('link',{name:'Open Chemistry Rescue'}).count(),0);
  await openApp.click();
  await installedPage.waitForLoadState('networkidle');
  assert.equal(new URL(installedPage.url()).pathname,'/chemistry/app');
  assert.equal(await installedPage.getByRole('heading',{name:'Your Chemistry workspace.'}).count(),1);
  assert.equal(await installedPage.locator('.site-header').count(),0,'installed handoff opened public Rescue chrome');
  await installedContext.close();
  console.log(JSON.stringify({schema:'musitu.chemistry.install_browser_matrix.v7',classifier_cases:matrix.map(x=>x[0]),chromium_contracts:['server-rendered immediate Android action','versioned dedicated PWA manifest id /chemistry/app','trusted install prompt event','service worker v8 dedicated app-shell cache','first-launch onboarding dismissal','Scientific Response OS equation interaction','independent structured science boards','cross-representation SRG link','scientific argument capture','response finalization lock','finalized SRG immutable during review navigation','finalized lock persists across reload','reopen editing','offline dedicated Prove reload','Premium and Help stay inside installed app online and offline','installed-state opens /chemistry/app','sensitive routes remain network-authoritative'],physical_device_certification:false,physical_fresh_install_retest:false,pass:true},null,2));
}finally{await browser.close()}
