import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path){
  const r=await handleRequest(new Request(base+path),{});
  return {r,text:await r.text()};
}

test('global public routes are server rendered and preserve public trust surfaces',async()=>{
  const checks=[
    ['/chemistry/','Know what you don’t know'],
    ['/chemistry/plans','Choose access without guessing'],
    ['/chemistry/plans?who=myself&duration=year','Recommended for you: Annual'],
    ['/chemistry/verify','Verify this MUSITU release'],
    ['/chemistry/releases','Release notes'],
    ['/chemistry/support','Find your Device ID'],
    ['/chemistry/privacy','Information processed for purchases'],
    ['/chemistry/terms','Premium access is granted only by a valid MUSITU-signed licence after verified settlement']
  ];
  for(const [path,needle] of checks){
    const {r,text}=await get(path);
    assert.equal(r.status,200,path);
    assert.match(text,new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),path);
    const csp=r.headers.get('content-security-policy')||'';
    assert.match(csp,/style-src 'self'/,path);
    assert.match(csp,/script-src 'self'/,path);
    assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/,path);
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.equal(r.headers.get('x-frame-options'),'DENY');
  }
});

test('same-origin presentation assets are bounded and executable without external network dependencies',async()=>{
  const css=await get('/chemistry/assets/storefront.css');
  assert.equal(css.r.status,200); assert.match(css.r.headers.get('content-type')||'',/^text\/css/); assert.ok(Buffer.byteLength(css.text)<=24*1024);
  const js=await get('/chemistry/assets/storefront.js');
  assert.equal(js.r.status,200); assert.match(js.r.headers.get('content-type')||'',/^application\/javascript/); assert.ok(Buffer.byteLength(js.text)<=12*1024);
  assert.doesNotMatch(js.text,/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
});

test('sitemap and security surfaces include v3 lifecycle routes',async()=>{
  const sitemap=await get('/chemistry/sitemap.xml');
  assert.equal(sitemap.r.status,200);
  for(const path of ['/chemistry/plans','/chemistry/verify','/chemistry/releases','/chemistry/support','/chemistry/privacy','/chemistry/terms']) assert.ok(sitemap.text.includes(path));
  const security=await get('/chemistry/security.txt');
  assert.equal(security.r.status,200); assert.match(security.text,/Canonical:/); assert.match(security.text,/Policy:/);
});

test('existing catalogue and checkout GET remain authoritative',async()=>{
  const catalog=await get('/chemistry/catalog');
  assert.equal(catalog.r.status,200);
  const body=JSON.parse(catalog.text);
  assert.deepEqual(body.plans.map(p=>p.id),['term','annual','lifetime','family','tutor','school']);
  const annual=await get('/chemistry/checkout/start?plan=annual');
  assert.equal(annual.r.status,200); assert.match(annual.text,/Annual/); assert.match(annual.text,/US\$9\.99/); assert.match(annual.text,/Continue securely to Paynow/);
  const school=await get('/chemistry/checkout/start?plan=school');
  assert.equal(school.r.status,200); assert.match(school.text,/Student seats/); assert.match(school.text,/min="1"/); assert.match(school.text,/max="999"/);
});

test('public pages do not expose secret names or private material markers',async()=>{
  const paths=['/chemistry/','/chemistry/plans','/chemistry/verify','/chemistry/releases','/chemistry/support','/chemistry/privacy','/chemistry/terms'];
  const forbidden=['CHEMISTRY_LICENSE_PKCS8_B64','PAYNOW_INTEGRATION_KEY','CLOUDFLARE_GLOBAL_API_KEY','CHEMISTRY_AUTHORITY_BRIDGE_TOKEN','BEGIN PRIVATE KEY'];
  for(const path of paths){const {text}=await get(path);for(const word of forbidden)assert.equal(text.includes(word),false,`${path} ${word}`)}
});
