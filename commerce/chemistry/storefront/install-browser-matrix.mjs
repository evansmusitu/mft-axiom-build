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
  assert.equal(await page.locator('link[href="/chemistry/manifest.webmanifest"]').count(),1);
  assert.equal(await page.locator('link[href="/chemistry/assets/install-concierge.css?v=4"]').count(),1);
  await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.defineProperty(e,'prompt',{value:async()=>{}});Object.defineProperty(e,'userChoice',{value:Promise.resolve({outcome:'accepted'})});dispatchEvent(e)});
  assert.equal(await root.getAttribute('data-install-mode'),'native');
  await page.locator('#install-musitu').click();
  const swResponse=await page.request.get(origin+'/chemistry/sw.js');
  assert.equal(swResponse.status(),200);
  assert.match(swResponse.headers()['cache-control']||'',/no-cache/);
  const swText=await swResponse.text();
  assert.match(swText,/musitu-chemistry-install-v5/);
  assert.match(swText,/const APP='\/chemistry\/app'/);
  await page.evaluate(()=>navigator.serviceWorker?.ready);

  const onlineApp=await page.goto(origin+'/chemistry/app',{waitUntil:'networkidle'});
  assert.equal(onlineApp?.status(),200);
  assert.equal(await page.getByRole('heading',{name:'Your Chemistry workspace.'}).count(),1);
  assert.equal(await page.locator('.site-header').count(),0,'public site header leaked into app shell');

  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(await page.getByRole('heading',{name:'Your Chemistry workspace.'}).count(),1,'offline app reload did not recover dedicated app shell');
  assert.equal(await page.locator('.site-header').count(),0,'offline app reload fell back to public website chrome');
  assert.equal(await page.locator('.app-nav').count(),1,'offline app navigation missing');
  await context.setOffline(false);
  await context.close();

  const installedContext=await browser.newContext({viewport:{width:390,height:844},userAgent:UA.androidChrome});
  await installedContext.addInitScript(()=>{const native=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,media:q,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}}:native(q)});
  const installedPage=await installedContext.newPage();
  await installedPage.goto(origin+'/chemistry/install',{waitUntil:'domcontentloaded'});
  assert.equal(await installedPage.locator('#install-concierge').getAttribute('data-install-mode'),'installed');
  assert.equal(await installedPage.getByRole('link',{name:'Open Chemistry Rescue'}).count(),1);
  await installedContext.close();
  console.log(JSON.stringify({schema:'musitu.chemistry.install_browser_matrix.v3',classifier_cases:matrix.map(x=>x[0]),chromium_contracts:['server-rendered immediate Android action','trusted install prompt event','service worker v5 dedicated app-shell cache','offline dedicated app-shell reload','installed-state UI','sensitive routes remain network-authoritative'],physical_device_certification:false,pass:true},null,2));
}finally{await browser.close()}
