import test from 'node:test';
import assert from 'node:assert/strict';
import * as inspector from '../src/staging/mmf-remote-control-readonly-cli.mjs';
const good=()=>({schema:'mmf-private-synthetic-control-occupancy-v1',state:'EMPTY',tenantCount:0,usageCount:0});
test('remote control read-only probe issues exactly one private localhost GET and accepts genuinely empty state',async()=>{
 assert.equal(typeof inspector.inspectRemoteMmfControl,'function');
 const requests=[];
 const result=await inspector.inspectRemoteMmfControl(async (url,opts)=>{
  requests.push({url,method:opts.method,body:opts.body,authorization:opts.headers?.authorization});
  return {status:200,json:async()=>good()};
 });
 assert.deepEqual(result,{gate:'MMF_PRIVATE_CONTROL_READONLY_EMPTY',safeToSeed:true});
 assert.deepEqual(requests,[{url:'http://127.0.0.1:8796/control/inspect',method:'GET',body:undefined,authorization:undefined}]);
});
test('probe blocks occupied, partial and malformed state, response pollution, and remote 503 without logging payload',async()=>{
 for(const x of [
  {...good(),state:'OCCUPIED',tenantCount:2},
  {...good(),state:'ABSENT',usageCount:1},
  {...good(),state:'PARTIAL'},
  {...good(),internalSecret:'never-print'},
  {...good(),tenantCount:'0'}
 ]) await assert.rejects(()=>inspector.inspectRemoteMmfControl(async()=>({status:200,json:async()=>x})),/MMF_PRIVATE_CONTROL_INSPECTION_DENIED/);
 for(const status of [503,400,500]) await assert.rejects(()=>inspector.inspectRemoteMmfControl(async()=>({status,json:async()=>({secret:'not-shown'})})),/MMF_PRIVATE_CONTROL_INSPECTION_DENIED/);
 await assert.rejects(()=>inspector.inspectRemoteMmfControl(async()=>{throw new Error('credential secret do not print')}),/MMF_PRIVATE_CONTROL_INSPECTION_DENIED/);
});
