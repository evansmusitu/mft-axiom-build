import {createMailbox} from './model.mjs';
const seed=[
{id:'m1',from:'MFT Product Team (sample)',to:'demo@example.invalid',subject:'Welcome to your new workspace',body:'Explore the inbox, compose a draft, and organize your sample messages. This is an isolated preview, not a live email service.',folder:'inbox',date:'2026-11-26T10:20:00Z',read:false,starred:false},
{id:'m2',from:'Project Desk (sample)',to:'demo@example.invalid',subject:'Project milestones',body:'Review the sample launch milestones and prepare your next update.',folder:'inbox',date:'2026-11-25T09:00:00Z',read:true,starred:true},
{id:'m3',from:'Demo account',to:'team@example.invalid',subject:'Sample follow-up',body:'This fictional message represents the sent folder.',folder:'sent',date:'2026-11-24T10:00:00Z',read:true,starred:false,simulated:true}
];
const model=createMailbox(seed);
const $=s=>document.querySelector(s), make=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;if(cls)e.className=cls;return e};
const button=(label,fn,cls)=>{const e=make('button',label,cls);e.type='button';e.addEventListener('click',fn);return e};
const folders={inbox:'Inbox',starred:'Starred',sent:'Sent',drafts:'Drafts',archive:'Archive',trash:'Trash'};
let folder='inbox',selected=null,draftId=null;
function status(s){$('#status').textContent=s}
function render(){const nav=$('#folders');nav.replaceChildren();for(const [key,name] of Object.entries(folders)){const b=button(name,()=>{folder=key;selected=null;$('#search').value='';render()});b.classList.toggle('active',key===folder);b.setAttribute('aria-current',key===folder?'page':'false');b.append(make('span',String(model.list(key).length)));nav.append(b)}
 const rows=model.list(folder,$('#search').value);$('#heading').textContent=folders[folder];$('#count').textContent=rows.length+' messages';const list=$('#messages');list.replaceChildren();if(!rows.length)list.append(make('div','No messages in this view.','empty'));
 for(const m of rows){const r=make('div',undefined,'message'+(!m.read?' unread':''));const star=button(m.starred?'★':'☆',()=>{model.star(m.id);render()},'star'+(m.starred?' on':''));star.setAttribute('aria-label',m.starred?'Remove star':'Star message');const open=button('',()=>{if(m.folder==='drafts'){edit(m);return}model.markRead(m.id);selected=m.id;render()},'open');open.append(make('span',m.folder==='sent'||m.folder==='drafts'?'To: '+m.to:m.from),make('span',m.subject||'(No subject)','subject'),make('small',m.date.slice(5,10)));r.append(star,open);list.append(r)}
 if(selected){try{drawReader(model.get(selected))}catch{selected=null;$('#reader').hidden=true}}else $('#reader').hidden=true;
}
function drawReader(m){const r=$('#reader');r.hidden=false;r.replaceChildren(make('h2',m.subject||'(No subject)'),make('div','From: '+m.from+' • To: '+m.to,'meta'),make('p',m.body,'body'));if(m.simulated)r.append(make('p','Simulated send — not delivered.','meta'));const a=make('div',undefined,'actions');a.append(button('Close',()=>{selected=null;render()}));
 const move=(target)=>{model.move(m.id,target);selected=null;status('Message moved.');render()};
 if(m.folder==='trash'){a.append(button('Restore',()=>move('inbox')),button('Delete forever',()=>{if(confirm('Permanently delete this sample message?')){model.deleteForever(m.id);selected=null;render()}}))}
 else{if(m.folder==='inbox')a.append(button('Archive',()=>move('archive')));if(m.folder==='archive')a.append(button('Move to inbox',()=>move('inbox')));a.append(button('Trash',()=>move('trash')),button(m.read?'Mark unread':'Mark read',()=>{model.markRead(m.id,!m.read);selected=null;render()}));a.append(button('Reply',()=>edit(null,{to:m.from.includes('@')?m.from:'',subject:'Re: '+m.subject,body:''})),button('Forward',()=>edit(null,{to:'',subject:'Fwd: '+m.subject,body:'\n\n--- Forwarded sample message ---\n'+m.body})))}
 r.append(a);
}
function edit(m=null,fields={}){draftId=m?.id??null;const f=$('#draft-form');for(const k of ['to','subject','body'])f.elements[k].value=m?.[k]??fields[k]??'';$('#editor-title').textContent=m?'Edit draft':'New message';$('#draft-error').textContent='';$('#editor').showModal();f.elements.to.focus()}
function save(simulate=false){try{const f=$('#draft-form');const d=model.saveDraft(Object.fromEntries(['to','subject','body'].map(k=>[k,f.elements[k].value])),draftId);draftId=d.id;if(simulate)model.simulateSend(d.id);$('#editor').close();folder=simulate?'sent':'drafts';selected=null;status(simulate?'Simulated only. No email was sent.':'Draft saved for this preview session.');render()}catch(e){$('#draft-error').textContent=e.message==='INVALID_MESSAGE'?'Enter one valid recipient and a subject before simulating send.':'Unable to save this draft.'}}
$('#compose').addEventListener('click',()=>edit());$('#close-editor').addEventListener('click',()=>save());$('#draft-form').addEventListener('submit',e=>{e.preventDefault();save()});$('#simulate-send').addEventListener('click',()=>save(true));$('#editor').addEventListener('cancel',e=>{e.preventDefault();save()});$('#search').addEventListener('input',render);$('#refresh').addEventListener('click',()=>{$('#search').value='';render()});render();
