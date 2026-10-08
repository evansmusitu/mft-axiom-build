const CASE_ID=/^AX-[0-9A-HJKMNP-TV-Z]{12}$/;
const ATTACHMENT_ID=/^AXF-[0-9A-HJKMNP-TV-Z]{16}$/;
const HASH=/^[a-f0-9]{64}$/i;
const OPERATOR=/^support_agent:[a-z0-9._:-]{3,160}$/i;
const PRIORITY=Object.freeze({
  P0:{ack:15,update:60,resolve:240},
  P1:{ack:60,update:240,resolve:1440},
  P2:{ack:480,update:1440,resolve:4320},
  P3:{ack:2880,update:4320,resolve:10080},
});
const PLANS=Object.freeze({
  COMMUNITY:Object.freeze({channels:['web'],customer_escalation:false,api:false,webhooks:false,priority_floor:'P2',contractual_sla:false}),
  STANDARD:Object.freeze({channels:['web','email'],customer_escalation:true,api:false,webhooks:false,priority_floor:'P1',contractual_sla:false}),
  BUSINESS:Object.freeze({channels:['web','email'],customer_escalation:true,api:true,webhooks:true,priority_floor:'P0',contractual_sla:false}),
  ENTERPRISE:Object.freeze({channels:['web','email','api'],customer_escalation:true,api:true,webhooks:true,priority_floor:'P0',contractual_sla:false}),
});
const LANGS=new Set(['en','fr','es','pt','de','it','nl','zh','ja','ko','ar','hi','sw','sn','nd']);
const SAFE_TYPES=new Set(['text/plain','text/csv','application/json','application/pdf','image/png','image/jpeg','image/webp']);
const MAX_ATTACHMENT=25*1024*1024;
const SAFE_EXT=/\.(?:txt|csv|json|pdf|png|jpe?g|webp|log)$/i;
const FORBIDDEN_DIAG=/^(?:authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret)$/i;
const clean=(v,n=512)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const iso=v=>{const d=new Date(v);if(!Number.isFinite(d.getTime()))throw new TypeError('valid ISO time required');return d;};
const add=(v,m)=>new Date(iso(v).getTime()+m*60000).toISOString();

export function supportPlan(name){
  const plan=PLANS[String(name||'').toUpperCase()];
  if(!plan) throw new TypeError('unknown support plan');
  return plan;
}

export function computeSlaClock({priority,plan='STANDARD',createdAt}){
  const p=PRIORITY[String(priority||'').toUpperCase()];
  if(!p) throw new TypeError('unknown priority');
  const ent=supportPlan(plan);
  const created=iso(createdAt).toISOString();
  return Object.freeze({
    schema:'musitu.axiom.support-sla-clock.v1',priority:String(priority).toUpperCase(),plan:String(plan).toUpperCase(),
    created_at:created,ack_due_at:add(created,p.ack),update_due_at:add(created,p.update),resolve_target_at:add(created,p.resolve),
    contractual:ent.contractual_sla===true
  });
}

export function evaluateSla(clock,{now=new Date().toISOString(),acknowledgedAt=null,lastMeaningfulUpdateAt=null,resolvedAt=null}={}){
  const t=iso(now).getTime(),breaches=[];
  if(!acknowledgedAt&&t>=Date.parse(clock.ack_due_at))breaches.push('ACK');
  const updateBase=lastMeaningfulUpdateAt?Date.parse(lastMeaningfulUpdateAt):Date.parse(clock.created_at);
  const updateWindow=Date.parse(clock.update_due_at)-Date.parse(clock.created_at);
  if(!resolvedAt&&t>=updateBase+updateWindow)breaches.push('UPDATE');
  if(!resolvedAt&&t>=Date.parse(clock.resolve_target_at))breaches.push('RESOLUTION_TARGET');
  return Object.freeze({breaches:Object.freeze(breaches),breached:breaches.length>0,contractual:clock.contractual===true});
}

export function escalationLane({category,surface}={}){
  if(category==='security_report'||surface==='security')return 'SECURITY';
  if(category==='privacy_request'||surface==='privacy_data_rights')return 'PRIVACY';
  if(category==='billing'||surface==='billing_commerce')return 'BILLING';
  if(category==='incident'||surface==='status_incident')return 'INCIDENT';
  if(category==='calculation_dispute'||surface==='quantitative_result')return 'QUANT_ENGINEERING';
  if(category==='access'||surface==='oauth_account')return 'IDENTITY_ACCESS';
  return 'PRODUCT_ENGINEERING';
}

