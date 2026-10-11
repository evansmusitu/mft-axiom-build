import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflows=[
  {
    "filename": "musitu-store-phase1-production-deploy.yml",
    "job": "deploy"
  },
  {
    "filename": "musitu-store-phase1-runtime-state-production-update.yml",
    "job": "update"
  },
  {
    "filename": "musitu-store-phase1-v101-production-deploy.yml",
    "job": "deploy"
  }
];
for(const {filename,job} of workflows){
  test(filename+' is archived and incapable of triggering production',()=>{
    const file=readFileSync('.github/workflows/'+filename,'utf8');
    assert.match(file,/^on:\n  workflow_dispatch:\s*$/m,'manual inspection entrypoint required');
    assert.doesNotMatch(file,/^  push:\s*$/m,'no production promotion from source push');
    const begin=file.indexOf('\njobs:\n');
    assert.ok(begin>0,'must retain original job definition');
    const exact='  '+job+':\n    if: $'+'{{ false }}';
    assert.ok(file.slice(begin).includes(exact),'archived production job must be disabled until separately re-authorized');
  });
}
