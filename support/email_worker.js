import {inspectSecretMaterial} from './control_plane.js';
async function sha256(value){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function normalizedAddress(value){return String(value||'').trim().toLowerCase();}
function threadFromRecipient(to){const m=normalizedAddress(to).match(/^reply\+([a-z0-9._:-]{8,191})@mftintelligence\.com$/i);return m?'thread:'+m[1]:null;}
export async function handleInboundSupportEmail(message,env={}){
 if(typeof env.SUPPORT_EMAIL_INGRESS_VERIFY!=='function'||await env.SUPPORT_EMAIL_INGRESS_VERIFY(message,env)!==true)return Object.freeze({accepted:false,reason:'INGRESS_NOT_VERIFIED'});
 const threadRef=threadFromRecipient(message?.to);if(!threadRef)return Object.freeze({accepted:false,reason:'THREAD_NOT_RECOGNIZED'});
 const sender=normalizedAddress(message?.from);if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender))return Object.freeze({accepted:false,reason:'SENDER_INVALID'});
 const body=String(message?.text||'').trim();if(!body||body.length>8000)return Object.freeze({accepted:false,reason:'BODY_INVALID'});
 const secret=inspectSecretMaterial({body},'message');if(!secret.safe)return Object.freeze({accepted:false,reason:'SECRET_MATERIAL_REJECTED'});
 const senderHash=await sha256(sender);
 const store=env.SUPPORT_STORE;if(!store||typeof store.appendInboundEmailByThread!=='function')return Object.freeze({accepted:false,reason:'STORE_UNAVAILABLE'});
 const value=await store.appendInboundEmailByThread(threadRef,{sender_hash:senderHash,body});
 return value?Object.freeze({accepted:true,case_id:value.case_id}):Object.freeze({accepted:false,reason:'THREAD_NOT_AUTHORIZED'});
}
export default {async email(message,env){let raw='';try{raw=await new Response(message.raw).text();}catch{}const split=raw.split(/\r?\n\r?\n/);return handleInboundSupportEmail({to:message.to,from:message.from,text:split.slice(1).join('\n\n').slice(0,8000)},env);}};
