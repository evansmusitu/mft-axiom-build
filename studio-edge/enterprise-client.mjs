/**
 * Explicit opt-in client for future MUSITU Intelligence Access-protected canary.
 * Inert until instantiated. Does NOT initiate login, persist tokens, fetch
 * without user calls, migrate local slots, or auto-retry conflict mutations.
 * Provisioning authentication and encryption keys is outside this module.
 */
import {encryptTenantText,decryptTenantText} from './client-encrypted-artifact.mjs';
const ID=/^[A-Za-z0-9_-]{8,64}$/;
const ETAG=/^"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"$/;
const HOST=/^[a-z0-9-]+\.mft-education-nexus-93f395f5\.workers\.dev$/;
class WorkspaceRequestError extends Error {
 constructor(code,status=0){
   super('Workspace operation could not be completed.');
   this.name='WorkspaceRequestError';this.code=code;this.status=status;
 }
}
const fail=(code,status=0)=>{throw new WorkspaceRequestError(code,status);};
const validateId=value=>{if(typeof value!=='string'||!ID.test(value))fail('INVALID_ID');return value;};
const validateEtag=value=>{if(typeof value!=='string'||!ETAG.test(value))fail('INVALID_ETAG');return value;};
function providerConfig({baseUrl,tenantId,key,getToken,fetcher}) {
 if(typeof baseUrl!=='string')fail('INVALID_ENDPOINT');
 let origin;
 try{
   const u=new URL(baseUrl);
   if(u.protocol!=='https:'||!HOST.test(u.hostname)||u.username||u.password||u.port||
      u.pathname!=='/'||u.search||u.hash)fail('INVALID_ENDPOINT');
   origin=u.origin;
 }catch{fail('INVALID_ENDPOINT');}
 validateId(tenantId);
 if(!key || key.type!=='secret' || key.algorithm?.name!=='AES-GCM'||
    key.algorithm.length!==256||!key.usages?.includes('encrypt')||!key.usages?.includes('decrypt'))
    fail('INVALID_CRYPTO_KEY');
 if(typeof getToken!=='function')fail('MISSING_TOKEN_PROVIDER');
 const fetchFn=fetcher ?? globalThis.fetch;
 if(typeof fetchFn!=='function')fail('FETCH_UNAVAILABLE');
 return {origin,tenantId,key,getToken,fetchFn};
}
export function createTenantWorkspaceClient(options) {
 const {origin,tenantId,key,getToken,fetchFn}=providerConfig(options||{});
 const route=origin+'/api/enterprise/tenants/'+tenantId+'/artifacts';
 async function send(method,params={},body=null,etag=null,noneMatch=false) {
   const token=await getToken();
   if(typeof token!=='string'||token.length<1||token.length>10000)fail('AUTH_REQUIRED',401);
   const url=new URL(route);
   for(const [name,value] of Object.entries(params))if(value!==null&&value!==undefined)url.searchParams.set(name,String(value));
   const headers={'cf-access-jwt-assertion':token};
   if(body!==null)headers['content-type']='application/json';
   if(etag!==null)headers['if-match']=validateEtag(etag);
   if(noneMatch)headers['if-none-match']='*';
   let response;
   try {
     response=await fetchFn(url.href,{
       method,headers,body:body===null?undefined:JSON.stringify(body),
       credentials:'omit',redirect:'error',cache:'no-store',mode:'cors'
     });
   }catch{fail('NETWORK_UNAVAILABLE');}
   if(!response||typeof response.ok!=='boolean')fail('INVALID_RESPONSE');
   if(!response.ok) {
     let code='REQUEST_FAILED';
     try{
       const payload=await response.json();
       if(typeof payload?.code==='string' && /^[A-Z_]{3,64}$/.test(payload.code))code=payload.code;
     }catch{}
     fail(code,response.status);
   }
   let data;
   try{data=await response.json();}catch{fail('INVALID_RESPONSE',response.status);}
   return {data,etag:response.headers.get('etag')};
 }
 function successfulTag(tag) {
   if(!ETAG.test(tag||''))fail('INVALID_RESPONSE');
   return tag;
 }
 return Object.freeze({
   async list({after=null,limit=10}={}) {
     if(!Number.isInteger(limit)||limit<1||limit>10)fail('INVALID_PAGE_SIZE');
     if(after!==null)validateId(after);
     const result=await send('GET',{after,limit});
     if(!Array.isArray(result.data?.items)||
        result.data.items.length>limit||
        !(result.data.nextAfter===null || (typeof result.data.nextAfter==='string'&&ID.test(result.data.nextAfter)))||
        !result.data.items.every(it=>it&&ID.test(it.id)&&typeof it.revision==='string'&&
          Number.isSafeInteger(it.updatedAt)&&Object.keys(it).sort().join(',')==='id,revision,updatedAt'))
       fail('INVALID_RESPONSE');
     return result.data;
   },
   async get({id}={}) {
     validateId(id);
     const result=await send('GET',{id});
     if(result.data?.id!==id)fail('INVALID_RESPONSE');
     const tag=successfulTag(result.etag);
     const text=await decryptTenantText(result.data.envelope,key,tenantId,id);
     return {text,etag:tag};
   },
   async create({id,text}={}) {
     validateId(id);
     const envelope=await encryptTenantText(text,key,tenantId,id);
     const result=await send('PUT',{id},envelope,null,true);
     return {etag:successfulTag(result.etag)};
   },
   async replace({id,text,etag}={}) {
     validateId(id);validateEtag(etag);
     const envelope=await encryptTenantText(text,key,tenantId,id);
     const result=await send('PUT',{id},envelope,etag,false);
     return {etag:successfulTag(result.etag)};
   },
   async delete({id,etag}={}) {
     validateId(id);validateEtag(etag);
     const result=await send('DELETE',{id},null,etag,false);
     if(result.data?.deleted!==true)fail('INVALID_RESPONSE');
     return {deleted:true};
   }
 });
}
