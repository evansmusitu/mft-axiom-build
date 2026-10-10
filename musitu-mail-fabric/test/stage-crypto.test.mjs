import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {stageCryptoSelfTest} from '../src/edge/stage-crypto.mjs';

function credentials() {
  const {privateKey}=generateKeyPairSync('ed25519');
  return {privatePem:privateKey.export({type:'pkcs8',format:'pem'}).toString(),
    dataKey:randomBytes(32).toString('base64')};
}
test('isolated staging can encrypt synthetic probe and sign its digest',()=>{
  const key=credentials();
  const proof=stageCryptoSelfTest(key.privatePem,key.dataKey,'probe-cryptographic-test-abcdef');
  assert.equal(proof.verified,true);
  assert.match(proof.publicKeySha256,/^[a-f0-9]{64}$/);
  assert.equal(proof.customerContentHandled,false);
  assert.equal(JSON.stringify(proof).includes(key.privatePem),false);
  assert.equal(JSON.stringify(proof).includes(key.dataKey),false);
});
test('stage crypto rejects missing malformed credentials and non-probe values',()=>{
  const key=credentials();
  assert.throws(()=>stageCryptoSelfTest('',key.dataKey,'probe-cryptographic-test-abcdef'));
  assert.throws(()=>stageCryptoSelfTest(key.privatePem,'invalid','probe-cryptographic-test-abcdef'));
  assert.throws(()=>stageCryptoSelfTest(key.privatePem,key.dataKey,'customer:email@example.com'));
});
