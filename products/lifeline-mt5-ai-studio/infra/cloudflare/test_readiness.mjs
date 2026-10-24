import test from 'node:test';
import assert from 'node:assert/strict';
import {backendBindingReadiness} from './backend_readiness.mjs';
const keys=['MODAL_ORIGIN','MODAL_PROXY_KEY','MODAL_PROXY_SECRET','EDGE_SHARED_SECRET','AGENT_ID','AGENT_TENANT','AGENT_HMAC_KEY'];

test('seven absent private bindings are identified without enabling a backend',()=>{
  const state=backendBindingReadiness({ACCESS_OPERATOR_SUB:'owner-only'});
  assert.equal(state.schema,'lifeline.owner_backend_bindings.v1');
  assert.deepEqual(state.missing_bindings,keys);
  assert.equal(state.configured_bindings,0);
  assert.equal(state.backend_connected,false);
  assert.equal(state.native_windows_connected,false);
  assert.equal(state.trading_enabled,false);
});
test('partial credentials report only names, never the secret payload',()=>{
  const sensitive='sensitive-value-should-never-appear-in-diagnostics';
  const state=backendBindingReadiness({MODAL_ORIGIN:'https://test.modal.run/',MODAL_PROXY_KEY:sensitive,EDGE_SHARED_SECRET:sensitive});
  assert.equal(state.configured_bindings,3);
  assert.deepEqual(state.missing_bindings,['MODAL_PROXY_SECRET','AGENT_ID','AGENT_TENANT','AGENT_HMAC_KEY']);
  assert.equal(JSON.stringify(state).includes(sensitive),false);
});
test('all declared bindings are NOT proof of live provider connectivity',()=>{
  const state=backendBindingReadiness(Object.fromEntries(keys.map(k=>[k,'configured-secret-value'])));
  assert.equal(state.configured_bindings,7);
  assert.deepEqual(state.missing_bindings,[]);
  assert.equal(state.backend_connected,false);
  assert.equal(state.production_credentials_verified,false);
  assert.equal(state.native_windows_connected,false);
});
test('non-string, blank, and whitespace-only bindings are missing',()=>{
  const state=backendBindingReadiness({MODAL_ORIGIN:'   ',MODAL_PROXY_KEY:42,MODAL_PROXY_SECRET:'',EDGE_SHARED_SECRET:null,AGENT_ID:'agent-A'});
  assert.equal(state.configured_bindings,1);
  assert.equal(state.missing_bindings.includes('MODAL_PROXY_KEY'),true);
  assert.equal(state.missing_bindings.includes('MODAL_ORIGIN'),true);
});
