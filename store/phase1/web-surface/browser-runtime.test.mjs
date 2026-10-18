/**
 * Real installed Chromium acceptance: local HTTP wrapper around the *actual*
 * Store Worker fetch handler, no public deployment or genuine installs.
 * Invoked only from the isolated, ephemeral CI runner with Playwright.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import worker from './worker.mjs';

let server,origin,browser;
test.before(async()=>{
  server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      const proxy=new Request('https://payments.mftintelligence.com'+url.pathname+url.search,{
        method:req.method,headers:req.headers
      });
      const answer=await worker.fetch(proxy,{}, {});
      const headers={};
      for(const [key,value] of answer.headers)headers[key]=value;
      // A browser on localhost is a secure context; actual external origin is NOT contacted.
      res.writeHead(answer.status,headers);
      if(req.method!=='HEAD')res.end(Buffer.from(await answer.arrayBuffer()));
      else res.end();
    }catch(err){res.writeHead(500,{'content-type':'text/plain'});res.end('isolated worker error');}
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({
    headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
});
test.after(async()=>{if(browser)await browser.close();if(server)await new Promise(ok=>server.close(ok));});

test('actual Chromium gets accessible Store, CSP, self-hosted PWA shell and service-worker controller',async()=>{
  const context=await browser.newContext();
  try{
    const page=await context.newPage();
    const response=await page.goto(origin+'/store',{waitUntil:'load'});
    assert.equal(response.status(),200);
    assert.equal(await page.title(),'MUSITU Store');
    assert.equal(await page.locator('#main').count(),1);
    assert.equal(await page.locator('a.skip-link').count(),1);
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'),'/store/manifest.webmanifest');
    assert.match(response.headers()['content-security-policy'],/script-src 'self'/);
    assert.equal(await page.locator('a[href="/store/open"]').count()>0,true);
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});
    const keys=await page.evaluate(async()=>await caches.keys());
    assert.ok(keys.includes('musitu-store-r2'));
    const cached=await page.evaluate(async()=>{
      const a=await caches.open('musitu-store-r2');return (await a.keys()).map(k=>new URL(k.url).pathname);
    });
    assert.ok(cached.includes('/store'));
    assert.equal(cached.includes('/store/catalog.json'),false);
    assert.equal(cached.includes('/store/catalog.sig'),false);
    assert.equal(cached.some(x=>x.endsWith('.apk')||x.endsWith('.ipa')),false);
  }finally{await context.close();}
});

test('actual Chromium offline mode uses public shell but never pretends a separately cached signed catalog is trusted',async()=>{
  const context=await browser.newContext();
  try{
    const page=await context.newPage();
    await page.goto(origin+'/store',{waitUntil:'load'});
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:15000});
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'});
    assert.match(await page.locator('h1').first().innerText(),/Open MUSITU instantly/i);
    await page.goto(origin+'/store/offline',{waitUntil:'domcontentloaded'});
    assert.match(await page.locator('main').innerText(),/trusted signed catalog is not available offline/i);
    const offlineNetwork=await page.evaluate(async()=>{
      try {const r=await fetch('/store/catalog.json',{cache:'no-store'});return {ok:r.ok,status:r.status};}
      catch{return {ok:false};}
    });
    assert.equal(offlineNetwork.ok,false,'unverified offline catalog must not be presented as trustworthy');
  }finally{await context.close();}
});

test('actual Chromium browser-first open flow never downloads Android or iOS packages',async()=>{
  const context=await browser.newContext();
  try{
    const page=await context.newPage();
    const downloads=[];
    page.on('download',d=>downloads.push(d));
    await page.goto(origin+'/store/install?platform=web');
    assert.equal(await page.locator('a[href="/store/open"]').count(),1);
    assert.equal(await page.locator('a[href*=".apk"],a[href*=".ipa"]').count(),0);
    await page.goto(origin+'/store/apps/chemistry');
    assert.equal(await page.locator('a[href="/store/open"]').count(),1);
    assert.equal(downloads.length,0);
  }finally{await context.close();}
});
