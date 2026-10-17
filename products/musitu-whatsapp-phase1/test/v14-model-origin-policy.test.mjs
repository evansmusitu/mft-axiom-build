import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvidenceBoundModelGateway} from '../src/ai/provider-gateway.mjs';
const base={qualified:true,url:'https://models.example.invalid/v1/chat/completions',model:'qualification-model',token:'test-only'};
test('gateway rejects an endpoint not explicitly pinned by an operator allowlist',()=>{
 assert.throws(()=>createEvidenceBoundModelGateway(base),/MODEL_ORIGIN_NOT_ALLOWED/);
 assert.throws(()=>createEvidenceBoundModelGateway({...base,allowedOrigins:['https://elsewhere.example.invalid']}),/MODEL_ORIGIN_NOT_ALLOWED/);
});
test('gateway refuses insecure or malicious allowlist records',()=>{
 for(const allowedOrigins of [[],['http://models.example.invalid'],['https://models.example.invalid/evil'],['*'],['https://models.example.invalid','https://example.invalid']]){
  assert.throws(()=>createEvidenceBoundModelGateway({...base,allowedOrigins}),/MODEL_ORIGIN_NOT_ALLOWED/);
 }
});
test('gateway permits exactly pinned HTTPS origin without granting sends or tool actions',()=>{
 const gateway=createEvidenceBoundModelGateway({...base,allowedOrigins:['https://models.example.invalid']});
 assert.equal(gateway.enabled,true);
 assert.equal(typeof gateway.select,'function');
 assert.equal(gateway.sendWhatsApp,undefined);
});
