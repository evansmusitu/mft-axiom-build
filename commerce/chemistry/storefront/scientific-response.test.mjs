import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workerPath=new URL('../index.storefront-v3.mjs',import.meta.url);

function diagnosticContexts(source){
  const out=[];
  const rx=/.{0,180}(?:textarea|contenteditable|exam|question|answer).{0,320}/gis;
  for(const match of source.matchAll(rx)){
    out.push(match[0].replace(/\s+/g,' ').slice(0,560));
    if(out.length>=18) break;
  }
  return out;
}

test('exam exposes the MUSITU chemistry-native Scientific Response OS instead of a keyboard-only answer surface',()=>{
  const source=fs.readFileSync(workerPath,'utf8');
  if(!source.includes('data-scientific-response-os')){
    console.error('MUSITU_SCIENTIFIC_RESPONSE_DISCOVERY='+JSON.stringify(diagnosticContexts(source)));
  }
  assert.match(source,/data-scientific-response-os/);
  assert.match(source,/Scientific Response Graph/);
  assert.match(source,/Chemistry Ink/);
  assert.match(source,/Reaction Mechanism/);
  assert.match(source,/Molecular Structure/);
  assert.match(source,/Scientific Graph/);
  assert.match(source,/Lab Apparatus/);
  assert.match(source,/Particle Model/);
  assert.match(source,/Accessibility Description/);
  assert.match(source,/Certified exam mode/);
});
