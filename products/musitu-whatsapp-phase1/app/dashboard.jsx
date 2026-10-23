'use client';
import {useEffect,useRef,useState} from 'react';
import {createScopeFence} from '../src/dashboard/scope-fence.mjs';
import {endBusinessSession} from '../src/dashboard/logout.mjs';
import {loadBookingView} from '../src/dashboard/booking-view.mjs';
import DevelopmentReply from './development-reply.jsx';
import PrivacyReview from './privacy-review.jsx';
const sections=['Overview','Onboarding','Configuration','Conversations','Bookings','Knowledge','Approvals','Channels','Team access','Audit','Operational status'];
export default function Dashboard(){
 const fence=useRef(null);fence.current??=createScopeFence();
 const [conversation,setConversation]=useState(null);
 const [resources,setResources]=useState([]),[selectedResource,setSelectedResource]=useState('');
 const [section,setSection]=useState('Overview'),[tenant,setTenant]=useState(''),[status,setStatus]=useState(null),[records,setRecords]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>()=>fence.current.invalidate(),[]);
 useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('business');if(requested==='986eb904-7296-46a9-9e9b-94074db9b547'){setTenant(requested);setSection('Conversations');}},[]);
 function clearView(){fence.current.invalidate();setRecords(null);setConversation(null);setResources([]);setSelectedResource('');setError('');setBusy(false);}
 async function signOut(event){event.preventDefault();clearView();setBusy(true);try{await endBusinessSession();}catch{setError('Sign out is unavailable.');setBusy(false);}}
 useEffect(()=>{fetch('/api/status',{cache:'no-store'}).then(r=>r.json()).then(setStatus).catch(()=>setError('Status is unavailable'));},[]);
 const kinds={'Configuration':'configuration','Overview':'metrics','Conversations':'conversations','Bookings':'bookings','Knowledge':'knowledge','Approvals':'drafts','Channels':'channels','Team access':'staff','Audit':'audit'};
 async function load(selected=section){
  const ticket=fence.current.begin();setBusy(true);setError('');setRecords(null);setConversation(null);setResources([]);setSelectedResource('');
  try{if(selected==='Bookings'){
    const data=await loadBookingView(tenant);if(!fence.current.current(ticket))return;
    setRecords(data.bookings);setResources(data.resources);return;
   }
   const r=await fetch(`/api/tenants/${encodeURIComponent(tenant)}/${kinds[selected]}`,{cache:'no-store'});
   if(!fence.current.current(ticket))return;
   if(!r.ok)throw Error(r.status===403?'Sign in and select a business you belong to.':'The business service is unavailable.');
   const data=await r.json();if(!fence.current.current(ticket))return;
   if(data.tenantId!==tenant)throw Error('Business response rejected');setRecords(data.data);
  }catch(e){if(fence.current.current(ticket)){setRecords(null);setConversation(null);setResources([]);setSelectedResource('');setError(e.message);}}
  finally{if(fence.current.current(ticket))setBusy(false);}
 }
 async function action(path,body){
  const ticket=fence.current.begin();setBusy(true);setError('');
  try{const r=await fetch(`/api/tenants/${encodeURIComponent(tenant)}/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   if(!fence.current.current(ticket))return;
   if(!r.ok){if(r.status===403){setRecords(null);setConversation(null);setResources([]);setSelectedResource('');}throw Error(r.status===409?'This action conflicts with an existing record.':'Action denied or unavailable.');}
   const data=await r.json();if(!fence.current.current(ticket))return;
   if(data.tenantId!==tenant)throw Error('Business response rejected');await load();
  }catch(e){if(fence.current.current(ticket))setError(e.message);}
  finally{if(fence.current.current(ticket))setBusy(false);}
 }
 async function readConversation(id){
  const ticket=fence.current.begin();setBusy(true);setError('');setConversation(null);
  try{const r=await fetch(`/api/tenants/${encodeURIComponent(tenant)}/messages`,{cache:'no-store'});
   if(!fence.current.current(ticket))return;
   if(!r.ok){if(r.status===403)setRecords(null);throw Error('Message access denied');}
   const data=await r.json();if(!fence.current.current(ticket))return;
   if(data.tenantId!==tenant)throw Error('Business response rejected');
   setConversation({id,messages:data.data.filter(m=>m.conversationId===id)});
  }catch(e){if(fence.current.current(ticket))setError(e.message);}
  finally{if(fence.current.current(ticket))setBusy(false);}
 }
 async function onboard(event){
  event.preventDefault();const ticket=fence.current.begin();setBusy(true);setError('');setRecords(null);setConversation(null);
  const f=new FormData(event.currentTarget);
  try{const r=await fetch('/api/onboard',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({legalName:f.get('name')})});
   if(!fence.current.current(ticket))return;
   if(!r.ok)throw Error('Business onboarding is unavailable or denied');
   const data=await r.json();if(!fence.current.current(ticket))return;
   clearView();setTenant(data.tenantId);setSection('Configuration');
  }catch(e){if(fence.current.current(ticket))setError(e.message);}
  finally{if(fence.current.current(ticket))setBusy(false);}
 }
 return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brandmark">M</span><span>MUSITU <small>WhatsApp AI Employee</small></span></div><nav aria-label="Main navigation">{sections.map(s=><button key={s} className={section===s?'active':'nav-btn'} onClick={()=>{clearView();setSection(s);}}>{s}</button>)}</nav><div className="sidebar-footer">Private staging<p>Customer messaging disabled</p></div></aside>
 <main className="content"><header><div><div className="eyebrow">BUSINESS OPERATIONS</div><h1>Your business, <em>in control.</em></h1><p className="subtitle">Approved knowledge, reliable appointments and accountable human service.</p></div><span className="badge">PRIVATE DEVELOPMENT</span></header>
 <section className="connect"><div><h2>Secure business access</h2><p>{status?.identityConfigured?'Sign in with your business identity.':'Business sign-in is awaiting identity-provider configuration.'}</p></div><a className="login-btn" href="/auth/login">Sign in</a><form action="/auth/logout" method="post" onSubmit={signOut}><button type="submit" disabled={busy}>Sign out</button></form><form onSubmit={e=>{e.preventDefault();load();}}><label>Business identifier<input aria-label="Business identifier" value={tenant} onChange={e=>{clearView();setTenant(e.target.value);}} placeholder="Business UUID" autoComplete="off" required/></label><button type="submit" disabled={busy||!tenant||!status?.identityConfigured}>Open business</button></form></section>
 {error&&<p role="alert" className="panel">{error}</p>}
 <section className="panel"><div className="panel-title"><div><span className="eyebrow">MUSITU EMPLOYEE</span><h2>{section}</h2></div>{kinds[section]&&<button disabled={busy||!tenant||!status?.identityConfigured} onClick={()=>load()}>Refresh</button>}</div>
 {busy&&<p role="status">Loading business records…</p>}
 {section==='Onboarding'?<form className="quick-book" onSubmit={onboard}><label>Legal business name<input name="name" required maxLength={200}/></label><button disabled={busy||!status?.identityConfigured}>Create private business</button></form>:section==='Operational status'?<div className="list">{Object.entries(status||{}).map(([k,v])=><div className="item" key={k}>{k}: {String(v)}</div>)}</div>:!records?<p>Sign in and open your business to see its records.</p>:section==='Overview'?<div className="cards">{[['Inquiries',records.inquiries],['Bookings',records.bookings],['Human handover',records.humanConversations],['Verified revenue','Unavailable']].map(([k,v])=><article key={k}><span>{k}</span><strong>{v}</strong></article>)}</div>:<div className="list">{records.length===0?<p>No records yet.</p>:records.map((r,i)=><article className="item" key={r.conversationId||r.bookingId||r.draftId||r.memberId||r.auditId||r.faq_id||i}>
 {section==='Conversations'?<><strong>{r.conversationId}</strong><button disabled={busy} onClick={()=>readConversation(r.conversationId)}>Read conversation</button><p>{r.mode} {r.suppressed?'· opted out':''}</p><button disabled={busy||r.mode==='HUMAN'} onClick={()=>action(`conversations/${r.conversationId}/handover`,{})}>Hand over</button><button disabled={busy||r.suppressed} onClick={()=>action(`conversations/${r.conversationId}/suppress`,{reason:'CUSTOMER_REQUEST'})}>Record customer opt-out</button></>:section==='Approvals'?<><strong>{r.status}</strong><p>{r.body}</p><small>Approved source: {r.sourceId}</small><button disabled={busy||r.status!=='DRAFT'} onClick={()=>action(`drafts/${r.draftId}/approve`,{approvalKey:crypto.randomUUID()})}>Approve response</button></>:section==='Configuration'?<><strong>{r.timezone}</strong><p>{r.business_description}</p><small>Configuration revision {r.revision}</small></>:section==='Knowledge'?<><strong>{r.normalized_question}</strong><p>{r.answer}</p></>:section==='Team access'?<><strong>{r.memberId}</strong><p>{r.role} · {r.status}</p><button disabled={busy||r.role==='OWNER'||r.status!=='ACTIVE'} onClick={()=>action(`staff/${encodeURIComponent(r.memberId)}/revoke`,{})}>Revoke access</button></>:section==='Bookings'?<><strong>{r.resourceId}</strong><p>{r.startAt} — {r.endAt}</p><small>{r.status}</small></>:section==='Audit'?<p>{r.recordedAt} · {r.action} · {r.referenceId}</p>:<p>{r.phone_number_id} · {r.status}</p>}
 </article>)}</div>}
 {section==='Conversations'&&conversation&&<section aria-label="Conversation messages" className="panel"><h3>Conversation {conversation.id}</h3><button onClick={()=>setConversation(null)}>Close messages</button>{conversation.messages.length===0?<p>No retained message content.</p>:conversation.messages.map(m=><article key={m.messageId}><p>{m.body}</p><button disabled={busy} onClick={()=>action(`conversations/${conversation.id}/ai-draft`,{phoneNumberId:m.phoneNumberId,messageId:m.messageId})}>Suggest approved answer</button><small>Every suggestion needs human approval.</small></article>)}</section>}
 {section==='Conversations'&&conversation&&tenant==='986eb904-7296-46a9-9e9b-94074db9b547'&&conversation.messages.length>0&&<DevelopmentReply key={`${tenant}:${conversation.id}`} tenant={tenant} conversationId={conversation.id} messageId={conversation.messages[0].messageId}/>}
 {section==='Conversations'&&conversation&&tenant==='986eb904-7296-46a9-9e9b-94074db9b547'&&status?.privacyReviewEnabled&&<PrivacyReview key={`privacy:${tenant}:${conversation.id}`} tenant={tenant} conversationId={conversation.id}/>}
 {section==='Configuration'&&<form className="quick-book" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action('configuration',{timezone:f.get('timezone'),description:f.get('description')});}}><label>Business timezone<input name="timezone" defaultValue="Africa/Harare" required/></label><label>Business description<input name="description" required maxLength={2000}/></label><button disabled={busy||!status?.identityConfigured}>Save approved configuration</button></form>}
 {section==='Configuration'&&<form className="quick-book" onSubmit={e=>{e.preventDefault();action('ai-policy',{enabled:new FormData(e.currentTarget).get('enabled')==='on'});}}><label><input type="checkbox" name="enabled"/> Allow staff to request AI draft assistance</label><p>Groq processes the selected customer question and approved knowledge questions. Business answers remain in MUSITU. Every draft requires human approval. Disabled until a business owner enables it.</p><button disabled={busy||!status?.identityConfigured}>Save AI permission</button></form>}
 {section==='Knowledge'&&<form className="quick-book" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action('knowledge',{question:f.get('question'),answer:f.get('answer'),approved:f.get('approved')==='on'});}}><label>Customer question<input name="question" required maxLength={1000}/></label><label>Approved answer<input name="answer" required maxLength={4000}/></label><label><input type="checkbox" name="approved" required/> I approve this business fact</label><button disabled={busy||!status?.identityConfigured}>Publish approved source</button></form>}
 {section==='Team access'&&<form className="quick-book" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action('staff',{memberId:f.get('member'),role:f.get('role')});}}><label>Verified employee identity ID<input name="member" required maxLength={192}/></label><label>Role<select name="role"><option>AGENT</option><option>VIEWER</option><option>ADMIN</option></select></label><button disabled={busy||!status?.identityConfigured}>Grant business membership</button></form>}
 {section==='Bookings'&&<form className="quick-book" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action('resources',{label:f.get('label')});}}><label>New appointment resource<input name="label" required maxLength={200}/></label><button disabled={busy||!records||!status?.identityConfigured}>Create resource</button></form>}
 {section==='Bookings'&&<form className="quick-book" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action('bookings',{resourceId:f.get('resource'),startAt:new Date(f.get('start')).toISOString(),endAt:new Date(f.get('end')).toISOString(),effectKey:crypto.randomUUID()});}}><label>Appointment resource<select name="resource" value={selectedResource} onChange={e=>setSelectedResource(e.target.value)} disabled={busy||!records||resources.length===0} required><option value="">{resources.length?'Choose a resource':'Open your business and create a resource'}</option>{resources.map(r=><option key={r.resource_id} value={r.resource_id}>{r.label}</option>)}</select></label><label>Start<input name="start" type="datetime-local" required/></label><label>End<input name="end" type="datetime-local" required/></label><button disabled={busy||!selectedResource||!records||!status?.identityConfigured}>Reserve appointment</button></form>}
 </section><footer>© MUSITU · Private qualification · Phase 1 acceptance remains open</footer></main></div>;
}
