import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path){const r=await handleRequest(new Request(base+path),{});return {r,text:await r.text()}}
function strict(r){const csp=r.headers.get('content-security-policy')||'';assert.match(csp,/style-src 'self'/);assert.match(csp,/script-src 'self'/);assert.match(csp,/connect-src 'self'/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|https?:\/\//);assert.equal(r.headers.get('referrer-policy'),'no-referrer')}

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
