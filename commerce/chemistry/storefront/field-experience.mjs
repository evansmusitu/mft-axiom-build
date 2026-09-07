import {GROWTH_SOURCES,normalizeGrowthSource} from './rescue-growth.mjs';

export const FIELD_MIN_PUBLIC_SAMPLE=100;
export const FIELD_SCHEMA_SQL=`CREATE TABLE IF NOT EXISTS chemistry_field_aggregate(
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  route TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  viewport TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,kind,name,route,detail,viewport,bucket)
)`;

const ROUTE_CLASSES=new Map([
  ['/chemistry','home'],['/chemistry/','home'],['/chemistry/plans','plans'],['/chemistry/checkout/start','checkout'],
  ['/chemistry/return','status'],['/chemistry/claim','claim'],['/chemistry/support','support'],['/chemistry/privacy','privacy'],
  ['/chemistry/terms','terms'],['/chemistry/verify','verify'],['/chemistry/releases','releases'],['/chemistry/experience','experience'],['/chemistry/rescue','rescue']
]);
const VITALS=new Set(['LCP','INP','CLS']);
const EVENTS=new Set(['page_view','start_free','unlock_full','families_institutions','plan_recommend','plan_choose','checkout_continue','support_contact','seat_claim','status_paid','status_pending','rescue_visit','rescue_start','rescue_share','rescue_peer_start','premium_intent','teacher_kit','school_kit','ambassador_kit']);
const ROUTES=new Set(['home','plans','checkout','status','claim','support','privacy','terms','verify','releases','experience','rescue','other']);
const VIEWPORTS=new Set(['mobile','tablet','desktop']);
const PLAN_DETAILS=new Set(['term','annual','lifetime','family','tutor','school']);
const GROWTH_DETAILS=new Set(GROWTH_SOURCES);
const PLAN_DETAIL_EVENTS=new Set(['plan_choose','checkout_continue']);
const GROWTH_DETAIL_EVENTS=new Set(['rescue_visit','rescue_start','rescue_share','rescue_peer_start','premium_intent','teacher_kit','school_kit','ambassador_kit']);
const EXPECTED_ORIGIN='https://payments.mftintelligence.com';
const MAX_EVENTS=16;

export function routeClass(pathname=''){
  return ROUTE_CLASSES.get(String(pathname))||'other';
}

export function viewportBucket(width){
  const n=Number(width);
  if(!Number.isFinite(n)||n<600)return 'mobile';
  if(n<900)return 'tablet';
  return 'desktop';
}

export function quantizeMetric(name,value){
  const n=Number(value);
  if(!VITALS.has(String(name))||!Number.isFinite(n)||n<0)return null;
  if(name==='CLS')return Math.min(2,Math.round(n*100)/100);
  return Math.min(10000,Math.round(n/25)*25);
}

function exactKeys(obj,allowed){
  const keys=Object.keys(obj||{});
  return keys.every(k=>allowed.has(k));
}

async function normalizeTelemetryBatchImpl(req){
  const origin=req.headers.get('origin')||'';
  const fetchSite=req.headers.get('sec-fetch-site')||'';
  if(origin!==EXPECTED_ORIGIN && !(origin===''&&fetchSite==='same-origin'))throw new Error('origin');
  const type=(req.headers.get('content-type')||'').toLowerCase();
  if(!type.startsWith('application/json'))throw new Error('content-type');
  const len=Number(req.headers.get('content-length')||0);
  if(Number.isFinite(len)&&len>4096)throw new Error('body-too-large');
  const body=await req.json();
  if(!body||!exactKeys(body,new Set(['events']))||!Array.isArray(body.events)||body.events.length<1||body.events.length>MAX_EVENTS)throw new Error('batch');
  const out=[];
  for(const raw of body.events){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||!exactKeys(raw,new Set(['kind','name','value','route','viewport','detail'])))throw new Error('shape');
    const kind=String(raw.kind||'');
    const name=String(raw.name||'');
    const route=String(raw.route||'');
    const viewport=String(raw.viewport||'');
    const detail=String(raw.detail||'');
    if(!ROUTES.has(route)||!VIEWPORTS.has(viewport))throw new Error('dimension');
    if(kind==='vital'){
      if(!VITALS.has(name)||detail!=='')throw new Error('vital');
      const q=quantizeMetric(name,raw.value);
      if(q===null)throw new Error('value');
      out.push({kind,name,route,detail:'',viewport,bucket:String(q)});
    }else if(kind==='event'){
      if(!EVENTS.has(name))throw new Error('event');
      if(PLAN_DETAIL_EVENTS.has(name)){
        if(!PLAN_DETAILS.has(detail))throw new Error('detail');
      }else if(GROWTH_DETAIL_EVENTS.has(name)){
        if(!GROWTH_DETAILS.has(detail))throw new Error('detail');
      }else if(detail!=='')throw new Error('detail');
      out.push({kind,name,route,detail,viewport,bucket:'1'});
    }else throw new Error('kind');
  }
  return out;
}
export function normalizeTelemetryBatch(req){return normalizeTelemetryBatchImpl(req)}

