import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {handleNeonSyntheticHttpCanary as handle} from '../../connect/customer_neon_http_canary.mjs';

const TOKEN = 'mct_' + 'H'.repeat(43);
const UUID = '12345678-1234-4234-8234-123456789abc';
const digest = createHash('sha256').update(TOKEN).digest('hex');
const URL = 'https://isolated.example.invalid/__synthetic/neon/mining.plan';
const ROW = {accepted:true,code:'ADMITTED',authorized_tenant:'tenant_canary',daily_used:'1'};
const headers = {'authorization': 'Bearer ' + TOKEN, 'x-musitu-request-id':UUID};
function setup(row=ROW){
  const queries=[];
  const env={CONNECT_NEON_MODE:'isolated-synthetic-only',CONNECT_NEON_HTTP_ENABLED:true,CONNECT_NEON_HTTP_ORIGIN:'https://isolated.example.invalid',
    CONNECT_NEON_DB:{async query(q){queries.push(q); return {rows:[row]}}}};
  return {env,queries};
}
const request=(url=URL,opts={})=>new Request(url,{method:'POST',headers,...opts});
async function body(response){assert.equal(response.headers.get('cache-control'),'no-store');return response.json()}

test('disabled by default: no HTTP route and no database access',async()=>{
  const {env,queries}=setup();
  assert.equal((await handle(request(), {...env,CONNECT_NEON_HTTP_ENABLED:false})).status,404);
  assert.equal((await handle(request(), {...env,CONNECT_NEON_HTTP_ENABLED:'true'})).status,404);
  assert.equal((await handle(request(), {...env,CONNECT_NEON_MODE:'disabled'})).status,404);
  assert.deepEqual(queries,[]);
});

test('valid bearer and UUID v4 admit via scoped parameterized SQL without exposure',async()=>{
  const {env,queries}=setup();
  const response=await handle(request(),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const payload=await body(response);
  assert.deepEqual(payload,{ok:true,request_id:UUID,scope:'mining.plan'});
  assert.doesNotMatch(JSON.stringify(payload),/mct_|Bearer|tenant_canary|token_sha256/i);
  assert.equal(queries.length,1);
  assert.match(queries[0].text,/connect_qualification\.admit\(\$1::text,\$2::text,\$3::uuid\)/);
  assert.deepEqual(queries[0].values,[digest,'mining.plan',UUID]);
});

test('route method, request body, query, origin, missing ID are rejected before DB',async()=>{
  const {env,queries}=setup();
  for(const url of [
    'https://isolated.example.invalid/__synthetic/neon/mining.any',
    'https://isolated.example.invalid/__synthetic/neon/mining.plan/',
    'https://isolated.example.invalid/__synthetic/neon/mining.plan?foo=1',
    'https://evil.example.invalid/__synthetic/neon/mining.plan',
  ]) assert.equal((await handle(request(url),env)).status,404);
  assert.equal((await handle(new Request(URL,{method:'GET',headers}),env)).status,405);
  assert.equal((await handle(request(URL,{body:'{"scope":"mining.risk"}'}),env)).status,400);
  assert.equal((await handle(request(URL,{headers:{authorization:headers.authorization}}),env)).status,400);
  assert.equal((await handle(request(URL,{headers:{...headers,'x-musitu-request-id':'not-uuid'}}),env)).status,400);
  assert.equal((await handle(request(URL,{headers:{...headers,'x-musitu-request-id':'12345678-1234-1234-8234-123456789abc'}}),env)).status,400);
  assert.deepEqual(queries,[]);
});

test('denied scope, invalid bearer, quota and replay expose only stable codes',async()=>{
  const {env,queries}=setup();
  assert.equal((await handle(request(URL,{headers:{...headers,authorization:'Bearer wrong'}}),env)).status,401);
  assert.equal(queries.length,0);
  const cases=[
    [{accepted:false,code:'UNAUTHORIZED',authorized_tenant:null},401,'UNAUTHORIZED'],
    [{accepted:false,code:'CUSTOMER_QUOTA_EXCEEDED',authorized_tenant:'tenant_canary'},429,'CUSTOMER_QUOTA_EXCEEDED'],
    [{accepted:false,code:'CUSTOMER_MINUTE_QUOTA_EXCEEDED',authorized_tenant:'tenant_canary'},429,'CUSTOMER_MINUTE_QUOTA_EXCEEDED'],
    [{accepted:false,code:'REQUEST_ID_CONFLICT',authorized_tenant:'tenant_canary'},409,'REQUEST_ID_CONFLICT'],
  ];
  for(const [row,status,code] of cases){
    const inner=setup(row);const r=await handle(request(),inner.env);
    assert.equal(r.status,status);assert.deepEqual(await body(r),{ok:false,error:code});
  }
});

test('unexpected database exceptions and malformed result fail closed with 503',async()=>{
  for(const db of [{async query(){throw new Error('private SQL failure token=secret')}},{async query(){return {rows:[]}}}]){
    const env={CONNECT_NEON_MODE:'isolated-synthetic-only',CONNECT_NEON_HTTP_ENABLED:true,CONNECT_NEON_HTTP_ORIGIN:'https://isolated.example.invalid',CONNECT_NEON_DB:db};
    const r=await handle(request(),env);
    assert.equal(r.status,503);
    assert.equal(r.headers.get('x-musitu-admission-outcome'),'unknown');
    const payload=await body(r);
    assert.deepEqual(payload,{ok:false,error:'CUSTOMER_NEON_UNAVAILABLE'});
    assert.doesNotMatch(JSON.stringify(payload),/private|secret|SQL/);
  }
});
