/**
 * Private, SQLite-persistent MMF onboarding stage. The sole runtime boundary is
 * a separately authorized Durable Object RPC stub. The public fetch path ALWAYS
 * denies; no payment initiation, provider mail send, DNS claiming or entitlements.
 *
 * Requires Cloudflare SQLite-backed Durable Objects with transactionSync().
 * DO NOT route a public Worker to these RPC methods or bundle secret values.
 */
import {CommercialPlatform} from '../commercial/mmf-commercial-platform.mjs';
import {IdentityAdmission,StageCommercialController} from '../commercial/mmf-oidc-admission.mjs';
const deny=()=>{throw Error('MMF_PRIVATE_COMMERCIAL_STAGE_DENIED')};
const flags=env=>env?.MMF_STAGE_ONLY==='true'&&env?.MMF_REAL_SEND_ENABLED==='false'&&
 env?.MMF_COMMERCE_ENABLED==='false'&&env?.MMF_CUSTOMER_API_ENABLED==='false'&&
 env?.MMF_MAIL_SENDING_ENABLED==='false';
const sha=/^[a-f0-9]{64}$/;
const decodePepper=v=>{
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v))deny();
 const b=Buffer.from(v,'base64url');
 if(b.length!==32||b.toString('base64url')!==v)deny();
 return b;
};
const safeJson=v=>{
 if(typeof v!=='string'||v.length>3500)deny();
 let data;try{data=JSON.parse(v)}catch{deny()}
 if(!data||typeof data!=='object'||Array.isArray(data))deny();
 return data;
};
/** Translate node:sqlite's sync prepare/get/run semantics to Cloudflare SqlStorage.
 * IMPORTANT: cursor.rowsWritten is BILLING, not the number of rows updated.
 * SQLite SELECT changes() must be read immediately after each statement.
 * SQL BEGIN/COMMIT is deliberately not accepted; Cloudflare uses transactionSync.
 */
export function createMmfCommercialSqliteDb(storage){
 if(typeof storage?.sql?.exec!=='function'||typeof storage?.transactionSync!=='function')deny();
 const sql=storage.sql;
 const query=(q,args)=>{
  if(typeof q!=='string'||q.length>12000||/\b(?:ATTACH|DETACH|VACUUM|LOAD_EXTENSION)\b/i.test(q)||
      args.length>12||args.some(x=>x!==null&&!['string','number','boolean'].includes(typeof x)))deny();
  const result=sql.exec(q,...args);
  if(!result||typeof result.toArray!=='function')deny();
  const rows=result.toArray();
  if(!Array.isArray(rows))deny();
  return rows;
 };
 return Object.freeze({
  exec(q){
   if(typeof q!=='string'||/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(q))deny();
   query(q,[]);
  },
  prepare(q){
   if(typeof q!=='string'||!/^(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(q.trim())||q.includes(';'))deny();
   return Object.freeze({
    get(...args){return query(q,args)[0]},
    run(...args){
     query(q,args);
     const row=query('SELECT changes() AS n',[])[0];
     if(!Number.isSafeInteger(row?.n)||row.n<0)deny();
     return {changes:row.n};
    }
   });
  },
  transactionSync(operation){return storage.transactionSync(operation)}
 });
}
const H=Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
/** One private DO name for a stage-only control plane, tenant isolation at SQL layer. */
export class MmfCommercialStageKernel {
 constructor(ctx,env,{now=Date.now}={}){
  if(!flags(env)||typeof now!=='function'||!ctx?.storage)deny();
  const pepper=decodePepper(env.MMF_API_PEPPER_B64);
  const sessionPepper=decodePepper(env.MMF_SESSION_PEPPER_B64);
  if(pepper.equals(sessionPepper)||!sha.test(env.MMF_OIDC_PINNED_SPKI_SHA256||''))deny();
  const db=createMmfCommercialSqliteDb(ctx.storage);
  const admission=new IdentityAdmission(db,{
   issuer:env.MMF_OIDC_ISSUER,audience:env.MMF_OIDC_AUDIENCE,
   keyId:env.MMF_OIDC_KEY_ID,publicJwk:safeJson(env.MMF_OIDC_PUBLIC_JWK_JSON),
   spkiFingerprint:env.MMF_OIDC_PINNED_SPKI_SHA256,sessionPepper,env,now
  });
  const platform=new CommercialPlatform(db,{
   apiPepper:pepper,trustedPaymentKey:env.MMF_PAYMENT_PUBLIC_KEY_PEM,env,now
  });
  this.admission=admission;
  this.platform=platform;
  this.controller=new StageCommercialController({admission,platform});
 }
 // This is NEVER a public customer endpoint, even if a route is accidentally set.
 async fetch(){return new Response(JSON.stringify({error:'MMF_PRIVATE_STAGE_DISABLED'}),{status:503,headers:H});}
 issueLoginChallenge(){return this.admission.issueChallenge()}
 acceptOidcLogin(input){return this.admission.acceptLogin(input)}
 revokeSession(token){return this.admission.revokeSession(token)}
 authenticateApiKey(token,scope){return this.platform.authenticateApiKey(token,scope)}
 createTenant(input){return this.controller.createTenant(input)}
 issueApiKey(input){return this.controller.issueApiKey(input)}
 revokeApiKey(input){return this.controller.revokeApiKey(input)}
 requestDomain(input){return this.controller.requestDomain(input)}
 openSubscription(input){return this.controller.openSubscription(input)}
 getSubscription(input){return this.controller.getSubscription(input)}
 getUsage(input){return this.controller.getUsage(input)}
 meterStageEvent({sessionToken,tenantId,idempotencyKey,kind}={}){
  const actorSubject=this.admission.authenticateSession(sessionToken).actorSubject;
  return this.platform.meterStageEvent({tenantId,actorSubject,idempotencyKey,kind});
 }
 effectiveEntitlement(input){return this.controller.tenantEntitlement(input)}
}
// Non-routable default Worker. Never forward requests to the DO.
export default {async fetch(){return new Response(JSON.stringify({error:'MMF_PRIVATE_STAGE_DISABLED'}),{status:503,headers:H})}};