// Private qualification dashboard. JWT is held in RAM, never stored or sent to another origin.
import {createDraftReviewClient} from '/review-actions.js';
const $=id=>document.getElementById(id);
let session=null;
function invalidateOnDenied(current,response,{allowForbidden=false}={}){
 if((response.status===401||(response.status===403&&!allowForbidden))&&session===current){
  session=null;$('token').value='';$('tenant').value='';
  clearDisplay('Access ended — authentication or tenant membership was denied.');
  $('disconnect-btn').disabled=true;
 }
}
const reviewClient=createDraftReviewClient({getSession:()=>session,
 fetchImpl:async(path,opts)=>{const current=session;const response=await fetch(path,opts);
  invalidateOnDenied(current,response);return response;}});
function line(text,cls='item'){const el=document.createElement('div');el.className=cls;el.textContent=text;return el;}
function show(id,items,display){const el=$(id);el.replaceChildren();if(!items.length){el.append(line('No records recorded'));return;}for(const item of items)el.append(line(display(item)));}
function clearDisplay(message){
 $('inquiries').textContent='—';$('booking-count').textContent='—';$('human-count').textContent='—';$('revenue').textContent='Unavailable';
 $('booking-rows').replaceChildren();$('conversation-list').replaceChildren();$('draft-list').replaceChildren();$('staff-list').replaceChildren();$('audit-list').replaceChildren();
 $('booking-rows').append(Object.assign(document.createElement('tr'),{textContent:'Connect to view reservations'}));
 $('conversation-list').append(line('Connect to view messages'));
 $('draft-list').append(line('Connect to view drafts'));$('staff-list').append(line('Connect to view staff'));$('audit-list').append(line('Connect to view audit'));
 $('draft-action-status').textContent='No real WhatsApp messages can be sent from this console.';
 $('connection-state').textContent=message;
}
async function read(current,kind,{allowForbidden=false}={}){
 const response=await fetch(`/v1/tenants/${encodeURIComponent(current.tenant)}/${kind}`,{
  method:'GET',headers:{authorization:`Bearer ${current.token}`},credentials:'omit',redirect:'error',cache:'no-store'});
 invalidateOnDenied(current,response,{allowForbidden});
 if(!response.ok)throw new Error(`Request denied (${response.status})`);
 return response.json();
}
function actionButton(label,disabled,fn){
 const button=document.createElement('button');button.type='button';button.className='handover';button.textContent=label;button.disabled=disabled;
 button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(error){$('draft-action-status').textContent=error.message;}finally{if(button.isConnected)button.disabled=disabled;}});
 return button;
}
async function refresh(){
 const current=session;if(!current)return;
 const [stats,bookings,convos,drafts,capabilities]=await Promise.all(['metrics','bookings','conversations','drafts','capabilities'].map(kind=>read(current,kind)));
 // A slow response for tenant A may not repaint tenant B after a session switch.
 if(session!==current)return;
 if([bookings,convos,drafts,capabilities].some(x=>x.tenantId!==current.tenant)||stats.tenantId!==current.tenant)throw Error('TENANT_RESPONSE_MISMATCH');
 $('inquiries').textContent=String(stats.inquiries);$('booking-count').textContent=String(stats.bookings);
 $('human-count').textContent=String(stats.humanConversations);$('revenue').textContent='Not verified';
 const body=$('booking-rows');body.replaceChildren();
 for(const b of bookings.bookings){const row=document.createElement('tr');for(const value of [b.resourceId,b.startAt,b.endAt,b.status]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}body.append(row);}
 if(!bookings.bookings.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.textContent='No bookings';row.append(cell);body.append(row);}
 const list=$('conversation-list');list.replaceChildren();
 if(!convos.conversations.length)list.append(line('No conversations recorded'));
 for(const c of convos.conversations){
  const container=document.createElement('div');container.className='item';
  const label=document.createElement('span');label.textContent=`${c.conversationId.slice(0,14)}… · ${c.mode}${c.suppressed?' · OPTED OUT — automation disabled':''}`;container.append(label);
  const btn=actionButton('Hand over',c.mode==='HUMAN',async()=>{
   if(session!==current)return;
   const resp=await fetch(`/v1/tenants/${encodeURIComponent(current.tenant)}/conversations/${encodeURIComponent(c.conversationId)}/handover`,
    {method:'POST',headers:{authorization:`Bearer ${current.token}`,'content-type':'application/json'},credentials:'omit',redirect:'error',body:'{}'});
   invalidateOnDenied(current,resp);
   if(!resp.ok)throw Error(`Handover denied (${resp.status})`);
   await refresh();
  });container.append(btn);
  if(!c.suppressed)container.append(actionButton('Record opt-out',false,async()=>{
   if(session!==current)return;
   const response=await fetch(`/v1/tenants/${encodeURIComponent(current.tenant)}/conversations/${encodeURIComponent(c.conversationId)}/suppress`,{
    method:'POST',headers:{authorization:`Bearer ${current.token}`,'content-type':'application/json'},
    credentials:'omit',redirect:'error',body:JSON.stringify({reason:'CUSTOMER_REQUEST'})
   });
   invalidateOnDenied(current,response);
   if(!response.ok)throw Error(`Suppression denied (${response.status})`);
   if(session!==current)return;
   $('draft-action-status').textContent='Customer opt-out recorded; automatic replies are disabled.';
   await refresh();
  }));
  list.append(container);
 }
 const draftList=$('draft-list');draftList.replaceChildren();
 if(!drafts.drafts.length)draftList.append(line('No prepared drafts'));
 for(const d of drafts.drafts){
  const container=document.createElement('div');container.className='item';
  container.append(line(`${d.status} · ${d.body}`));
  if(capabilities.review&&d.status==='DRAFT')container.append(actionButton('Approve offline',false,async()=>{
   if(session!==current)return;
   await reviewClient.approve(d.draftId);
   if(session!==current)return;
   $('draft-action-status').textContent='Draft approved for offline preparation; no message sent.';await refresh();
  }));
  if(capabilities.stageOffline&&d.status==='APPROVED_OFFLINE')container.append(actionButton('Stage offline',false,async()=>{
   if(session!==current)return;
   await reviewClient.stageOffline(d.draftId);
   if(session!==current)return;
   $('draft-action-status').textContent='Offline preparation recorded; provider delivery remains disabled.';await refresh();
  }));
  draftList.append(container);
 }
 if(!capabilities.review)$('draft-action-status').textContent='This stage database has no approval operations; sending disabled.';
 // Membership changes are scoped to the same session; errors never expose
 // membership lists to unrelated tenants or other roles.
 try{
  const staff=await read(current,'staff',{allowForbidden:true});
  if(session!==current)return;
  if(staff.tenantId!==current.tenant||!Array.isArray(staff.members))throw Error('TENANT_RESPONSE_MISMATCH');
  const staffList=$('staff-list');staffList.replaceChildren();
  for(const member of staff.members){
   const row=document.createElement('div');row.className='item';
   row.append(line(`${member.memberId} · ${member.role} · ${member.status}`));
   if(member.role!=='OWNER'&&member.status==='ACTIVE')row.append(actionButton('Revoke access',false,async()=>{
    if(session!==current)return;
    const resp=await fetch(`/v1/tenants/${encodeURIComponent(current.tenant)}/staff/${encodeURIComponent(member.memberId)}/revoke`,{
     method:'POST',headers:{authorization:`Bearer ${current.token}`,'content-type':'application/json'},
     credentials:'omit',redirect:'error',body:'{}'});
    invalidateOnDenied(current,resp);
    if(!resp.ok)throw Error(`Revocation denied (${resp.status})`);
    if(session!==current)return;
    $('staff-status').textContent='Membership revoked; existing bearer tokens lose local application access.';
    await refresh();
   }));
   staffList.append(row);
  }
  if(!staff.members.length)staffList.append(line('No staff found'));
 }catch(error){
  if(session===current){$('staff-list').replaceChildren();$('staff-list').append(line('Team access restricted or unavailable'));}
 }
 $('disconnect-btn').disabled=false;
 $('connection-state').textContent=`Connected to ${current.tenant} · tenant scoped · no external sends`;
 try{
  const audit=await read(current,'audit',{allowForbidden:true});
  if(session!==current)return;
  if(audit.tenantId!==current.tenant||!Array.isArray(audit.events))throw Error('TENANT_RESPONSE_MISMATCH');
  show('audit-list',audit.events.slice(-30),e=>`${e.recordedAt} · ${e.action} · ${e.referenceId}`);
 }catch{
  if(session===current){$('audit-list').replaceChildren();$('audit-list').append(line('Action audit restricted or unavailable'));}
 }
}
$('connect-form').addEventListener('submit',async event=>{
 event.preventDefault();const tenant=$('tenant').value.trim(),token=$('token').value.trim();
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(tenant)||!token){$('connection-state').textContent='Invalid tenant or token';return;}
 session={tenant,token};$('token').value='';clearDisplay('Authenticating...');
 const current=session;
 try{await refresh();}catch(error){if(session===current){session=null;clearDisplay(error.message);$('disconnect-btn').disabled=true;}}
});
$('disconnect-btn').addEventListener('click',()=>{
 session=null;$('token').value='';$('tenant').value='';clearDisplay('Disconnected; previous business data cleared.');$('disconnect-btn').disabled=true;
});
$('booking-form').addEventListener('submit',async event=>{
 event.preventDefault();const current=session;if(!current){$('booking-status').textContent='Connect first';return;}
 try{
  const resourceId=$('resource').value.trim();
  const startAt=new Date($('booking-start').value).toISOString();
  const endAt=new Date($('booking-end').value).toISOString();
  const effectKey=`private-ui-${crypto.randomUUID()}`;
  const response=await fetch(`/v1/tenants/${encodeURIComponent(current.tenant)}/bookings`,{
   method:'POST',headers:{authorization:`Bearer ${current.token}`,'content-type':'application/json'},
   credentials:'omit',redirect:'error',body:JSON.stringify({resourceId,startAt,endAt,effectKey})
  });
  invalidateOnDenied(current,response);
  if(!response.ok)throw Error(`Booking not accepted (${response.status})`);
  if(session!==current)return;
  $('booking-status').textContent='Private-stage booking recorded; no customer notification sent.';await refresh();
 }catch(error){if(session===current)$('booking-status').textContent=error.message;}
});
