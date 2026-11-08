import {createEvidenceBoundModelGateway} from './provider-gateway.mjs';
const HANDOVER=Object.freeze({status:'HANDOVER_REQUIRED',sourceFaqId:null,body:null,requiresHumanReview:true});
/** Finite, operator-only provider qualification. No send/tool/DB capabilities.
 * freePlanVerified records an operator prerequisite, not proof of account billing.
 * Not wired to production: per-instance limits are not a distributed quota ledger.
 */
export function createGroqQualificationGateway({token,freePlanVerified=false,fetchImpl=globalThis.fetch,timeoutMs=10000,maxRequests=5}={}){
 if(freePlanVerified!==true)throw Error('GROQ_FREE_PLAN_NOT_VERIFIED');
 if(typeof token!=='string'||!/^gsk_[A-Za-z0-9_-]{20,200}$/.test(token))throw Error('GROQ_CREDENTIAL_REQUIRED');
 if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>5)throw Error('GROQ_REQUEST_CAP_INVALID');
 if(typeof fetchImpl!=='function')throw Error('GROQ_TRANSPORT_REQUIRED');
 let admitted=0,inFlight=false,uncertain=false;
 const gateway=createEvidenceBoundModelGateway({qualified:true,provider:'groq',url:'https://api.groq.com/openai/v1/chat/completions',allowedOrigins:['https://api.groq.com'],model:'openai/gpt-oss-20b',token,timeoutMs,
  fetchImpl:async(url,options)=>{if(admitted>=maxRequests)throw Error('GROQ_REQUEST_CAP_REACHED');admitted++;return fetchImpl(url,options);}});
 return Object.freeze({provider:'GROQ',model:'openai/gpt-oss-20b',mode:'SYNTHETIC_OPERATOR_QUALIFICATION_ONLY',
  getUsage:()=>({...gateway.getUsage(),admittedRequests:admitted,maxRequests}),
  async select(input){if(inFlight||uncertain||admitted>=maxRequests)return {...HANDOVER};inFlight=true;try{return await gateway.select(input);}finally{if(gateway.getUsage().events.at(-1)?.outcome==='TIMEOUT')uncertain=true;inFlight=false;}}
 });
}