export function validateAttachmentMetadata(input={}){
  const filename=clean(input.filename,180),contentType=clean(input.contentType,120).toLowerCase();
  const bytes=Number(input.bytes),storageKey=clean(input.storageKey,512);
  const errors=[];
  if(!ATTACHMENT_ID.test(String(input.attachmentId||'')))errors.push('attachment id invalid');
  if(!CASE_ID.test(String(input.caseId||'')))errors.push('case id invalid');
  if(!filename||filename.includes('/')||filename.includes('\\')||!SAFE_EXT.test(filename))errors.push('filename/type not allowed');
  if(!SAFE_TYPES.has(contentType))errors.push('content type not allowed');
  if(!Number.isInteger(bytes)||bytes<1||bytes>MAX_ATTACHMENT)errors.push('attachment size invalid');
  if(!HASH.test(String(input.sha256||'')))errors.push('attachment hash invalid');
  if(!/^cases\/AX-[0-9A-HJKMNP-TV-Z]{12}\/AXF-[0-9A-HJKMNP-TV-Z]{16}$/.test(storageKey))errors.push('storage key invalid');
  if(errors.length)return Object.freeze({ok:false,errors:Object.freeze(errors)});
  return Object.freeze({ok:true,value:Object.freeze({
    attachment_id:String(input.attachmentId),case_id:String(input.caseId),filename,content_type:contentType,bytes,sha256:String(input.sha256).toLowerCase(),
    storage_key:storageKey,scan_state:'PENDING',inline_blob_allowed:false
  })});
}

export function validateDiagnostics(input={}){
  const errors=[];
  if(input.consent!==true)errors.push('diagnostic consent required');
  for(const key of Object.keys(input))if(FORBIDDEN_DIAG.test(key))errors.push('forbidden diagnostic field');
  const allowed=['browser','os','app_version','request_id','route','locale','timezone_offset_minutes'];
  const value={consent:true};
  for(const key of allowed)if(input[key]!=null)value[key]=clean(input[key],key==='route'?256:120);
  if(errors.length)return Object.freeze({ok:false,errors:Object.freeze(errors)});
  return Object.freeze({ok:true,value:Object.freeze(value)});
}

export function normalizeLanguage(value){
  const raw=String(value||'').trim().toLowerCase();
  const base=raw.split(/[-_]/)[0];
  return LANGS.has(base)?base:'und';
}

export function buildTriageEnvelope(input={}){
  if(!CASE_ID.test(String(input.case_id||'')))throw new TypeError('valid case id required');
  return Object.freeze({
    schema:'musitu.axiom.support-triage-envelope.v1',case_id:String(input.case_id),priority:String(input.priority||'P2'),
    category:String(input.category||'bug'),surface:String(input.surface||'web_app'),language:normalizeLanguage(input.language),
    lane:escalationLane(input),advisory_only:true,human_review_required:true
  });
}

export function buildWebhookEvent({type,caseId,state,priority,eventHash,at}){
  if(!/^case\.[a-z_]+$/.test(String(type||''))||!CASE_ID.test(String(caseId||''))||!HASH.test(String(eventHash||'')))throw new TypeError('invalid webhook metadata');
  return Object.freeze({schema:'musitu.axiom.support-webhook-event.v1',type:String(type),case_id:String(caseId),state:String(state||''),priority:String(priority||''),event_hash:String(eventHash).toLowerCase(),created_at:iso(at).toISOString()});
}

export function validateCsat({score,reason}={}){
  const n=Number(score);if(!Number.isInteger(n)||n<1||n>5)return Object.freeze({ok:false,errors:Object.freeze(['score must be 1-5'])});
  return Object.freeze({ok:true,value:Object.freeze({score:n,reason:clean(reason,500)})});
}

export function validateQaReview({quality,policy,accuracy,reviewerRef}={}){
  const vals=[quality,policy,accuracy].map(Number);
  const errors=[];if(vals.some(n=>!Number.isInteger(n)||n<1||n>5))errors.push('QA scores must be 1-5');if(!OPERATOR.test(String(reviewerRef||'')))errors.push('reviewer ref invalid');
  return errors.length?Object.freeze({ok:false,errors:Object.freeze(errors)}):Object.freeze({ok:true,value:Object.freeze({quality:vals[0],policy:vals[1],accuracy:vals[2],reviewer_ref:String(reviewerRef)})});
}

export function createOperatorLease({caseId,operatorRef,at,minutes=10}){
  if(!CASE_ID.test(String(caseId||''))||!OPERATOR.test(String(operatorRef||'')))throw new TypeError('invalid operator lease');
  const m=Number(minutes);if(!Number.isInteger(m)||m<1||m>60)throw new TypeError('invalid lease duration');
  const acquired=iso(at).toISOString();
  return Object.freeze({case_id:String(caseId),operator_ref:String(operatorRef),acquired_at:acquired,expires_at:add(acquired,m)});
}
export function leaseActive(lease,now=new Date().toISOString()){return Date.parse(now)<Date.parse(lease.expires_at);}
