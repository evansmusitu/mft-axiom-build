import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSqliteDOQualification, UnsafeQualificationMode } from './qualification_mode.mjs';

const options={
  runtime:'local_workerd',
  storage:'sqlite_durable_object',
  isolated:true,
  publicRoutes:0,
  workerDev:false,
  customerData:false,
  cashBudgetUsd:'0.00',
};

test('accepts nonpublic local workerd isolated native SQLite DO',()=>{
  const r=selectSqliteDOQualification(options);
  assert.equal(r.mode,'LOCAL_WORKERD_ONLY');
  assert.equal(r.remoteNativeQuotaProven,false);
  assert.equal(r.customerReleaseAuthorized,false);
  assert.equal(r.billableActionsAuthorized,false);
});
test('rejects legacy Wrangler remote-dev for SQLite DO even if isolated',()=>{
  assert.throws(()=>selectSqliteDOQualification({...options,runtime:'wrangler_dev_remote'}),UnsafeQualificationMode);
});
test('rejects remote preview and stage until independent gate',()=>{
  for (const runtime of ['wrangler_preview','isolated_deployed_stage','production','remote_binding']) {
    assert.throws(()=>selectSqliteDOQualification({...options,runtime}),UnsafeQualificationMode);
  }
});
test('rejects hidden public or provider cost paths',()=>{
  for (const change of [{publicRoutes:1},{workerDev:true},{customerData:true},{cashBudgetUsd:'0.01'},{cashBudgetUsd:'-1'},{isolated:false},{storage:'d1'},{unexpected:true}]) {
    assert.throws(()=>selectSqliteDOQualification({...options,...change}),UnsafeQualificationMode);
  }
});
test('rejects implicit or malformed inputs',()=>{
  for(const o of [null,{},[],{...options,publicRoutes:'0'},{...options,cashBudgetUsd:0}])
    assert.throws(()=>selectSqliteDOQualification(o),UnsafeQualificationMode);
});
