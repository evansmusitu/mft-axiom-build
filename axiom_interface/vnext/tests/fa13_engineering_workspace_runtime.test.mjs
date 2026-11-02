import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EngineeringWorkspaceRuntime,
  createLineDiff,
  diagnoseWorkspace,
  evaluateTestContract,
  searchWorkspace,
} from '../engineering_workspace_runtime.js';

const authority={
  project_id:'project-fa13',actor_id:'agent-builder',agent_id:'agent-builder',
  workload_identity_id:'workload-builder',agent_status:'ACTIVE',kill_switch_engaged:false,
  revoked:false,requester_type:'AGENT',grant:{tool_scopes:['project.read','artifact.write'],
  data_scopes:['project:project-fa13'],network_policy:'DENY_ALL_EXTERNAL_NETWORK',
  secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',budget:{max_compute_units:100}},
  usage:{compute_units:0},incident_posture:'NORMAL',jurisdiction:'LOCAL_BROWSER',
};

test('workspace produces deterministic line diffs and search results',()=>{
  const diff=createLineDiff('const answer = 41;\n','const answer = 42;\n','src/index.js');
  assert.match(diff,/--- a\/src\/index\.js/);
  assert.match(diff,/-const answer = 41;/);
  assert.match(diff,/\+const answer = 42;/);
  const hits=searchWorkspace({'src/index.js':'alpha\nbeta alpha\n'},'alpha');
  assert.deepEqual(hits.map(hit=>[hit.path,hit.line]),[['src/index.js',1],['src/index.js',2]]);
});

test('workspace diagnostics catch malformed JSON and unbalanced source',()=>{
  const diagnostics=diagnoseWorkspace({'package.json':'{"name":','src/index.js':'function x(){\n'});
  assert.ok(diagnostics.some(row=>row.path==='package.json'&&row.severity==='error'));
  assert.ok(diagnostics.some(row=>row.path==='src/index.js'&&row.code==='UNBALANCED_DELIMITER'));
});

test('test contracts exercise real workspace content and fail closed',()=>{
  const files={'README.md':'MUSITU Axiom\n','src/index.js':'export const answer=42;\n'};
  const pass=evaluateTestContract(files,{checks:[
    {kind:'file_exists',path:'README.md'},
    {kind:'contains',path:'src/index.js',value:'answer=42'},
    {kind:'not_contains',path:'src/index.js',value:'eval('},
  ]});
  assert.equal(pass.status,'PASS');
  const fail=evaluateTestContract(files,{checks:[{kind:'contains',path:'README.md',value:'missing'}]});
  assert.equal(fail.status,'FAIL');
});

test('governed workspace supports edit save diff worktree checkpoint and revert',async()=>{
  const workspace=await EngineeringWorkspaceRuntime.create({
    projectId:'project-fa13',authority,
    files:{'README.md':'v1\n','src/index.js':'export const value=1;\n'},
  });
  await workspace.editFile('src/index.js','export const value=2;\n');
  assert.match(workspace.diff('src/index.js'),/\+export const value=2;/);
  const saved=await workspace.saveFile('src/index.js');
  assert.equal(saved.status,'COMPLETED');
  const checkpoint=await workspace.createCheckpoint('known-good');
  await workspace.editFile('src/index.js','export const value=3;\n');
  await workspace.saveFile('src/index.js');
  await workspace.restoreCheckpoint(checkpoint.checkpoint_id);
  assert.equal(workspace.readFile('src/index.js'),'export const value=2;\n');
  await workspace.createWorktree('repair');
  assert.equal(workspace.activeWorktreeId,'repair');
  assert.equal(workspace.readFile('src/index.js'),'export const value=2;\n');
});

test('retrieved instructions cannot authorize workspace mutation',async()=>{
  const workspace=await EngineeringWorkspaceRuntime.create({projectId:'project-fa13',authority,files:{'README.md':'safe\n'}});
  await assert.rejects(
    ()=>workspace.editFile('README.md','unsafe\n',{instructionProvenance:'RETRIEVED_DATA'}),
    /retrieved data cannot authorize side effects/i,
  );
});

test('bounded terminal and build/test receipts reflect workspace truth',async()=>{
  const workspace=await EngineeringWorkspaceRuntime.create({
    projectId:'project-fa13',authority,
    files:{
      'README.md':'MUSITU Axiom\n',
      'src/index.js':'export const value=42;\n',
      'axiom.tests.json':JSON.stringify({checks:[{kind:'contains',path:'src/index.js',value:'value=42'}]}),
    },
  });
  assert.deepEqual((await workspace.runTerminal('ls')).entries,['README.md','axiom.tests.json','src/index.js']);
  assert.equal((await workspace.runBuild()).status,'PASS');
  assert.equal((await workspace.runTests()).status,'PASS');
  const preview=await workspace.preview();
  assert.equal(preview.sandbox,'allow-scripts');
  assert.match(preview.source_sha256,/^[0-9a-f]{64}$/);
  await assert.rejects(()=>workspace.runTerminal('rm -rf .'),/outside bounded read vocabulary/i);
});
