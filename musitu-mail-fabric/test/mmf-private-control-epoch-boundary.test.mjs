import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import proxy from '../src/staging/mmf-private-cloud-proof-client.mjs';
const edge=readFileSync(new URL('../src/edge/mmf-commercial-private-cloudflare.mjs',import.meta.url),'utf8');
test('private DO instance epoch is ephemeral and available only via a closed-stage, localhost GET, never through public fetch',async()=>{
 assert.match(edge,/proofRuntimeEpoch\s*=\s*crypto\.randomUUID\(/,'instance epoch must be random per new DO object');
 assert.match(edge,/runtimeSyntheticControlEpoch\(/);assert.match(edge,/runtimeControlEpoch\(/);
 let calls=0;const env={MMF_PROOF_STAGE:{async runtimeControlEpoch(){calls++;return {epoch:'a'.repeat(64)}}}};
 const okay=await proxy.fetch(new Request('http://127.0.0.1/control/epoch'),env);
 assert.equal(okay.status,200);assert.deepEqual(await okay.json(),{epoch:'a'.repeat(64)});
 assert.equal((await proxy.fetch(new Request('http://example.com/control/epoch'),env)).status,503);
 assert.equal((await proxy.fetch(new Request('http://127.0.0.1/control/epoch',{method:'POST'}),env)).status,503);
 assert.equal(calls,1);
});
