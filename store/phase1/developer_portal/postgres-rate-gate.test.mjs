import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresRatePermit} from './postgres-rate-gate.mjs';
const base={issuer:'https://idp.example.org',subject:'dev-account-0001',role:'developer',
 publisherId:'partner-apps',route:'upload',tokenId:'session-token-0000001',audience:'store-v2-internal',
 expiresAt:1792670600};
test('PostgreSQL permit uses exact private session arguments and parameterized stable identity digests',async()=>{
 const statements=[];
 const gate=createPostgresRatePermit({query:async (sql,params)=>{statements.push({sql,params});return {rowCount:1,rows:[{permitted:true}]};}});
 assert.equal(await gate(base),true);
 assert.equal(await gate({...base,tokenId:'rotated-token-0000002'}),true);
 assert.equal(statements.length,2);
 for(const {sql,params} of statements){
  assert.match(sql,/claim_portal_rate_permit\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10\)/);
  assert.deepEqual(params.slice(1,8),[base.issuer,base.subject,base.role,base.publisherId,
    base.audience,base.expiresAt,base.route]);
  assert.match(params[8],/^[a-f0-9]{64}$/);assert.match(params[9],/^[a-f0-9]{64}$/);
 }
 assert.equal(statements[0].params[8],statements[1].params[8],'token refresh cannot bypass actor quota');
 assert.equal(statements[0].params[9],statements[1].params[9],'token refresh cannot bypass publisher quota');
 assert.equal(statements[0].params[0],base.tokenId);
 assert.equal(statements[1].params[0],'rotated-token-0000002');
});
test('reviewers carry no publisher hash and cannot pretend to own developer tenant',async()=>{
 let params;
 const gate=createPostgresRatePermit({query:async(_s,p)=>{params=p;return {rowCount:1,rows:[{permitted:true}]};}});
 await gate({...base,role:'review_security',publisherId:undefined,route:'review'});
 assert.equal(params[4],null);assert.equal(params[9],null);
 await assert.rejects(gate({...base,role:'review_security',route:'review'}),/identity/);
});
test('database false permit is denial, outage or malformed result fail closed',async()=>{
 const exhausted=createPostgresRatePermit({query:async()=>({rowCount:1,rows:[{permitted:false}]})});
 assert.equal(await exhausted(base),false);
 for(const invalid of [null,{rowCount:0,rows:[]},{rowCount:1,rows:[{permitted:'true'}]}]){
  const g=createPostgresRatePermit({query:async()=>invalid});await assert.rejects(g(base),/database rate permit/);
 }
 const outage=createPostgresRatePermit({query:async()=>{throw Error('PostgreSQL unavailable');}});
 await assert.rejects(outage(base),/PostgreSQL unavailable/);
});
test('reject malformed identity and route before reaching database',async()=>{
 let calls=0;const gate=createPostgresRatePermit({query:async()=>{calls++;return {rowCount:1,rows:[{permitted:true}]};}});
 for(const change of [{issuer:'http://evil.test'},{subject:'a'},{role:'admin'},
  {route:'release'},{tokenId:'bad'},{expiresAt:NaN},{publisherId:'other//tenant'},
  {audience:''},{role:'review_identity',publisherId:'partner-apps'}])
  await assert.rejects(gate({...base,...change}),/identity/);
 assert.equal(calls,0);
});
