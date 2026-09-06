import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path,env={}){
  const r=await handleRequest(new Request(base+path),env);
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
    ['/chemistry/privacy','Anonymous experience measurement'],
    ['/chemistry/experience','Real-user experience evidence'],
    ['/chemistry/terms','Premium access is granted only by a valid MUSITU-signed licence after verified settlement']
  ];
  for(const [path,needle] of checks){
    const {r,text}=await get(path);
    assert.equal(r.status,200,path);
    assert.match(text,new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),path);
    const csp=r.headers.get('content-security-policy')||'';
    assert.match(csp,/style-src 'self'/,path);
    assert.match(csp,/script-src 'self'/,path);
    assert.match(csp,/connect-src 'self'/,path);
    assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|https?:\/\//,path);
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.equal(r.headers.get('x-frame-options'),'DENY');
    assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  }
});

test('same-origin presentation and field assets are pinned and bounded',async()=>{
  const css=await get('/chemistry/assets/storefront.css');
  assert.equal(css.r.status,200); assert.match(css.r.headers.get('content-type')||'',/^text\/css/); assert.ok(Buffer.byteLength(css.text)<=24*1024);
  const js=await get('/chemistry/assets/storefront.js');
  assert.equal(js.r.status,200); assert.match(js.r.headers.get('content-type')||'',/^application\/javascript/); assert.ok(Buffer.byteLength(js.text)<=12*1024);
  assert.doesNotMatch(js.text,/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  const vitals=await get('/chemistry/assets/web-vitals-6.0.1.iife.js');
  assert.equal(vitals.r.status,200); assert.equal(Buffer.byteLength(vitals.text),8987); assert.match(vitals.text,/webVitals/);
  const field=await get('/chemistry/assets/field-experience.js');
  assert.equal(field.r.status,200); assert.ok(Buffer.byteLength(field.text)<=12*1024); assert.match(field.text,/sendBeacon\('\/chemistry\/telemetry\/v1'/); assert.doesNotMatch(field.text,/https?:\/\//);
});

test('sitemap and security surfaces include v3 lifecycle and experience routes',async()=>{
  const sitemap=await get('/chemistry/sitemap.xml');
  assert.equal(sitemap.r.status,200);
  for(const path of ['/chemistry/plans','/chemistry/verify','/chemistry/releases','/chemistry/support','/chemistry/privacy','/chemistry/terms','/chemistry/experience']) assert.ok(sitemap.text.includes(path));
  const security=await get('/chemistry/security.txt');
  assert.equal(security.r.status,200); assert.match(security.text,/Canonical:/); assert.match(security.text,/Policy:/);
});

test('existing catalogue and checkout GET remain authoritative',async()=>{
  const catalog=await get('/chemistry/catalog');
  assert.equal(catalog.r.status,200);
  const body=JSON.parse(catalog.text);
  assert.deepEqual(body.plans.map(p=>p.id),['term','annual','lifetime','family','tutor','school']);
  const annual=await get('/chemistry/checkout/start?plan=annual');
  assert.equal(annual.r.status,200); assert.match(annual.text,/Annual/); assert.match(annual.text,/US\$9\.99/); assert.match(annual.text,/Continue securely to Paynow/); assert.match(annual.text,/data-field-event="checkout_continue"/);
  const school=await get('/chemistry/checkout/start?plan=school');
  assert.equal(school.r.status,200); assert.match(school.text,/Student seats/); assert.match(school.text,/min="1"/); assert.match(school.text,/max="999"/);
});

test('privacy and experience surfaces state the aggregate-only boundary',async()=>{
  const privacy=await get('/chemistry/privacy');
  for(const text of ['Anonymous experience measurement','do not contain an IP address','URL query string','Global Privacy Control','data-measurement-toggle']) assert.match(privacy.text,new RegExp(text,'i'));
  const exp=await get('/chemistry/experience');
  assert.match(exp.text,/insufficient field sample/i);
  assert.match(exp.text,/Individual visits are not stored as analytics rows/i);
  const json=await get('/chemistry/experience.json');
  const snap=JSON.parse(json.text);
  assert.equal(snap.status,'insufficient_field_sample');
  assert.equal(snap.minimum_public_sample,100);
});

test('public pages do not expose secret names or private material markers',async()=>{
  const paths=['/chemistry/','/chemistry/plans','/chemistry/verify','/chemistry/releases','/chemistry/support','/chemistry/privacy','/chemistry/terms','/chemistry/experience'];
  const forbidden=['CHEMISTRY_LICENSE_PKCS8_B64','PAYNOW_INTEGRATION_KEY','CLOUDFLARE_GLOBAL_API_KEY','CHEMISTRY_AUTHORITY_BRIDGE_TOKEN','BEGIN PRIVATE KEY'];
  for(const path of paths){const {text}=await get(path);for(const word of forbidden)assert.equal(text.includes(word),false,`${path} ${word}`)}
});

test('support recovery does not link to a reference-required status route without a reference',async()=>{
  const support=await get('/chemistry/support');
  assert.equal(support.r.status,200);
  assert.doesNotMatch(support.text,/href="\/chemistry\/return"/);
  assert.match(support.text,/If you no longer have that status link/i);
});

test('telemetry endpoint rejects cross-origin input before database access',async()=>{
  let touched=false;
  const env={CHEMISTRY_DB:{prepare(){touched=true;throw new Error('should not touch')}}};
  const r=await handleRequest(new Request(base+'/chemistry/telemetry/v1',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({events:[{kind:'event',name:'page_view',route:'home',viewport:'mobile',detail:''}]})}),env);
  assert.equal(r.status,400); assert.equal(touched,false);
});

test('valid telemetry increments aggregate buckets without retaining identity fields',async()=>{
  const calls=[];
  const env={
    CHEMISTRY_DB:{
      prepare(sql){
        return {
          async run(){calls.push({sql,args:[]});return{}},
          bind(...args){return {run:async()=>{calls.push({sql,args});return{}}}}
        };
      }
    }
  };
  const body={events:[{kind:'vital',name:'LCP',value:1041.4,route:'home',viewport:'mobile',detail:''},{kind:'event',name:'start_free',route:'home',viewport:'mobile',detail:''}]};
  const r=await handleRequest(new Request(base+'/chemistry/telemetry/v1',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(body)}),env);
  assert.equal(r.status,204);
  const serialized=JSON.stringify(calls);
  assert.match(serialized,/chemistry_field_aggregate/);
  assert.match(serialized,/1050/);
  for(const forbidden of ['email','device_id','reference','referrer','user_agent']) assert.equal(serialized.includes(forbidden),false,forbidden);
});
