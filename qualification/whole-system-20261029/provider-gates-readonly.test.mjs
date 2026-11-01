import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifySavedCancellation} from './provider-gates-readonly-20261101.mjs';
test('only an exact saved request identity and provider abort record can confirm cancellation',()=>{
  const ray='a53c044b0eda9b36';
  assert.equal(classifySavedCancellation([{requestId:ray,errorCode:3008,totalNeurons:4}]).status,'PROVIDER_ABORT_RECORD_CONFIRMED');
  assert.equal(classifySavedCancellation([{requestId:'different',errorCode:3008}]).status,'UNRESOLVED');
  assert.equal(classifySavedCancellation([{requestId:ray,errorCode:0}]).status,'PROVIDER_TERMINAL_ABORT_NOT_CONFIRMED');
  assert.equal(classifySavedCancellation([{requestId:ray,errorCode:3008},{requestId:ray,errorCode:3008}]).status,'UNRESOLVED');
});
test('missing request usage is unknown and cannot be converted to zero',()=>{
  assert.equal(classifySavedCancellation([]).final_usage,null);
  assert.equal(classifySavedCancellation([{requestId:'a53c044b0eda9b36',errorCode:3008}]).final_usage,null);
  assert.equal(classifySavedCancellation([{requestId:'a53c044b0eda9b36',errorCode:3008,totalNeurons:0}]).final_usage,0);
});
