import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const doc=readFileSync(new URL('../docs/2026-10-11-phase1-commercial-pilot-activation.md',import.meta.url),'utf8');
const proof=readFileSync(new URL('../docs/2026-10-11-existing-paynow-authority-reuse.md',import.meta.url),'utf8');
test('commercial runbook reuses existing account but does not claim MMF product is enabled',()=>{
 assert.doesNotMatch(doc,/Registration is \*\*not done\*\*/);
 assert.match(doc,/mft-phase8-external-authority/);
 assert.match(doc,/mft-paynow-transport-gateway/);
 assert.match(doc,/FMI-only/);
 assert.match(proof,/MMF SKU billing and settlement validation are NOT yet wired live/);
});
