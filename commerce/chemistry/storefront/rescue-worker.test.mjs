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
