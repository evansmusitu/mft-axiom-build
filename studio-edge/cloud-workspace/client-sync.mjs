/**
 * MUSITU private-origin cloud sync candidate (not wired into public website).
 * Explicit calls only; exactly the existing encrypted workspace envelopes are
 * transferred, never passphrases or decrypted content. Access uses first-party
 * cookies injected by the qualified Cloudflare Access app, not browser tokens.
 * This module must only run at workspace.mftintelligence.com AFTER Access+MFA
 * and the dedicated tenant-isolated Worker are independently qualified.
 */
import {validOpaqueEnvelope} from './gateway.mjs';

const PRIVATE_ORIGIN='https://workspace.mftintelligence.com';
const SLOTS=5;
const MAX_REPLY=251000;
const KEY1='musitu.intelligence.encrypted.v1';
const PREFIX='musitu.intelligence.encrypted.slot.';

export class CloudSyncError extends Error {
  constructor(code){
    super('Cloud workspace sync denied: '+code+'.');
    this.name='CloudSyncError';this.code=code;
  }
}
function fail(code){throw new CloudSyncError(code);}
function checkSlot(slot){
  if(!Number.isInteger(slot)||slot<1||slot>SLOTS)fail('INVALID_SLOT');
  return slot;
}
function checkVersion(version,minimum=0){
  if(!Number.isInteger(version)||version<minimum||version>2147483646)fail('INVALID_VERSION');
}
function checkTenant(tenant){
  if(typeof tenant!=='string'||!/^[a-z][a-z0-9_-]{2,39}$/.test(tenant))fail('INVALID_TENANT');
  return tenant;
}
function key(slot){return slot===1?KEY1:PREFIX+slot+'.v2';}
function parseReply(response,payload){
  if(payload.length>MAX_REPLY)fail('INVALID_SERVER_RESPONSE');
  try {
    const json=JSON.parse(payload);
    if(!json||typeof json!=='object'||Array.isArray(json))fail('INVALID_SERVER_RESPONSE');
    return json;
  }catch(error){
    if(error instanceof CloudSyncError)throw error;
    fail('INVALID_SERVER_RESPONSE');
  }
}
/**
 * createCloudWorkspaceSync requires the private-origin browser; a public-site
 * page cannot use it to bypass Access. No automatic remote calls at creation.
 * The local storage scheme preserves Workspace 1 legacy key and v2 slots 2–5.
 */
export function createCloudWorkspaceSync({tenant,locationOrigin=globalThis.location?.origin,
  storage=globalThis.localStorage,fetchImpl=globalThis.fetch}={}){
  checkTenant(tenant);
  if(locationOrigin!==PRIVATE_ORIGIN)fail('PRIVATE_ORIGIN_REQUIRED');
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||
     typeof fetchImpl!=='function')fail('STORAGE_OR_NETWORK_UNAVAILABLE');
  function local(slot){
    checkSlot(slot);
    let ciphertext;
    try{ciphertext=storage.getItem(key(slot));}catch{fail('LOCAL_STORAGE_UNAVAILABLE');}
    if(ciphertext===null)return null;
    if(!validOpaqueEnvelope(ciphertext))fail('INVALID_LOCAL_CIPHERTEXT');
    return ciphertext;
  }
  async function call(slot,method,body){
    checkSlot(slot);
    const url=PRIVATE_ORIGIN+'/api/workspace/v1/tenants/'+tenant+'/slots/'+slot;
    const init={method,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
      headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)};
    if(body!==undefined){
      init.headers['content-type']='application/json';
      init.body=JSON.stringify(body);
    }
    let response,raw;
    try{
      response=await fetchImpl(url,init);
      raw=await response.text();
    }catch{fail('NETWORK_UNAVAILABLE');}
    const parsed=parseReply(response,raw);
    if(response.status===409)fail('VERSION_CONFLICT');
    if(response.status===401)fail('AUTHENTICATION_REQUIRED');
    if(response.status===403)fail('ACCESS_DENIED');
    if(response.status===429)fail('RATE_LIMITED');
    if(response.status===503)fail('SERVICE_UNAVAILABLE');
    if(response.status===404&&method==='GET'&&parsed.code==='WORKSPACE_EMPTY')return null;
    if(response.status!==200)fail('REMOTE_OPERATION_REJECTED');
    if(parsed.tenant!==tenant||parsed.slot!==slot)fail('INVALID_SERVER_RESPONSE');
    return parsed;
  }
  return Object.freeze({
    /** Explicit backup upload with server-authoritative optimistic version. */
    async upload(slot,{expectedVersion,approval}={}){
      if(approval!=='UPLOAD_ENCRYPTED_COPY')fail('USER_CONSENT_REQUIRED');
      checkVersion(expectedVersion);
      const encrypted=local(slot);
      if(encrypted===null)fail('LOCAL_SLOT_EMPTY');
      const result=await call(slot,'PUT',{expectedVersion,encrypted});
      if(result.stored!==true||result.version!==expectedVersion+1)fail('INVALID_SERVER_RESPONSE');
      return {slot,version:result.version,encryptedOnly:true};
    },
    /** Explicit download. Never overwrites an existing different local slot
     * unless the user separately confirmed destructive local replacement. */
    async download(slot,{approval,overwriteApproval}={}){
      if(approval!=='DOWNLOAD_ENCRYPTED_COPY')fail('USER_CONSENT_REQUIRED');
      const existing=local(slot);
      const result=await call(slot,'GET');
      if(result===null)return {slot,remoteEmpty:true,localChanged:false};
      checkVersion(result.version,1);
      if(!validOpaqueEnvelope(result.encrypted))fail('INVALID_REMOTE_CIPHERTEXT');
      if(existing===result.encrypted)return {slot,version:result.version,localChanged:false};
      if(existing!==null && overwriteApproval!=='REPLACE_LOCAL_ENCRYPTED_COPY'){
        fail('LOCAL_REPLACEMENT_REQUIRES_APPROVAL');
      }
      try{storage.setItem(key(slot),result.encrypted);}catch{fail('LOCAL_STORAGE_UNAVAILABLE');}
      return {slot,version:result.version,localChanged:true,encryptedOnly:true};
    },
    /** Local slot is intentionally preserved when the remote copy is deleted. */
    async deleteRemote(slot,{expectedVersion,approval}={}){
      if(approval!=='DELETE_REMOTE_ENCRYPTED_COPY')fail('USER_CONSENT_REQUIRED');
      checkVersion(expectedVersion,1);
      const result=await call(slot,'DELETE',{expectedVersion});
      if(result.deleted!==true)fail('INVALID_SERVER_RESPONSE');
      return {slot,remoteDeleted:true,localPreserved:true};
    }
  });
}
