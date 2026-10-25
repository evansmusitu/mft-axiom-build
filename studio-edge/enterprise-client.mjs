/**
 * Explicit opt-in client for future MUSITU Intelligence Access-protected canary.
 * Inert until instantiated. Does NOT initiate login, persist tokens, fetch
 * without user calls, migrate local slots, or auto-retry conflict mutations.
 * Provisioning authentication and encryption keys is outside this module.
 */
import {encryptTenantText,decryptTenantText} from './client-encrypted-artifact.mjs';
const ID=/^[A-Za-z0-9_-]{8,64}$/;
const ETAG=/^"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"$/;
const HOST=/^(?:musitu-private-canary|musitu-intelligence-enterprise-private-[a-z0-9]{6,32})\.mft-education-nexus-93f395f5\.workers\.dev$/;
class WorkspaceRequestError extends Error {
 constructor(code,status=0){
   super('Workspace operation could not be completed.');
   this.name='WorkspaceRequestError';this.code=code;this.status=status;
 }
}
const fail=(code,status=0)=>{throw new WorkspaceRequestError(code,status);};
const validateId=value=>{if(typeof value!=='string'||!ID.test(value))fail('INVALID_ID');return value;};
const validateEtag=value=>{if(typeof value!=='string'||!ETAG.test(value))fail('INVALID_ETAG');return value;};
function providerConfig({baseUrl,tenantId,key,getToken,fetcher,requestTimeoutMs=12000}) {
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
    key.algorithm.length!==256||key.extractable!==false||!key.usages?.includes('encrypt')||!key.usages?.includes('decrypt'))
    fail('INVALID_CRYPTO_KEY');
 if(typeof getToken!=='function')fail('MISSING_TOKEN_PROVIDER');
 const fetchFn=fetcher ?? globalThis.fetch;
 if(typeof fetchFn!=='function')fail('FETCH_UNAVAILABLE');
 if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<10||requestTimeoutMs>30000)
   fail('INVALID_REQUEST_TIMEOUT');
 return {origin,tenantId,key,getToken,fetchFn,requestTimeoutMs};
}
export function createTenantWorkspaceClient(options) {
 const {origin,tenantId,key,getToken,fetchFn,requestTimeoutMs}=providerConfig(options||{});
 const route=origin+'/api/enterprise/tenants/'+tenantId+'/artifacts';
 async function boundedResponseJson(response) {
   if(!response.headers || typeof response.headers.get!=='function')fail('INVALID_RESPONSE',response.status);
   if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail('INVALID_RESPONSE',response.status);
   const lengthHeader=response.headers.get('content-length');
   if(lengthHeader!==null && !/^\d+$/.test(lengthHeader))fail('INVALID_RESPONSE',response.status);
   if(lengthHeader!==null && Number(lengthHeader)>65536)fail('RESPONSE_TOO_LARGE',response.status);
   const reader=response.body?.getReader();
   if(!reader)fail('INVALID_RESPONSE',response.status);
   const chunks=[];let size=0;
   try {
     while(true){
       const {value,done}=await reader.read();
       if(done)break;
       size+=value.byteLength;
       if(size>65536)fail('RESPONSE_TOO_LARGE',response.status);
       chunks.push(value);
     }
   }finally{await reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let offset=0;
   for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
   catch{fail('INVALID_RESPONSE',response.status);}
 }
 async function send(method,params={},body=null,etag=null,noneMatch=false) {
   let token;
   try{token=await getToken();}
   catch{fail('AUTH_REQUIRED',401);}
   if(typeof token!=='string'||token.length<1||token.length>10000)fail('AUTH_REQUIRED',401);
   const url=new URL(route);
   for(const [name,value] of Object.entries(params))if(value!==null&&value!==undefined)url.searchParams.set(name,String(value));
   const headers={'cf-access-jwt-assertion':token};
   if(body!==null)headers['content-type']='application/json';
   if(etag!==null)headers['if-match']=validateEtag(etag);
   if(noneMatch)headers['if-none-match']='*';
   const controller=new AbortController();
   let timer,timedOut=false;
   const timeout=new Promise((_,reject)=>{
     timer=setTimeout(()=>{
       timedOut=true;controller.abort();
       reject(new WorkspaceRequestError('REQUEST_TIMEOUT'));
     },requestTimeoutMs);
   });
   async function execute(){
     const response=await fetchFn(url.href,{
       method,headers,body:body===null?undefined:JSON.stringify(body),
       credentials:'omit',redirect:'error',cache:'no-store',mode:'cors',
       signal:controller.signal
     });
     if(!response||typeof response.ok!=='boolean')fail('INVALID_RESPONSE');
     let data;
     try{data=await boundedResponseJson(response);}
     catch(error){
       if(response.ok || error?.code!=='INVALID_RESPONSE')throw error;
       data={};
     }
     if(!response.ok){
       let code='REQUEST_FAILED';
       if(typeof data?.code==='string'&&/^[A-Z_]{3,64}$/.test(data.code))code=data.code;
       fail(code,response.status);
     }
     return {data,etag:response.headers.get('etag')};
   }
   try{return await Promise.race([execute(),timeout]);}
   catch(error){
     if(timedOut)fail('REQUEST_TIMEOUT');
     if(error instanceof WorkspaceRequestError)throw error;
     fail('NETWORK_UNAVAILABLE');
   }finally{clearTimeout(timer);}
 }
 function successfulTag(tag) {
   if(!ETAG.test(tag||''))fail('INVALID_RESPONSE');
   return tag;
 }
 async function inspectBundle(bundle) {
   // This is an offline, authenticated inspection. No token, fetch, local
   // storage, downloads, or public browser-slot migration are permitted here.
   if(!bundle || typeof bundle!=='object' || Array.isArray(bundle) ||
      Object.keys(bundle).sort().join(',')!=='artifacts,kind,tenantId,version' ||
      bundle.kind!=='musitu-enterprise-encrypted-export' ||
      bundle.version!==1 || bundle.tenantId!==tenantId ||
      !Array.isArray(bundle.artifacts) ||
      bundle.artifacts.length<1 || bundle.artifacts.length>50)
     fail('INVALID_BACKUP');
   const ids=[];
   for(const item of bundle.artifacts){
     if(!item || typeof item!=='object' || Array.isArray(item) ||
        Object.keys(item).sort().join(',')!=='envelope,etag,id' ||
        typeof item.id!=='string' || !ID.test(item.id) ||
        typeof item.etag!=='string' || !ETAG.test(item.etag) ||
        (ids.length && item.id<=ids[ids.length-1]))
       fail('INVALID_BACKUP');
     // Authenticate ciphertext and tenant/artifact AAD with the supplied
     // non-extractable key. Plaintext is discarded; it is not returned.
     try{await decryptTenantText(item.envelope,key,tenantId,item.id);}
     catch{fail('INVALID_BACKUP');}
     ids.push(item.id);
   }
   return {tenantId,count:ids.length,ids};
 }
 return Object.freeze({
   async inspectEncryptedBundle(bundle) {
     return inspectBundle(bundle);
   },
   async restoreEncryptedArtifact({bundle,id,acknowledgeCreateOnly=false}={}) {
     if(acknowledgeCreateOnly!==true)fail('RESTORE_APPROVAL_REQUIRED');
     validateId(id);
     const inspected=await inspectBundle(bundle);
     if(!inspected.ids.includes(id))fail('INVALID_RESTORE_SELECTION');
     // Restore ONE explicitly chosen ciphertext. Do not re-encrypt, migrate,
     // silently overwrite, auto-retry, or import the whole bundle. Each upload
     // counts toward the server-enforced rolling 20-mutations/minute budget.
     const selected=bundle.artifacts.find(item=>item.id===id);
     const result=await send('PUT',{id},selected.envelope,null,true);
     if(result.data?.id!==id || result.data.stored!==true)
       fail('INVALID_RESPONSE');
     return {id,etag:successfulTag(result.etag),created:true};
   },
   async list({after=null,limit=10}={}) {
     if(!Number.isInteger(limit)||limit<1||limit>10)fail('INVALID_PAGE_SIZE');
     if(after!==null)validateId(after);
     const result=await send('GET',{after,limit});
     const payload=result.data;
     if(!payload || typeof payload!=='object' || Array.isArray(payload) ||
        Object.keys(payload).sort().join(',')!=='items,nextAfter' ||
        !Array.isArray(payload.items) || payload.items.length>limit ||
        !(payload.nextAfter===null ||
          (typeof payload.nextAfter==='string'&&ID.test(payload.nextAfter))))
       fail('INVALID_RESPONSE');
     let previous=after;
     for(const item of payload.items) {
       if(!item || typeof item!=='object' || Array.isArray(item) ||
          Object.keys(item).sort().join(',')!=='id,revision,updatedAt' ||
          typeof item.id!=='string'||!ID.test(item.id) ||
          (previous!==null && item.id<=previous) ||
          typeof item.revision!=='string'||!ETAG.test('"'+item.revision+'"') ||
          !Number.isSafeInteger(item.updatedAt)||item.updatedAt<0)
         fail('INVALID_RESPONSE');
       previous=item.id;
     }
     if(payload.nextAfter!==null &&
        (!payload.items.length || payload.nextAfter!==previous))
       fail('INVALID_RESPONSE');
     return {items:payload.items,nextAfter:payload.nextAfter};
   },
   async exportEncryptedBundle() {
     // Explicit caller-initiated operation: NEVER auto-upload, decrypt to a
     // saved file, or touch the five unrelated local vault slots.
     // This is a best-effort consistent export; concurrent modifications
     // fail closed rather than producing an internally contradictory bundle.
     const artifacts=[],seen=new Set();
     let after=null;
     for(let pageNumber=0;pageNumber<6;pageNumber++){
       const response=await send('GET',{after,limit:10});
       const page=response.data;
       if(!Array.isArray(page?.items)||page.items.length>10||
          !(page.nextAfter===null||(typeof page.nextAfter==='string'&&ID.test(page.nextAfter))))
         fail('INVALID_RESPONSE');
       for(const item of page.items){
         if(!item||!ID.test(item.id)||!ETAG.test('"'+item.revision+'"')||
            !Number.isSafeInteger(item.updatedAt)||seen.has(item.id)||
            (after!==null&&item.id<=after)||artifacts.length>=50)
           fail('EXPORT_CONFLICT');
         const previous=artifacts.at(-1);
         if(previous&&item.id<=previous.id)fail('EXPORT_CONFLICT');
         seen.add(item.id);
         let found;
         try{found=await send('GET',{id:item.id});}
         catch(error){
           if(error?.status===404||error?.status===412)fail('EXPORT_CONFLICT');
           throw error;
         }
         const currentTag=successfulTag(found.etag);
         if(found.data?.id!==item.id || currentTag.slice(1,-1)!==item.revision)
           fail('EXPORT_CONFLICT');
         // Authenticate the ciphertext and AAD without copying plaintext into
         // the returned bundle, network requests, localStorage, or logs.
         await decryptTenantText(found.data.envelope,key,tenantId,item.id);
         artifacts.push({id:item.id,etag:currentTag,envelope:found.data.envelope});
       }
       if(page.nextAfter===null)
         return {kind:'musitu-enterprise-encrypted-export',version:1,tenantId,artifacts};
       if(!page.items.length || page.nextAfter!==page.items[page.items.length-1].id ||
          seen.has(page.nextAfter)===false)
         fail('EXPORT_CONFLICT');
       after=page.nextAfter;
     }
     fail('EXPORT_CONFLICT');
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
