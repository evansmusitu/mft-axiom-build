import test from 'node:test';
import assert from 'node:assert/strict';
import {localOnly} from '../src/host_policy.mjs';

test('S0 test route accepts only literal loopback origins',()=>{
 assert.equal(localOnly('http://127.0.0.1:18768/_internal_s0_admit'),true);
 assert.equal(localOnly('http://localhost/_internal_s0_admit'),true);
 assert.equal(localOnly('https://axiom.mftintelligence.com/_internal_s0_admit'),false);
 assert.equal(localOnly('http://localhost.example.com/_internal_s0_admit'),false);
 assert.equal(localOnly('https://localhost/_internal_s0_admit'),false);
 assert.equal(localOnly('not-a-url'),false);
});
