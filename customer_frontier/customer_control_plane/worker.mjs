// Candidate Customer Control Plane API. NOT deployed. No payment capture in ChatGPT.
import {one,all,execute,balance,createOrder,reconcileSettlement,reserve,finishHold,requestRefund,reconcileRefund} from './ledger.mjs';
import {verifyAndEnroll} from './enrollment.mjs';
import {qualifiedLoginRedirect} from './login_broker.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const error=(code,status=400)=>json({ok:false,error:code},status);
const valid=(s,max=160)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const uuid=()=>crypto.randomUUID();
const clean=(e)=>{const message=String(e?.message||'');return /^([a-z_]+)$/.test(message)?message:'operation_not_available'};
async function auth(req,env,db){
 // A separate, qualified identity service owns OIDC, MFA, recovery, secure cookies
 // and ChatGPT OAuth PKCE. Never infer tenant identity from request parameters.
 if(!env.IDENTITY_VERIFIER?.fetch)throw new Error('identity_verifier_unavailable');
 const response=await env.IDENTITY_VERIFIER.fetch(new Request('https://axiom-internal/session/verify',{
  method:'POST',headers:{cookie:req.headers.get('cookie')||'',authorization:req.headers.get('authorization')||'','x-axiom-audience':'customer-control-plane'},
  redirect:'error'
 }));
 if(response.status!==200)throw new Error('authentication_required');
 const p=await response.json();if(!valid(p.issuer,200)||!valid(p.subject,240)||!valid(p.tenant_id,150)||p.audience!=='customer-control-plane'||p.authenticated!==true)throw new Error('identity_verifier_invalid');
 const match=await one(db,`SELECT i.id AS identity_id,m.role,t.id AS tenant_id FROM identities i JOIN memberships m ON m.identity_id=i.id JOIN tenants t ON t.id=m.tenant_id WHERE i.issuer=? AND i.external_sub=? AND m.tenant_id=? AND m.status='active' AND t.status='active'`,p.issuer,p.subject,p.tenant_id);
 if(!match)throw new Error('membership_not_authorized');return match;
}
async function verifiedEvent(req,env){
 // Gateway MUST be a private service-binding ingress after independent provider verification.
 // The public Worker route is disabled even when a token is present.
 if(env.ALLOW_INTERNAL_RECONCILIATION!=='qualified_private_binding')throw new Error('reconciliation_not_qualified');
 if(!env.PROVIDER_VERIFIER?.fetch)throw new Error('provider_verifier_unavailable');
 const raw=await req.text();if(raw.length>12000)throw new Error('payload_too_large');
 const attested=await env.PROVIDER_VERIFIER.fetch(new Request('https://axiom-internal/verify-settlement',{method:'POST',body:raw,headers:{'content-type':'application/json','x-axiom-purpose':'commercial-reconciliation'},redirect:'error'}));
 if(attested.status!==200)throw new Error('provider_not_verified');
 const receipt=await attested.json();if(receipt.verified!==true||receipt.production_qualified!==true||receipt.source!=='provider_verifier')throw new Error('provider_not_qualified');
 return receipt.evidence;
}
async function readBody(req){const size=Number(req.headers.get('content-length')||0);if(size>16000)throw new Error('payload_too_large');const raw=await req.text();if(raw.length>16000)throw new Error('payload_too_large');try{return JSON.parse(raw)}catch{throw new Error('invalid_json')}}
async function getOwnProject(db,tenant,projectId){const row=await one(db,'SELECT * FROM projects WHERE id=? AND tenant_id=?',projectId,tenant);if(!row)throw new Error('project_not_found');return row;}
async function getOwnWork(db,tenant,workId){const row=await one(db,'SELECT * FROM work WHERE id=? AND tenant_id=?',workId,tenant);if(!row)throw new Error('work_not_found');return row;}
export async function handle(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method;const db=env.CUSTOMER_DB;
 if(!db)return error('database_unavailable',503);
 if(path==='/auth/start'&&method==='GET'){try{const location=await qualifiedLoginRedirect(env,{intent:url.searchParams.get('intent')||'login'});return new Response(null,{status:302,headers:{location,'cache-control':'no-store','referrer-policy':'no-referrer'}})}catch(e){return error(clean(e),503)}}
 if(path==='/internal/customer/reconcile'&&method==='POST')return error('private_service_binding_only',403);
 if(path==='/v1/customer/health'&&method==='GET')return json({ok:true,stage:'candidate',payment_live:false,release_qualified:false});
 if(!path.startsWith('/v1/customer/'))return error('not_found',404);
 if(path==='/v1/customer/enroll'&&method==='POST'){
  if(request.headers.get('origin')!==url.origin||request.headers.get('x-axiom-intent')!=='customer-action')return error('csrf_or_origin_rejected',403);
  try{const result=await verifyAndEnroll(request,env,db);return json({ok:true,enrollment:{created:result.created,tenant_id:result.tenant_id}},result.created?201:200)}catch(e){return error(clean(e),403)}
 }
 let user;try{user=await auth(request,env,db);}catch(e){return error(clean(e),clean(e)==='authentication_required'?401:403)}
 if(method!=='GET'&&method!=='HEAD'){const origin=request.headers.get('origin');if(origin!==url.origin||request.headers.get('x-axiom-intent')!=='customer-action')return error('csrf_or_origin_rejected',403);}
 const {identity_id,tenant_id,role}=user;const write=role==='owner'||role==='admin'||role==='member';const billingAdmin=role==='owner'||role==='admin';
 try{
 if(path==='/v1/customer/me'&&method==='GET')return json({ok:true,tenant_id,role,identity_id,credit:billingAdmin?await balance(db,tenant_id):{booked:null,reserved:null,available:null,debt:null},billing_access:billingAdmin,payment_live:false});
 if(path==='/v1/customer/catalog'&&method==='GET'){if(!billingAdmin)return error('billing_role_denied',403);return json({ok:true,products:await all(db,'SELECT id,name,currency,amount_minor,grant_units FROM price_catalog WHERE enabled=1 ORDER BY amount_minor')});}
 if(path==='/v1/customer/orders'&&method==='GET'){if(!billingAdmin)return error('billing_role_denied',403);return json({ok:true,orders:await all(db,'SELECT id,price_id,amount_minor,currency,grant_units,state,created_at FROM orders WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',tenant_id)});}
 if(path==='/v1/customer/orders'&&method==='POST'){
  if(!billingAdmin)return error('billing_role_denied',403);
  if(env.PAYMENT_CHECKOUT_QUALIFIED!=='true'||!env.CHECKOUT_SERVICE?.fetch)return error('checkout_not_qualified',503);
  const b=await readBody(request);const key=request.headers.get('idempotency-key');
  const order=await createOrder(db,tenant_id,identity_id,b.price_id,key);
  // Idempotent retries for a settled or void order cannot open another checkout.
  if(order.state==='settled')return json({ok:true,order:{id:order.id,state:order.state,amount_minor:order.amount_minor,currency:order.currency,grant_units:order.grant_units},checkout:{available:false}},200);
  if(order.state!=='pending')return error('order_not_payable',409);
  const provider=await env.CHECKOUT_SERVICE.fetch(new Request('https://axiom-internal/payments/create',{
   method:'POST',headers:{'content-type':'application/json','idempotency-key':order.id},
   body:JSON.stringify({order_id:order.id,amount_minor:order.amount_minor,currency:order.currency,tenant_id:tenant_id}),redirect:'error'}));
  if(provider.status!==201)return error('payment_service_unavailable',503);
  const result=await provider.json();const target=String(result.checkout_url||'');
  let checkoutUrl;try{checkoutUrl=new URL(target)}catch{return error('invalid_checkout_destination',503)}
  if(checkoutUrl.origin!=='https://payments.mftintelligence.com'||checkoutUrl.username||checkoutUrl.password)return error('invalid_checkout_destination',503);
  return json({ok:true,order:{id:order.id,state:order.state,amount_minor:order.amount_minor,currency:order.currency,grant_units:order.grant_units},checkout:{available:true,url:checkoutUrl.href}},202);
 }
 if(path==='/v1/customer/ledger'&&method==='GET'){if(!billingAdmin)return error('billing_role_denied',403);return json({ok:true,credit:await balance(db,tenant_id),entries:await all(db,'SELECT delta,source_key,created_at FROM credit_ledger WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',tenant_id)});}
 if(path==='/v1/customer/invoices'&&method==='GET'){if(!billingAdmin)return error('billing_role_denied',403);return json({ok:true,invoices:await all(db,'SELECT id,order_id,currency,amount_minor,tax_status,issued_at FROM invoices WHERE tenant_id=? ORDER BY issued_at DESC LIMIT 100',tenant_id),disclosure:'Tax invoice issuance requires jurisdiction-specific independent validation.'});}
 if(path==='/v1/customer/refunds'&&method==='GET'){if(!billingAdmin)return error('billing_role_denied',403);return json({ok:true,refunds:await all(db,'SELECT id,order_id,amount_minor,reason,state,created_at FROM refund_requests WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',tenant_id)});}
 if(path==='/v1/customer/refunds'&&method==='POST'){if(!billingAdmin)return error('billing_role_denied',403);const b=await readBody(request);const out=await requestRefund(db,tenant_id,identity_id,b.order_id,b.amount_minor,b.reason,request.headers.get('idempotency-key'));return json({ok:true,refund:{id:out.id,state:out.state,amount_minor:out.amount_minor},note:'Refund request recorded; no provider refund executed.'},202);}
 if(path==='/v1/customer/projects'&&method==='GET')return json({ok:true,projects:await all(db,'SELECT id,name,objective,created_at FROM projects WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',tenant_id)});
 if(path==='/v1/customer/projects'&&method==='POST'){if(!write)return error('role_denied',403);const b=await readBody(request);if(!valid(b.name,120)||!valid(b.objective,4000))return error('invalid_project');const pid=uuid();await execute(db,'INSERT INTO projects(id,tenant_id,name,objective,created_by) VALUES(?,?,?,?,?)',pid,tenant_id,b.name,b.objective,identity_id);return json({ok:true,project:{id:pid,name:b.name,objective:b.objective}},201);}
 if(path==='/v1/customer/work'&&method==='GET'){const projectId=url.searchParams.get('project');if(!projectId)return error('project_required');await getOwnProject(db,tenant_id,projectId);return json({ok:true,work:await all(db,'SELECT id,project_id,title,desired_outcome,state,created_at FROM work WHERE tenant_id=? AND project_id=?',tenant_id,projectId)});}
 if(path==='/v1/customer/work'&&method==='POST'){if(!write)return error('role_denied',403);const b=await readBody(request);await getOwnProject(db,tenant_id,b.project_id);if(!valid(b.title,160)||!valid(b.desired_outcome,5000))return error('invalid_work');const wid=uuid();await execute(db,'INSERT INTO work(id,tenant_id,project_id,title,desired_outcome,created_by) VALUES(?,?,?,?,?,?)',wid,tenant_id,b.project_id,b.title,b.desired_outcome,identity_id);return json({ok:true,work:{id:wid,state:'draft'}},201);}
 if(path==='/v1/customer/evidence'&&method==='GET'){const workId=url.searchParams.get('work');if(!workId)return error('work_required');await getOwnWork(db,tenant_id,workId);return json({ok:true,evidence:await all(db,'SELECT id,work_id,artifact_id,claim,evidence_sha256,verifier_subject,created_at FROM evidence WHERE tenant_id=? AND work_id=?',tenant_id,workId)});}
 if(path==='/v1/customer/artifacts'&&method==='GET'){const workId=url.searchParams.get('work');if(!workId)return error('work_required');await getOwnWork(db,tenant_id,workId);return json({ok:true,artifacts:await all(db,'SELECT id,work_id,kind,sha256,evidence_state FROM artifacts WHERE tenant_id=? AND work_id=?',tenant_id,workId)});}
 if(path==='/v1/customer/agents'&&method==='GET'){const workId=url.searchParams.get('work');if(!workId)return error('work_required');await getOwnWork(db,tenant_id,workId);return json({ok:true,agents:await all(db,'SELECT id,work_id,principal,scope,budget_units,status FROM agents WHERE tenant_id=? AND work_id=?',tenant_id,workId)});}
 return error('not_found',404);
 }catch(e){return error(clean(e),clean(e).includes('not_found')?404:409);}
}
export {verifiedEvent}; // Internal-use only: do not mount public route.
export default {fetch:handle};
