import {handleOperatorRequest, verifyOperatorAccess} from './worker.js';

const INDEX_FALLBACK='<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>MUSITU Axiom — Support Operations</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>MUSITU Axiom</h1><p>Support Operations</p><section><h2>Inbox</h2><p>Reply to customer · Internal note · Evidence · Audit trail</p></section></main><script type="module" src="/app.js"></script></body></html>';
const CSS_FALLBACK='body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px}';
const JS_FALLBACK="fetch('/api/v1/operator/cases',{headers:{accept:'application/json'}});";

function response(body,type,status=200){
  return new Response(body,{status,headers:{
    'content-type':type,
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'x-robots-tag':'noindex, nofollow, noarchive',
    'referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  }});
}

async function principalFor(request,env){
  if(env.ENVIRONMENT!=='production'&&typeof env.SUPPORT_OPERATOR_VERIFY==='function') return env.SUPPORT_OPERATOR_VERIFY(request,env);
  return verifyOperatorAccess(request,env);
}

export async function handleOperatorSurface(request,env={}){
  const principal=await principalFor(request,env);
  if(!principal) return response(JSON.stringify({error:'OPERATOR_AUTH_REQUIRED'}),'application/json; charset=utf-8',401);

  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/v1/operator/')){
    if(env.SUPPORT_API&&typeof env.SUPPORT_API.fetch==='function') return env.SUPPORT_API.fetch(request);
    const operatorEnv=env.ENVIRONMENT!=='production'
      ? {...env,SUPPORT_OPERATOR_VERIFY:async()=>principal}
      : env;
    return handleOperatorRequest(request,operatorEnv);
  }

  if(request.method!=='GET'&&request.method!=='HEAD') return response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),'application/json; charset=utf-8',405);

  if(env.ASSETS&&typeof env.ASSETS.fetch==='function'&&['/','/index.html','/styles.css','/app.js'].includes(url.pathname)){
    const assetUrl=new URL(request.url);
    if(assetUrl.pathname==='/') assetUrl.pathname='/index.html';
    const asset=await env.ASSETS.fetch(new Request(assetUrl,request));
    if(asset.status!==404){
      const headers=new Headers(asset.headers);
      headers.set('cache-control','no-store');headers.set('x-robots-tag','noindex, nofollow, noarchive');
      headers.set('referrer-policy','no-referrer');headers.set('x-content-type-options','nosniff');
      headers.set('content-security-policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers});
    }
  }

  if(url.pathname==='/'||url.pathname==='/index.html') return response(request.method==='HEAD'?null:INDEX_FALLBACK,'text/html; charset=utf-8');
  if(url.pathname==='/styles.css') return response(request.method==='HEAD'?null:CSS_FALLBACK,'text/css; charset=utf-8');
  if(url.pathname==='/app.js') return response(request.method==='HEAD'?null:JS_FALLBACK,'text/javascript; charset=utf-8');
  return response(JSON.stringify({error:'NOT_FOUND'}),'application/json; charset=utf-8',404);
}

export default {fetch(request,env){return handleOperatorSurface(request,env);}};
