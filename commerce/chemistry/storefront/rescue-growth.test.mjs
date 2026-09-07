import test from 'node:test';
import assert from 'node:assert/strict';
import * as rescueGrowth from './rescue-growth.mjs';

test('Rescue source attribution is coarse allowlisted and never reflects raw input',()=>{
  assert.equal(rescueGrowth.normalizeGrowthSource('wa_student'),'wa_student');
  assert.equal(rescueGrowth.normalizeGrowthSource('school'),'school');
  assert.equal(rescueGrowth.normalizeGrowthSource('meta'),'meta');
  for(const raw of ['',null,undefined,'WA_STUDENT','school<script>','creator-extra','x'.repeat(200)]){
    assert.equal(rescueGrowth.normalizeGrowthSource(raw),'direct');
  }
});
