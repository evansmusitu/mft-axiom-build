import test from 'node:test';
import assert from 'node:assert/strict';
import {renderChemistryApp,APP_SHELL_JS,SCIENTIFIC_RESPONSE_SCHEMA,SCIENTIFIC_RESPONSE_STORAGE_KEY,normalizeAppView} from './app-shell.mjs';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
async function get(path){const r=await handleRequest(new Request(base+path),{});return {r,text:await r.text()}}

test('exam exposes the MUSITU chemistry-native Scientific Response OS instead of a keyboard-only answer surface',()=>{
  const html=renderChemistryApp({view:'exam'});
  assert.equal(normalizeAppView('exam'),'exam');
  assert.equal(SCIENTIFIC_RESPONSE_SCHEMA,'musitu.scientific_response_graph.v1');
  assert.equal(SCIENTIFIC_RESPONSE_STORAGE_KEY,'musitu_chem_scientific_response_v1');
  assert.match(html,/data-scientific-response-os/);
  assert.match(html,/Scientific Response Graph/);
  assert.match(html,/Chemistry Ink/);
  assert.match(html,/Reaction Mechanism/);
  assert.match(html,/Molecular Structure/);
  assert.match(html,/Scientific Graph/);
  assert.match(html,/Lab Apparatus/);
  assert.match(html,/Particle Model/);
  assert.match(html,/Accessibility Description/);
  assert.match(html,/Certified exam mode/);
  assert.match(html,/aria-current="page"><b>∿<\/b><span>Prove<\/span>/);
  assert.doesNotMatch(html,/class="site-header"|class="site-footer"/);
});

test('certified exam surface provides expression affordances without answer assistance',()=>{
  const html=renderChemistryApp({view:'exam'});
  for(const token of ['₂','₃','₄','⁺','⁻','²⁺','²⁻','³⁺','→','⇌','(s)','(l)','(g)','(aq)','Δ','°','×10','√'])assert.ok(html.includes(token),token);
  assert.match(html,/Electron-pair arrow/);
  assert.match(html,/Single-electron arrow/);
  assert.match(html,/Lone pair/);
  assert.match(html,/Burette/);
  assert.match(html,/Salt bridge/);
  assert.match(html,/Cation \+/);
  assert.match(html,/Original evidence retained/);
  assert.match(html,/no hints, predictive completion, automatic balancing, answer correction, hidden retrieval or generative assistance/i);
  assert.match(html,/finishing it here does not transmit or submit an exam/i);
});

test('Scientific Response Graph is bounded, structured, local and has no scientific-answer network authority',()=>{
  assert.match(APP_SHELL_JS,/SR_SCHEMA='musitu\.scientific_response_graph\.v1'/);
  assert.match(APP_SHELL_JS,/MAX_OBJECTS=180/);
  assert.match(APP_SHELL_JS,/MAX_EDGES=240/);
  assert.match(APP_SHELL_JS,/MAX_TRACE=256/);
  assert.match(APP_SHELL_JS,/MAX_INK_STROKES=180/);
  assert.match(APP_SHELL_JS,/objects:\[\],edges:\[\],ink:\[\],provenance:\[\]/);
  assert.match(APP_SHELL_JS,/localStorage\.setItem\(SR_KEY,raw\)/);
  assert.match(APP_SHELL_JS,/response\.edges\.push/);
  assert.match(APP_SHELL_JS,/response\.ink\.push/);
  assert.match(APP_SHELL_JS,/edge\.kind\.includes\('electron'\)/);
  assert.match(APP_SHELL_JS,/navigator\.clipboard\.writeText/);
  assert.doesNotMatch(APP_SHELL_JS,/(getUserMedia|geolocation|Notification\.requestPermission|sendBeacon|document\.cookie)/);
  assert.doesNotMatch(APP_SHELL_JS,/(openai|anthropic|gemini|automaticBalance|autoBalance|predictAnswer|completeAnswer|correctAnswer)/i);
});

test('generated Worker serves Prove inside the no-store installed app surface',async()=>{
  const exam=await get('/chemistry/app?view=exam');
  assert.equal(exam.r.status,200);
  assert.equal(exam.r.headers.get('cache-control'),'no-store');
  assert.match(exam.text,/data-scientific-response-os/);
  assert.match(exam.text,/Answer Chemistry as Chemistry/);
  assert.match(exam.text,/musitu\.scientific_response_graph\.v1/);
  assert.match(exam.text,/app-shell\.css\?v=4/);
  assert.match(exam.text,/app-shell\.js\?v=4/);
  assert.doesNotMatch(exam.text,/class="site-header"|class="site-footer"/);
});
