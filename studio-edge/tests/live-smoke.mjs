import assert from 'node:assert/strict';

const base = process.env.TARGET_WORKER;
assert.ok(base?.startsWith('https://'), 'Expected a trusted HTTPS Worker target');
const SITE = 'https://evansmusitu.github.io';

async function read(path, options = {}) {
  return fetch(base + path, { ...options, signal: AbortSignal.timeout(80000) });
}
const health = await read('/api/health', { headers: { origin: SITE } });
assert.equal(health.status, 200);
const info = await health.json();
assert.equal(info.service, 'MUSITU Intelligence Edge');
assert.equal(info.rateLimit.visitorPerMinute, 5);
assert.equal(info.rateLimit.regionPerMinute, 12);
assert.match(info.rateLimit.scope, /location/);

const denied = await read('/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
  body: JSON.stringify({ mode: 'learn', prompt: 'Explain a control system in practical terms.' })
});
assert.equal(denied.status, 403);
assert.equal((await denied.json()).code, 'ORIGIN_DENIED');

const invalid = await read('/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: SITE },
  body: JSON.stringify({ mode: 'learn', prompt: 'short' })
});
assert.equal(invalid.status, 400);

const preflight = await read('/api/chat', {
  method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }
});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), SITE);

const generated = await read('/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: SITE },
  body: JSON.stringify({ mode: 'learn', prompt: 'Explain closed-loop feedback control with a sensor and one practical example for beginners.' })
});
const raw = await generated.text();
let data;
try { data = JSON.parse(raw); } catch { throw Error('Inference returned non-JSON content'); }
if (generated.status !== 200) throw Error('Live inference HTTP ' + generated.status + ': ' + JSON.stringify(data).slice(0, 250));
assert.equal(data.mode, 'learn');
assert.equal(data.liveSearch, false);
assert.equal(typeof data.reply, 'string');
assert.ok(data.reply.length > 75, 'Real model response must be substantive');
assert.match(data.reply.toLowerCase(), /sensor|feedback|loop|output|control/);
console.log('LIVE INFERENCE PASS', base, 'reply chars', data.reply.length);
assert.equal(info.tools[0].path,'/api/calculate');
assert.equal(info.availableModels.deeperAnalysis,'@cf/qwen/qwen3-30b-a3b-fp8');
const calculated = await read('/api/calculate',{
  method:'POST',headers:{'content-type':'application/json',origin:SITE},
  body:JSON.stringify({expression:'(8+4)*sqrt(9)'})
});
assert.equal(calculated.status,200,'Deterministic tool must return HTTP 200');
const calc=await calculated.json();
assert.equal(calc.result,36);
assert.equal(calc.tool,'calculator');
assert.equal(calc.exact,false);
const invalidTool=await read('/api/calculate',{
  method:'POST',headers:{'content-type':'application/json',origin:SITE},
  body:JSON.stringify({expression:'8/0'})
});
assert.equal(invalidTool.status,400,'Division by zero must fail safely');
const deep=await read('/api/chat',{
  method:'POST',headers:{'content-type':'application/json',origin:SITE},
  body:JSON.stringify({mode:'deep',prompt:'Give a brief plan to build reliable offline-first software, including two tests and one tradeoff.'})
});
const deepBody=await deep.text();
let deepData;
try{deepData=JSON.parse(deepBody);}catch{throw Error('Deep model returned non-JSON response');}
if(deep.status!==200)throw Error('Deep model unavailable HTTP '+deep.status+': '+JSON.stringify(deepData).slice(0,250));
assert.equal(deepData.model,'@cf/qwen/qwen3-30b-a3b-fp8');
assert.ok(deepData.reply.length>=40,'Deep model must return a meaningful final answer');
assert.doesNotMatch(deepData.reply,/<think>/i);
console.log('TWO-MODEL + DETERMINISTIC CALCULATOR LIVE PASS',base,'deepChars',deepData.reply.length);

const calc = await read('/api/calculate', {
  method:'POST',headers:{origin:SITE,'content-type':'application/json'},
  body:JSON.stringify({expression:'sqrt(144)+abs(-7)'})
});
assert.equal(calc.status,200,'Calculator endpoint must answer without AI inference');
const calculated=await calc.json();
assert.equal(calculated.tool,'calculator');
assert.equal(calculated.result,19);
assert.equal(calculated.verifiedBy,'deterministic parser v1');
assert.equal(calculated.exact,false);
console.log('LIVE DETERMINISTIC CALCULATION PASS, result:',calculated.result);

const injected = await read('/api/calculate', {
  method:'POST',headers:{origin:SITE,'content-type':'application/json'},
  body:JSON.stringify({expression:'process.exit()'})
});
assert.equal(injected.status,400,'Executable input must be refused');
const rejected=await injected.json();
assert.equal(rejected.code,'CALCULATION_INVALID');

const deep = await read('/api/chat', {
  method:'POST',headers:{origin:SITE,'content-type':'application/json'},
  body:JSON.stringify({mode:'deep',prompt:'Explain the main risks in launching an AI assistant with no authentication, and identify two practical mitigations.'})
});
const deepText=await deep.text();
let reason;
try {reason=JSON.parse(deepText);} catch {throw Error('Reasoning model returned invalid JSON');}
if(deep.status!==200)throw Error('Deep reasoning model failed HTTP '+deep.status+': '+JSON.stringify(reason).slice(0,400));
assert.equal(reason.model,'@cf/qwen/qwen3-30b-a3b-fp8');
assert.equal(reason.mode,'deep');
assert.ok(typeof reason.reply==='string' && reason.reply.length>65,'Deep model should return a substantive final answer');
assert.equal(reason.reply.includes('<think>'),false,'Internal thinking tags must not be exposed');
console.log('LIVE QWEN DEEP ANALYSIS PASS, reply chars:',reason.reply.length);
