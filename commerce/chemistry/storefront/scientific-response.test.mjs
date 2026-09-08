import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderChemistryApp,APP_SHELL_JS,SCIENTIFIC_RESPONSE_SCHEMA,SCIENTIFIC_RESPONSE_STORAGE_KEY,normalizeAppView} from './app-shell.mjs';
import {handleRequest} from '../index.storefront-v3.mjs';

const base='https://payments.mftintelligence.com';
const graphSchema=JSON.parse(fs.readFileSync(new URL('./scientific-response.schema.json',import.meta.url),'utf8'));
async function get(path){const r=await handleRequest(new Request(base+path),{});return {r,text:await r.text()}}

test('exam exposes the MUSITU chemistry-native Scientific Response OS instead of a keyboard-only answer surface',()=>{
  const html=renderChemistryApp({view:'exam'});
  assert.equal(normalizeAppView('exam'),'exam');
  assert.equal(SCIENTIFIC_RESPONSE_SCHEMA,'musitu.scientific_response_graph.v1');
  assert.equal(SCIENTIFIC_RESPONSE_STORAGE_KEY,'musitu_chem_scientific_response_v1');
  assert.match(html,/data-scientific-response-os/);
  for(const name of ['Scientific Response Graph','Chemistry Ink','Reaction Mechanism','Molecular Structure','Scientific Graph','Lab Apparatus','Particle Model','Scientific Argument','Accessibility Description'])assert.match(html,new RegExp(name));
  assert.match(html,/Certified exam mode/);
  assert.match(html,/aria-current="page"><b>∿<\/b><span>Prove<\/span>/);
  assert.doesNotMatch(html,/class="site-header"|class="site-footer"/);
});

test('certified exam surface provides deep scientific expression affordances without answer assistance',()=>{
  const html=renderChemistryApp({view:'exam'});
  for(const token of ['₁','₂','₃','₄','₅','⁺','⁻','²⁺','²⁻','³⁺','³⁻','→','⇌','(s)','(l)','(g)','(aq)','e⁻','Δ','°','×10','√','λ'])assert.ok(html.includes(token),token);
  for(const concept of ['Electron-pair arrow','Single-electron arrow','Lone pair','Solid wedge','Dashed wedge','R/S centre','Fischer','Haworth','Newman','Orbital','Polymer','Coordination centre','Transition state','Data table','Gradient','Burette','Salt bridge','Crystallize','Collect gas','Cation +','Le Chatelier principle'])assert.ok(html.includes(concept),concept);
  assert.match(html,/data-sr-link-representation/);
  assert.match(html,/Original evidence retained/);
  assert.match(html,/no hints, predictive completion, automatic balancing, answer correction, hidden retrieval or generative assistance/i);
  assert.match(html,/finishing it here does not transmit or submit an exam/i);
});

test('Scientific Response Graph runtime is bounded, multimodal, cross-representational and local-only',()=>{
  assert.match(APP_SHELL_JS,/SR_SCHEMA='musitu\.scientific_response_graph\.v1'/);
  assert.match(APP_SHELL_JS,/MAX_OBJECTS=180/);
  assert.match(APP_SHELL_JS,/MAX_EDGES=240/);
  assert.match(APP_SHELL_JS,/MAX_TRACE=256/);
  assert.match(APP_SHELL_JS,/MAX_INK_STROKES=180/);
  assert.match(APP_SHELL_JS,/MAX_POINTS=220/);
  assert.match(APP_SHELL_JS,/argument:\{claim:'',evidence:'',principle:'',conclusion:''\}/);
  assert.match(APP_SHELL_JS,/objects:\[\],edges:\[\],ink:\[\],provenance:\[\]/);
  assert.match(APP_SHELL_JS,/localStorage\.setItem\(SR_KEY,raw\)/);
  assert.match(APP_SHELL_JS,/raw\.length<=240000/);
  assert.match(APP_SHELL_JS,/response\.edges\.push/);
  assert.match(APP_SHELL_JS,/response\.ink\.push/);
  assert.match(APP_SHELL_JS,/edge\.kind\.includes\('electron'\)/);
  assert.match(APP_SHELL_JS,/same-scientific-concept/);
  assert.match(APP_SHELL_JS,/panelFor=mode=>/);
  assert.match(APP_SHELL_JS,/boardRefs=\(\)=>/);
  assert.match(APP_SHELL_JS,/paintLock=\(\)=>/);
  assert.match(APP_SHELL_JS,/textArea\.readOnly=locked/);
  assert.match(APP_SHELL_JS,/navigator\.clipboard\.writeText/);
  assert.doesNotMatch(APP_SHELL_JS,/(getUserMedia|geolocation|Notification\.requestPermission|sendBeacon|document\.cookie)/);
  assert.doesNotMatch(APP_SHELL_JS,/(openai|anthropic|gemini|automaticBalance|autoBalance|predictAnswer|completeAnswer|correctAnswer)/i);
});

test('machine-readable SRG v1 schema agrees with runtime safety bounds and representation contract',()=>{
  assert.equal(graphSchema.$schema,'https://json-schema.org/draft/2020-12/schema');
  assert.equal(graphSchema.properties.schema.const,'musitu.scientific_response_graph.v1');
  assert.equal(graphSchema.properties.version.const,1);
  assert.equal(graphSchema.properties.examMode.const,'certified');
  assert.deepEqual(graphSchema.required,['schema','version','examMode','activeMode','text','argument','accessibilityDescription','objects','edges','ink','provenance','finalized']);
  assert.equal(graphSchema.properties.objects.maxItems,180);
  assert.equal(graphSchema.properties.edges.maxItems,240);
  assert.equal(graphSchema.properties.ink.maxItems,180);
  assert.equal(graphSchema.properties.provenance.maxItems,256);
  assert.equal(graphSchema.$defs.inkStroke.properties.points.maxItems,220);
  assert.equal(graphSchema.properties.text.maxLength,12000);
  assert.equal(graphSchema.properties.accessibilityDescription.maxLength,6000);
  assert.equal(graphSchema.properties.argument.properties.claim.maxLength,4000);
  assert.ok(graphSchema.properties.activeMode.enum.includes('argument'));
  assert.ok(graphSchema.$defs.scientificEdge.properties.mode.enum.includes('cross'));
  assert.equal(graphSchema.additionalProperties,false);
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
