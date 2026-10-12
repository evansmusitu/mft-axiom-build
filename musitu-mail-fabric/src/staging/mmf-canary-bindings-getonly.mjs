/** Read-only inspection of MMF canary private service bindings. Never prints raw Worker source or secrets. */
import {canonicalCloudflareWorkerSource} from './canonical-cloudflare-worker-source.mjs';
import {createHash} from 'node:crypto';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const CANARY='mmf-paynow-isolated-deny-canary-20261012';
const AUTH='mft-phase8-external-authority';
const TRANS='mft-paynow-transport-gateway';
const BASE=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${CANARY}`;
const SOURCE_HASH='a9c9ffb29212104757e15dd9080ed9145b976d673921ac550940808a0a404083';
const deny=()=>{throw Error('MMF_CANARY_READONLY_INSPECTION_DENIED')};
function asPlain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype}
export async function inspectMmfCanaryBindingsReadOnly({accountId,token,fetchImpl=globalThis.fetch}={}){
 if(accountId!==ACCOUNT||typeof token!=='string'||token.length<20||token.length>500||typeof fetchImpl!=='function')deny();
 const history=[];
 async function get(url){
  if(![BASE,BASE+'/settings',BASE+'/subdomain'].includes(url))deny();
  history.push('GET');
  const response=await fetchImpl(url,{method:'GET',headers:{authorization:`Bearer ${token}`,accept:'application/json','cache-control':'no-store'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!(response instanceof Response)||!response.ok)deny();return response;
 }
 async function obj(url){const response=await get(url);const data=await response.text();if(data.length>100000)deny();
  const doc=JSON.parse(data);if(!asPlain(doc)||doc.success!==true||!asPlain(doc.result))deny();return doc.result;}
 const source=await canonicalCloudflareWorkerSource(await get(BASE));
 const settings=await obj(BASE+'/settings');
 const sub=await obj(BASE+'/subdomain');
 if(!Array.isArray(settings.bindings)||settings.bindings.length>30)deny();
 const bindings=settings.bindings.map(v=>{
  if(!asPlain(v)||typeof v.name!=='string'||typeof v.type!=='string')deny();
  return {name:v.name,type:v.type,service:v.type==='service'?v.service||null:null};
 });
 const expected=[{name:'MMF_PAYNOW_AUTHORITY',type:'service',service:AUTH},
  {name:'MMF_PAYNOW_TRANSPORT',type:'service',service:TRANS}];
 const matched=bindings.length===2&&expected.every(e=>bindings.some(b=>b.name===e.name&&b.type===e.type&&b.service===e.service));
 return {schema:'mmf-canary-getonly-inspection-v1',sourceHashMatchesOriginal:source.sourceSha256===SOURCE_HASH,
  sourceSha256:source.sourceSha256,expectedSourceSha256:SOURCE_HASH,
  publicWorkersDevDisabled:sub.enabled===false,previewDisabled:sub.previews_enabled===false,
  bindingNames:bindings.map(b=>b.name).sort(),bindingTypes:bindings.map(b=>b.type).sort(),
  expectedMmfServiceBindingCount:2,observedBindingCount:bindings.length,exactServiceBindingsMatch:matched,
  observedTargets:bindings.filter(b=>b.type==='service').map(b=>b.service).sort(),
  getCount:history.length,cloudflareMutationCount:0,commercialActivationAllowed:false};
}
if(process.argv[1]?.endsWith('mmf-canary-bindings-getonly.mjs')){
 const result=await inspectMmfCanaryBindingsReadOnly({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
 console.log(JSON.stringify(result));
}