let schemaReady=false;
async function ensureFieldSchemaImpl(env){
  if(schemaReady)return;
  if(!env?.CHEMISTRY_DB)throw new Error('database');
  await env.CHEMISTRY_DB.prepare(FIELD_SCHEMA_SQL).run();
  schemaReady=true;
}
export function ensureFieldSchema(env){return ensureFieldSchemaImpl(env)}

async function ingestTelemetryRequestImpl(req,env){
  let events;
  try{events=await normalizeTelemetryBatch(req)}catch{return new Response(null,{status:400,headers:{'cache-control':'no-store'}})}
  try{
    await ensureFieldSchema(env);
    const day=new Date().toISOString().slice(0,10);
    for(const e of events){
      await env.CHEMISTRY_DB.prepare(`INSERT INTO chemistry_field_aggregate(day,kind,name,route,detail,viewport,bucket,count)
        VALUES(?1,?2,?3,?4,?5,?6,?7,1)
        ON CONFLICT(day,kind,name,route,detail,viewport,bucket) DO UPDATE SET count=count+1`)
        .bind(day,e.kind,e.name,e.route,e.detail,e.viewport,e.bucket).run();
    }
    return new Response(null,{status:204,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch{
    return new Response(null,{status:503,headers:{'cache-control':'no-store','retry-after':'60'}});
  }
}
export function ingestTelemetryRequest(req,env){return ingestTelemetryRequestImpl(req,env)}

function rating(name,value){
  if(name==='LCP')return value<=2500?'good':value<=4000?'needs-improvement':'poor';
  if(name==='INP')return value<=200?'good':value<=500?'needs-improvement':'poor';
  if(name==='CLS')return value<=0.1?'good':value<=0.25?'needs-improvement':'poor';
  return 'unknown';
}

export function computeFieldSnapshot(rows=[],minimumSample=FIELD_MIN_PUBLIC_SAMPLE){
  const metrics={};
  for(const name of ['LCP','INP','CLS']){
    const buckets=rows.filter(r=>String(r.name)===name).map(r=>({bucket:Number(r.bucket),count:Number(r.count)||0})).filter(r=>Number.isFinite(r.bucket)&&r.count>0).sort((a,b)=>a.bucket-b.bucket);
    const sample=buckets.reduce((a,b)=>a+b.count,0);
    const target=Math.ceil(sample*.75);
    let cumulative=0,p75=null;
    for(const b of buckets){cumulative+=b.count;if(cumulative>=target&&sample>0){p75=b.bucket;break}}
    const claimable=sample>=minimumSample&&p75!==null;
    metrics[name]={sample,p75:claimable?p75:null,rating:claimable?rating(name,p75):'withheld',claimable};
  }
  const claimableCount=Object.values(metrics).filter(m=>m.claimable).length;
  return {schema:'musitu.chemistry.field_experience.snapshot.v1',window_days:28,minimum_public_sample:minimumSample,status:claimableCount===3?'field_core_web_vitals_available':'insufficient_field_sample',metrics};
}

async function readFieldSnapshotImpl(env,minimumSample=FIELD_MIN_PUBLIC_SAMPLE){
  try{
    const result=await env.CHEMISTRY_DB.prepare(`SELECT name,bucket,SUM(count) AS count FROM chemistry_field_aggregate WHERE kind='vital' AND day>=date('now','-27 day') GROUP BY name,bucket ORDER BY name,CAST(bucket AS REAL)`).all();
    return computeFieldSnapshot(result?.results||[],minimumSample);
  }catch{
    return computeFieldSnapshot([],minimumSample);
  }
}
export function readFieldSnapshot(env,minimumSample=FIELD_MIN_PUBLIC_SAMPLE){return readFieldSnapshotImpl(env,minimumSample)}

export function renderExperience(snapshot){
  const fmt=(name,m)=>m.claimable?`${name}: p75 ${name==='CLS'?m.p75:Number(m.p75).toFixed(0)+(name==='LCP'||name==='INP'?' ms':'')} · ${m.rating} · n=${m.sample}`:`${name}: field result withheld · n=${m.sample} / ${snapshot.minimum_public_sample} required`;
  const cards=['LCP','INP','CLS'].map(name=>`<section class="verify-card"><h2>${name}</h2><p>${fmt(name,snapshot.metrics[name])}</p></section>`).join('');
  const status=snapshot.status==='field_core_web_vitals_available'?'<strong>Field Core Web Vitals available</strong>':'<strong>Collecting evidence — insufficient field sample for a public p75 claim.</strong>';
  const body=`<main id="main" tabindex="-1" class="page-shell"><div class="wrap"><div class="breadcrumbs"><a href="/chemistry/">Chemistry Mastery</a> / Experience evidence</div><h1>Real-user experience evidence</h1><p class="intro">MUSITU publishes only aggregate 28-day Core Web Vitals after each metric reaches the minimum public sample. Individual visits are not stored as analytics rows.</p><div class="notice">${status}</div><div class="verify-grid">${cards}</div><section class="panel"><h2>Measurement boundary</h2><ul class="checklist"><li>No analytics cookies or persistent tracking identifier.</li><li>No IP address, email, Device ID, payment reference, licence token, referrer or URL query string is stored in the field aggregate.</li><li>Metric values are rounded into histogram buckets before storage.</li><li>Global Privacy Control and Do Not Track suppress browser reports.</li><li>Public p75 values are withheld below n=${snapshot.minimum_public_sample} per metric.</li></ul><p><a href="/chemistry/privacy">Privacy and browser measurement control</a></p></section></div></main>`;
  return shell({title:`Experience evidence · ${PRODUCT.name}`,description:'Aggregate real-user Core Web Vitals evidence for the MUSITU Chemistry storefront.',body});
}

export const FIELD_EXPERIENCE_JS=String.raw`
(()=>{
  const KEY='musitu_experience_measurement';
  const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const privacySignal=()=>navigator.globalPrivacyControl===true||['1','yes'].includes(String(navigator.doNotTrack||window.doNotTrack||'').toLowerCase());
  const pref=()=>{try{return localStorage.getItem('musitu_experience_measurement')||''}catch{return ''}};
  const route=()=>{const p=location.pathname;return p==='/chemistry'||p==='/chemistry/'?'home':p==='/chemistry/plans'?'plans':p==='/chemistry/checkout/start'?'checkout':p==='/chemistry/return'?'status':p==='/chemistry/claim'?'claim':p==='/chemistry/support'?'support':p==='/chemistry/privacy'?'privacy':p==='/chemistry/terms'?'terms':p==='/chemistry/verify'?'verify':p==='/chemistry/releases'?'releases':p==='/chemistry/experience'?'experience':p==='/chemistry/rescue'?'rescue':'other'};
  const viewport=()=>innerWidth<600?'mobile':innerWidth<900?'tablet':'desktop';
  const allowedPlan=v=>['term','annual','lifetime','family','tutor','school'].includes(v)?v:'';
  const allowedSource=v=>['wa_student','wa_teacher','school','creator','meta','tiktok','ambassador','direct'].includes(v)?v:'direct';
  const growthEvents=new Set(['rescue_visit','rescue_start','rescue_share','rescue_peer_start','premium_intent','teacher_kit','school_kit','ambassador_kit']);
  const post=events=>{if(!events.length||privacySignal()||pref()==='off')return false;try{return navigator.sendBeacon('/chemistry/telemetry/v1',new Blob([JSON.stringify({events})],{type:'application/json'}))}catch{return false}};
  const event=(name,detail='')=>{const safe=growthEvents.has(name)?allowedSource(detail):allowedPlan(detail);return post([{kind:'event',name,route:route(),viewport:viewport(),detail:safe}])};
  const state=q('[data-measurement-state]');
  const paintState=()=>{if(!state)return;state.textContent=privacySignal()?'Disabled by your browser privacy signal':pref()==='off'?'Disabled on this browser':'Enabled: anonymous aggregate experience measurement'};
  qa('[data-measurement-toggle]').forEach(btn=>btn.addEventListener('click',()=>{try{if(pref()==='off')localStorage.removeItem(KEY);else localStorage.setItem(KEY,'off');paintState()}catch{}}));
  paintState();
  if(privacySignal()||pref()==='off')return;
  event('page_view');
  qa('[data-field-event]').forEach(el=>{
    const name=el.dataset.fieldEvent||'';
    const detail=el.dataset.fieldDetail||'';
    const type=(el.tagName==='FORM')?'submit':'click';
    el.addEventListener(type,()=>event(name,detail),{passive:true});
  });
  const marker=q('[data-field-status]');
  const auto=marker?.dataset?.fieldStatus||'';
  if(auto==='paid')event('status_paid'); else if(auto==='pending')event('status_pending');
  if(!self.webVitals)return;
  const latest=new Map();
  const keep=m=>{if(['LCP','INP','CLS'].includes(m.name)&&Number.isFinite(m.value))latest.set(m.name,{kind:'vital',name:m.name,value:m.value,route:route(),viewport:viewport(),detail:''})};
  self.webVitals.onLCP(keep);self.webVitals.onINP(keep);self.webVitals.onCLS(keep);
  const flush=()=>{if(latest.size){post([...latest.values()]);latest.clear()}};
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')setTimeout(flush,0)});
  addEventListener('pagehide',flush);
})();
`;
