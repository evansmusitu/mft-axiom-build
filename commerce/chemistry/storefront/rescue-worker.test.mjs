import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path){const r=await handleRequest(new Request(base+path),{});return {r,text:await r.text()}}
async function getBytes(path){const r=await handleRequest(new Request(base+path),{});return {r,bytes:new Uint8Array(await r.arrayBuffer())}}
function strict(r){const csp=r.headers.get('content-security-policy')||'';assert.match(csp,/style-src 'self'/);assert.match(csp,/script-src 'self'/);assert.match(csp,/connect-src 'self'/);assert.match(csp,/manifest-src 'self'/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|https?:\/\//);assert.equal(r.headers.get('referrer-policy'),'no-referrer')}

test('generated Worker serves bounded Rescue campaign through the existing strict public boundary',async()=>{
  const {r,text}=await get('/chemistry/rescue?src=wa_student');
  assert.equal(r.status,200);
  strict(r);
  assert.match(text,/MUSITU Chemistry Rescue 2026/);
  assert.match(text,/data-rescue-source="wa_student"/);
  assert.match(text,/data-field-event="rescue_start"/);
  assert.match(text,/data-field-event="rescue_share"/);
  const hostile=await get('/chemistry/rescue?src=school%3Cscript%3E');
  assert.equal(hostile.r.status,200);
  assert.match(hostile.text,/data-rescue-source="direct"/);
  assert.equal(hostile.text.includes('school<script>'),false);
  const sitemap=await get('/chemistry/sitemap.xml');
  assert.match(sitemap.text,/\/chemistry\/rescue/);
});

test('field client records bounded Rescue visits and student-share peer starts without identifiers',async()=>{
  const field=await get('/chemistry/assets/field-experience.js');
  assert.equal(field.r.status,200);
  assert.match(field.text,/q\('\[data-rescue-source\]'\)/);
  assert.match(field.text,/event\('rescue_visit'/);
  assert.match(field.text,/event\('rescue_peer_start'/);
  assert.match(field.text,/detail==='wa_student'/);
  assert.doesNotMatch(field.text,/(sessionStorage|randomUUID|document\.cookie|contact|phone|email)/i);
});

test('generated Worker serves teacher school and ambassador kits with same-origin print support',async()=>{
  const checks=[
    ['/chemistry/rescue/teachers','Teacher Rescue Kit','wa_teacher'],
    ['/chemistry/rescue/schools','School Rescue Pack','school'],
    ['/chemistry/rescue/ambassadors','Rescue Ambassador Kit','ambassador']
  ];
  for(const [path,needle,source] of checks){
    const {r,text}=await get(path);
    assert.equal(r.status,200,path);
    strict(r);
    assert.match(text,new RegExp(needle),path);
    assert.match(text,new RegExp(`/chemistry/rescue\\?src=${source}`),path);
    assert.match(text,/\/chemistry\/assets\/rescue-print\.css/,path);
  }
  const print=await get('/chemistry/assets/rescue-print.css');
  assert.equal(print.r.status,200);
  assert.match(print.r.headers.get('content-type')||'',/^text\/css/);
  assert.match(print.text,/@media print/);
  const sitemap=await get('/chemistry/sitemap.xml');
  for(const p of ['/chemistry/rescue/teachers','/chemistry/rescue/schools','/chemistry/rescue/ambassadors']) assert.match(sitemap.text,new RegExp(p));
});

test('generated Worker exposes a valid browser-install discovery manifest and local install UI',async()=>{
  const page=await get('/chemistry/rescue?src=direct');
  strict(page.r);
  const manifestResponse=await get('/chemistry/manifest.webmanifest');
  assert.equal(manifestResponse.r.status,200);
  assert.match(manifestResponse.r.headers.get('content-type')||'',/^application\/manifest\+json/);
  const manifest=JSON.parse(manifestResponse.text);
  assert.equal(manifest.name,'MUSITU Chemistry Rescue 2026');
  assert.equal(manifest.short_name,'MUSITU Chemistry');
  assert.equal(manifest.id,'/chemistry/rescue?src=direct');
  assert.equal(manifest.start_url,'/chemistry/app');
  assert.equal(manifest.scope,'/chemistry/');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.prefer_related_applications,false);
  assert.deepEqual(manifest.icons.map(x=>[x.src,x.sizes,x.type]),[
    ['/chemistry/assets/musitu-chemistry-192.png','192x192','image/png'],
    ['/chemistry/assets/musitu-chemistry-512.png','512x512','image/png']
  ]);

  const install=await get('/chemistry/assets/rescue-install.js');
  assert.equal(install.r.status,200);
  assert.match(install.r.headers.get('content-type')||'',/^application\/javascript/);
  assert.match(install.text,/beforeinstallprompt/);
  assert.match(install.text,/install-rescue/);
  assert.match(install.text,/\.prompt\(\)/);
  assert.doesNotMatch(install.text,/(Notification\.requestPermission|pushManager|document\.cookie|localStorage)/);

  for(const [path,size] of [['/chemistry/assets/musitu-chemistry-192.png',192],['/chemistry/assets/musitu-chemistry-512.png',512]]){
    const icon=await getBytes(path);
    assert.equal(icon.r.status,200,path);
    assert.equal(icon.r.headers.get('content-type'),'image/png',path);
    assert.ok(icon.bytes.length>100,path);
    assert.deepEqual(Array.from(icon.bytes.slice(0,8)),[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],path);
    assert.equal(size===192||size===512,true);
  }
});