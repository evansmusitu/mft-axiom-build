/**
 * Synthetic-only HTTP boundary for testing the Neon admission adapter.
 * Never import into production_worker.mjs; no customer route is deployed.
 * Requires explicit boolean enablement and an exact HTTPS origin allowlist.
 */
import {reserveNeonSyntheticCustomerRequest} from './customer_neon_admission.mjs';

const PATHS = new Map([
  ['/__synthetic/neon/mining.plan','mining.plan'],
  ['/__synthetic/neon/mining.risk','mining.risk'],
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^Bearer mct_[A-Za-z0-9_-]{43}$/;
const HEADERS = Object.freeze({
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
});
function response(status, body, extras={}) {
  return new Response(JSON.stringify(body),{status,headers:{...HEADERS,...extras}});
}
const reject = (status,error,headers)=>response(status,{ok:false,error},headers);
function allowedOrigin(origin){
  if(typeof origin!=='string' || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(origin))return false;
  try {return new URL(origin).origin===origin;}catch{return false;}
}

export async function handleNeonSyntheticHttpCanary(request,env) {
  if (env?.CONNECT_NEON_MODE!=='isolated-synthetic-only' ||
      env.CONNECT_NEON_HTTP_ENABLED!==true ||
      !allowedOrigin(env.CONNECT_NEON_HTTP_ORIGIN))return reject(404,'NOT_FOUND');
  if (!(request instanceof Request))return reject(503,'CUSTOMER_NEON_UNAVAILABLE');
  let url;
  try{url=new URL(request.url);}catch{return reject(404,'NOT_FOUND');}
  const scope=PATHS.get(url.pathname);
  if(url.origin!==env.CONNECT_NEON_HTTP_ORIGIN || url.search || !scope) return reject(404,'NOT_FOUND');
  if(request.method!=='POST')return reject(405,'METHOD_NOT_ALLOWED',{'allow':'POST'});
  // No request body is part of this contract: reject even an empty stream.
  if(request.body!==null || request.headers.has('content-type') ||
      request.headers.has('transfer-encoding') ||
      !['', '0'].includes(request.headers.get('content-length')??''))return reject(400,'REQUEST_BODY_FORBIDDEN');
  const requestId=request.headers.get('x-musitu-request-id');
  if(typeof requestId!=='string' || !UUID_V4.test(requestId))return reject(400,'INVALID_REQUEST_ID');
  const authorization=request.headers.get('authorization');
  if(typeof authorization!=='string'||!TOKEN.test(authorization))return reject(401,'UNAUTHORIZED');
  const result=await reserveNeonSyntheticCustomerRequest({
    authorization,scope,env,requestIdFactory:()=>requestId,
  });
  if(result?.ok===true)return response(200,{ok:true,request_id:result.request_id,scope});
  const status=Number(result?.status);
  if(![401,409,429,503].includes(status))return reject(503,'CUSTOMER_NEON_UNAVAILABLE');
  const code=String(result.error);
  if(!['UNAUTHORIZED','REQUEST_ID_CONFLICT','CUSTOMER_QUOTA_EXCEEDED',
    'CUSTOMER_MINUTE_QUOTA_EXCEEDED','CUSTOMER_NEON_UNAVAILABLE','CUSTOMER_NEON_DISABLED'].includes(code))
    return reject(503,'CUSTOMER_NEON_UNAVAILABLE');
  return reject(status,code);
}
export default {fetch:handleNeonSyntheticHttpCanary};
