import test from 'node:test';
import assert from 'node:assert/strict';
import client from '../src/staging/mmf-private-cloud-proof-client.mjs';
test('local-only remote service proxy errors disclose only fixed classifications, no secrets or stack',async()=>{
 const request=new Request('http://127.0.0.1:8796/read',{method:'POST'});
 const env={MMF_PROOF_STAGE:{async read(){throw Error('Unbound entrypoint request failed with bearer secret=private-super-secret')}}};
 const response=await client.fetch(request,env);
 const body=await response.json();
 assert.equal(response.status,503);
 assert.equal(body.error,'PRIVATE_PROOF_DISABLED');
 assert.equal(body.category,'REMOTE_RPC_FAILED');
 assert.deepEqual(Object.keys(body).sort(),['category','error']);
 assert.ok(!JSON.stringify(body).includes('private-super-secret'));
});