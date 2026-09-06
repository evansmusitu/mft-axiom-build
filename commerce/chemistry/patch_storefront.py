from pathlib import Path
import hashlib,re

ROOT=Path(__file__).resolve().parent
BASE=ROOT/'index.base.mjs'
OUT=ROOT/'index.storefront-v3.mjs'
EXPECTED_BASE='848e1cec17ec580822d36e595196cda5978713849e8b45c5bc8dc7fcf9765db8'

base=BASE.read_bytes()
actual=hashlib.sha256(base).hexdigest()
if actual!=EXPECTED_BASE:
    raise SystemExit(f'base Worker hash mismatch: {actual}')
s=base.decode()
marker='function checkoutPage(plan,deviceId){'
if s.count(marker)!=1:
    raise SystemExit('checkout marker mismatch')

parts=[]
for name in ['content.mjs','recommend.mjs','assets.mjs','render.mjs']:
    text=(ROOT/'storefront'/name).read_text()
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    text=text.replace('export const ','const ').replace('export function ','function ')
    parts.append(f'// storefront/{name}\n{text.strip()}\n')

helpers=r"""
function planViewsFromCore(){
  const out={};
  for(const [id,p] of Object.entries(PLANS)){
    if(id==='school'){
      const q=quote('school',1);
      out[id]={id,label:p.label,price:`from US$${money(q.amount_cents)}/year`,term:'12 months',scope:'volume seats'};
    }else{
      const q=quote(id);
      out[id]={id,label:p.label,price:`US$${money(q.amount_cents)}`,term:q.months===null?'One-time':`${q.months} months`,scope:q.seats===1?'1 device':`up to ${q.seats} devices`};
    }
  }
  return out;
}
"""

bundle='const STOREFRONT=(()=>{\n'+''.join(parts)+helpers+r"""
return {RELEASE,STOREFRONT_CSS,STOREFRONT_JS,recommendPlan,renderStorefront,renderPlanDecision,renderVerifyRelease,renderReleaseNotes,renderSupport,renderPrivacy,renderTerms,renderSitemapXml,renderSecurityText,renderCheckout,renderSeatClaim,renderPaymentStatus,planViewsFromCore};
})();
"""

public_helpers=r"""
const STOREFRONT_PUBLIC_HEADERS={
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'DENY',
  'permissions-policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy':"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'none'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
function storefrontHtml(body,status=200,extra={}){return new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300',...STOREFRONT_PUBLIC_HEADERS,...extra}})}
function storefrontAsset(body,type){return new Response(body,{status:200,headers:{'content-type':type,'cache-control':'public, max-age=86400','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'}})}
function storefrontXml(body){return new Response(body,{status:200,headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'}})}
function storefrontText(body){return new Response(body,{status:200,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'}})}
function storefrontQuery(u){return Object.fromEntries(u.searchParams.entries())}
function checkoutPageV3(plan,deviceId){let q;try{q=quote(plan,plan==='school'?1:null)}catch{return storefrontHtml('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unknown plan</title></head><body><main id="main"><h1>Unknown plan</h1><p><a href="/chemistry/plans">Return to plans</a></p></main></body></html>',400)}const price=plan==='school'?'from US$100 / year':`US$${money(q.amount_cents)}`;const scope=plan==='school'?'volume seats':q.months===null?'One-time · 1 device':`${q.months} months · ${q.seats===1?'1 device':`up to ${q.seats} devices`}`;return storefrontHtml(STOREFRONT.renderCheckout({planId:plan,planLabel:PLANS[plan].label,price,scope,deviceId,isSchool:plan==='school'}),200,{'cache-control':'no-store'})}
function claimPageV3(){return storefrontHtml(STOREFRONT.renderSeatClaim(),200,{'cache-control':'no-store'})}
async function returnPageV3(req,env,u){const reference=String(u.searchParams.get('reference')||'');const intent=reference?await orderByReference(env,reference):null;if(!intent)return storefrontHtml('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Order not found</title></head><body><main id="main"><h1>Order not found</h1><p><a href="/chemistry/support">Open support</a></p></main></body></html>',404,{'cache-control':'no-store'});if(intent.status!=='paid'&&intent.poll_url){try{await confirmIntent(env,intent)}catch{}}const fresh=await orderByReference(env,reference);const cv=cookieValue(req,'mchem_checkout'),dot=cv.indexOf('.'),cookieRef=dot>0?cv.slice(0,dot):'',secret=dot>0?cv.slice(dot+1):'';let authorised=false;if(cookieRef===reference&&secret)authorised=(await sha256Hex(secret))===fresh.client_secret_sha256;let token=null;if(authorised&&fresh.status==='paid'){const seat=await env.CHEMISTRY_DB.prepare("SELECT licence_token FROM chemistry_seats WHERE reference=?1 AND seat_no=1").bind(reference).first();token=seat?.licence_token||null}return storefrontHtml(STOREFRONT.renderPaymentStatus({status:fresh.status,token,reference,secret:authorised?secret:'',seats:Number(fresh.seats)||1}),200,{'cache-control':'no-store'})}
"""

