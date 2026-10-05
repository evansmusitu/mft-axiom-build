import assert from 'node:assert/strict';
import test from 'node:test';
import {importSupportDataKey, encryptSupportPayload, decryptSupportPayload} from '../crypto_envelope.js';

const base64 = bytes => Buffer.from(bytes).toString('base64');

test('support narrative is AES-256-GCM encrypted and case-bound', async () => {
  const key = await importSupportDataKey(base64(crypto.getRandomValues(new Uint8Array(32))));
  const payload = {description: 'private customer narrative', evidence_refs: []};
  const envelope = await encryptSupportPayload(payload, {key, caseId: 'AX-0123456789AB'});
  assert.equal(envelope.algorithm, 'A256GCM');
  assert.doesNotMatch(envelope.ciphertext, /private customer narrative/);
  assert.deepEqual(await decryptSupportPayload(envelope, {key, caseId: 'AX-0123456789AB'}), payload);
  await assert.rejects(() => decryptSupportPayload(envelope, {key, caseId: 'AX-OTHERCASE000'}), /authentication failed/);
});

test('key import rejects anything except 256-bit material', async () => {
  await assert.rejects(() => importSupportDataKey(base64(new Uint8Array(16))), /exactly 32 bytes/);
});
