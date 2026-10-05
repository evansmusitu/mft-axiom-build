const ENDPOINT = './.well-known/axiom-session';
const SESSION_SCHEMA = 'musitu.axiom.browser-session.v1';
const STATE_SCHEMA = 'musitu.axiom.identity-session-state.v1';
const ALLOWED_FIELDS = new Set(['schema','authenticated','subject','display_name','session_id','assurance','expires_at','sign_in_path','sign_out_path']);
const GUEST_FIELDS = new Set(['schema','authenticated','sign_in_path']);
const SECRET_FIELD = /^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;

const clean=(value,limit=240)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,limit);

function rejectSecretFields(value,path='session'){
  if (!value || typeof value !== 'object') return;
  for (const [key,child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw new DOMException(`${path}.${key} is forbidden credential material`,'SecurityError');
    rejectSecretFields(child,`${path}.${key}`);
  }
}

function sameOriginHref(path,{baseURI,origin}){
  if (!path) return null;
  const href=new URL(clean(path,500),baseURI);
  if (href.origin !== origin || !/^https?:$/.test(href.protocol)) throw new DOMException('identity action must remain same-origin','SecurityError');
  return href.href;
}

function failClosed(reason='UNAUTHENTICATED',signInHref=null){
  return Object.freeze({
    schema:STATE_SCHEMA,
    authenticated:false,
    subject:null,
    displayName:'Guest workspace',
    sessionId:null,
    assurance:'NONE',
    expiresAt:null,
    signInHref,
    signOutHref:null,
    authorization:Object.freeze({source:'SERVER_ONLY',browserMayGrant:false,roles:Object.freeze([]),scopes:Object.freeze([])}),
    reason,
  });
}

export function normalizeIdentityPayload(payload,{baseURI='http://localhost/',origin='http://localhost'}={}){
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new DOMException('identity payload must be an object','SecurityError');
  rejectSecretFields(payload);
  const allowed=payload.authenticated===true?ALLOWED_FIELDS:GUEST_FIELDS;
  if (Object.keys(payload).some(key=>!allowed.has(key))) throw new DOMException('identity payload contained unsupported authority fields','SecurityError');
  if (payload.schema!==SESSION_SCHEMA) throw new DOMException('identity payload schema rejected','SecurityError');

  if (payload.authenticated===false) {
    return failClosed('UNAUTHENTICATED',sameOriginHref(payload.sign_in_path,{baseURI,origin}));
  }
  if (payload.authenticated!==true) throw new DOMException('identity authentication state rejected','SecurityError');

  const subject=clean(payload.subject,180);
  const displayName=clean(payload.display_name,120);
  const sessionId=clean(payload.session_id,180);
  if (!subject || !displayName || !sessionId) throw new DOMException('identity session is incomplete','SecurityError');

  const expiresAt=clean(payload.expires_at,80);
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now())) throw new DOMException('identity session expired','SecurityError');

  return Object.freeze({
    schema:STATE_SCHEMA,
    authenticated:true,
    subject,
    displayName,
    sessionId,
    assurance:clean(payload.assurance,100)||'SERVER_SESSION',
    expiresAt:expiresAt||null,
    signInHref:sameOriginHref(payload.sign_in_path,{baseURI,origin}),
    signOutHref:sameOriginHref(payload.sign_out_path,{baseURI,origin}),
    authorization:Object.freeze({source:'SERVER_ONLY',browserMayGrant:false,roles:Object.freeze([]),scopes:Object.freeze([])}),
    reason:'RESTORED_FROM_SAME_ORIGIN_HTTPONLY_COOKIE',
  });
}

export async function readIdentitySession({
  fetchImpl=globalThis.fetch,
  baseURI=globalThis.document?.baseURI,
  origin=globalThis.location?.origin,
  timeoutMs=2500,
}={}){
  if (typeof fetchImpl!=='function' || !baseURI || !origin) return failClosed('SESSION_ENVIRONMENT_UNAVAILABLE');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Math.max(100,Math.min(Number(timeoutMs)||2500,10000)));
  try {
    const endpoint=new URL(ENDPOINT,baseURI);
    if (endpoint.origin!==origin) throw new DOMException('identity endpoint must be same-origin','SecurityError');
    const response=await fetchImpl(endpoint.href,{
      method:'GET',
      credentials:'include',
      cache:'no-store',
      redirect:'error',
      referrerPolicy:'same-origin',
      headers:{Accept:'application/json'},
      signal:controller.signal,
    });
    if ([401,403,404].includes(response.status)) return failClosed('UNAUTHENTICATED');
    if (!response.ok) throw new DOMException('identity endpoint rejected','SecurityError');
    const contentType=(response.headers?.get?.('content-type')||'').toLowerCase();
    if (!contentType.includes('application/json')) throw new DOMException('identity response type rejected','SecurityError');
    const text=await response.text();
    if (text.length>8192) throw new DOMException('identity response exceeded limit','SecurityError');
    return normalizeIdentityPayload(JSON.parse(text),{baseURI,origin});
  } catch (error) {
    return failClosed(error?.name==='SecurityError'?'SESSION_REJECTED':error?.name==='AbortError'?'SESSION_TIMEOUT':'SESSION_ENDPOINT_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export function initIdentitySessionAdapter({emit=()=>{},...options}={}){
  let state=failClosed('CHECKING_SERVER_SESSION');
  const ready=readIdentitySession(options).then(next=>{
    state=next;
    if (globalThis.document?.documentElement) {
      document.documentElement.dataset.identityState=state.authenticated?'authenticated':'guest';
      const detail=document.querySelector('#session-detail');
      if (detail) detail.textContent=state.authenticated
        ? 'Identity is server-authoritative and restored through a same-origin HttpOnly cookie. The browser cannot grant itself roles or scopes.'
        : 'No authenticated server session is established. Browser-local workspace state does not grant external authority.';
    }
    emit('identity.restore',{state:state.authenticated?'authenticated':'guest',reason:state.reason});
    return structuredClone(state);
  });
  return Object.freeze({
    ready,
    getState:()=>structuredClone(state),
    refresh:async()=> {
      state=await readIdentitySession(options);
      emit('identity.refresh',{state:state.authenticated?'authenticated':'guest',reason:state.reason});
      return structuredClone(state);
    }
  });
}