s=s.replace(marker,bundle+'\n'+public_helpers+'\n'+marker)

old="export async function handleRequest(req,env){const u=new URL(req.url),p=u.pathname;if(req.method==='GET'&&p==='/chemistry/healthz')return health(env);"
new="export async function handleRequest(req,env){const u=new URL(req.url),p=u.pathname;if(req.method==='GET'&&(p==='/chemistry'||p==='/chemistry/'))return storefrontHtml(STOREFRONT.renderStorefront({plans:STOREFRONT.planViewsFromCore()}));if(req.method==='GET'&&p==='/chemistry/plans')return storefrontHtml(STOREFRONT.renderPlanDecision({plans:STOREFRONT.planViewsFromCore(),query:storefrontQuery(u)}));if(req.method==='GET'&&p==='/chemistry/verify')return storefrontHtml(STOREFRONT.renderVerifyRelease());if(req.method==='GET'&&p==='/chemistry/releases')return storefrontHtml(STOREFRONT.renderReleaseNotes());if(req.method==='GET'&&p==='/chemistry/support')return storefrontHtml(STOREFRONT.renderSupport());if(req.method==='GET'&&p==='/chemistry/privacy')return storefrontHtml(STOREFRONT.renderPrivacy());if(req.method==='GET'&&p==='/chemistry/terms')return storefrontHtml(STOREFRONT.renderTerms());if(req.method==='GET'&&p==='/chemistry/sitemap.xml')return storefrontXml(STOREFRONT.renderSitemapXml());if(req.method==='GET'&&p==='/chemistry/security.txt')return storefrontText(STOREFRONT.renderSecurityText());if(req.method==='GET'&&p==='/chemistry/assets/storefront.css')return storefrontAsset(STOREFRONT.STOREFRONT_CSS,'text/css; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/assets/storefront.js')return storefrontAsset(STOREFRONT.STOREFRONT_JS,'application/javascript; charset=utf-8');if(req.method==='GET'&&p==='/chemistry/healthz')return health(env);"
if s.count(old)!=1:
    raise SystemExit('dispatch marker mismatch')
s=s.replace(old,new,1)
s=s.replace("if(req.method==='GET'&&p==='/chemistry/checkout/start')return checkoutPage(String(u.searchParams.get('plan')||''),String(u.searchParams.get('device_id')||''));","if(req.method==='GET'&&p==='/chemistry/checkout/start')return checkoutPageV3(String(u.searchParams.get('plan')||''),String(u.searchParams.get('device_id')||''));",1)
s=s.replace("if(req.method==='GET'&&p==='/chemistry/return')return returnPage(req,env,u);","if(req.method==='GET'&&p==='/chemistry/return')return returnPageV3(req,env,u);",1)
s=s.replace("if(req.method==='GET'&&p==='/chemistry/claim')return claimPage();","if(req.method==='GET'&&p==='/chemistry/claim')return claimPageV3();",1)
OUT.write_text(s)
print(hashlib.sha256(OUT.read_bytes()).hexdigest())
