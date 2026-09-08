import {PRODUCT,SUPPORT,PREMIUM_FEATURES} from './content.mjs';

const APP_URL='https://payments.mftintelligence.com/chemistry/app';
const APP_VIEWS=new Set(['home','rescue','exam','premium','help']);
const appEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeAppView=v=>APP_VIEWS.has(String(v||'').toLowerCase())?String(v||'').toLowerCase():'home';

export const SCIENTIFIC_RESPONSE_SCHEMA='musitu.scientific_response_graph.v1';
export const SCIENTIFIC_RESPONSE_STORAGE_KEY='musitu_chem_scientific_response_v1';

export const APP_BRIDGE_JS="(()=>{'use strict';try{const installed=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches===true)||navigator.standalone===true;if(installed&&location.pathname==='/chemistry/rescue')location.replace('/chemistry/app');}catch{}})();";

export const APP_SHELL_JS=String.raw`
(()=>{
  'use strict';
  const root=document.documentElement;
  const installed=()=>{try{return window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches===true||navigator.standalone===true}catch{return false}};
  const state=document.querySelector('[data-app-install-state]');
  const APP_CACHE='musitu-chemistry-app-shell-v4';
  const APP_STATIC=[
    '/chemistry/app',
    '/chemistry/app?view=rescue',
    '/chemistry/app?view=exam',
    '/chemistry/app?view=premium',
    '/chemistry/app?view=help',
    '/chemistry/assets/app-shell.css?v=4',
    '/chemistry/assets/app-shell.js?v=4',
    '/chemistry/assets/musitu-chemistry-192.png',
    '/chemistry/assets/musitu-chemistry-512.png',
    '/chemistry/manifest.webmanifest?v=2'
  ];
  const paintState=()=>{
    root.dataset.appMode=installed()?'installed':'browser';
    if(state)state.textContent=installed()?(navigator.onLine?'Installed':'Offline ready'):'Web preview';
  };
  const primeOfflineShell=async()=>{
    if(!('caches' in window)||!navigator.onLine)return false;
    try{
      const cache=await caches.open(APP_CACHE);
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('musitu-chemistry-app-shell-')&&k!==APP_CACHE).map(k=>caches.delete(k)));
      const results=await Promise.all(APP_STATIC.map(async url=>{
        try{
          const response=await fetch(url,{cache:'reload',credentials:'same-origin'});
          if(!response.ok)return false;
          await cache.put(url,response.clone());
          return true;
        }catch{return false}
      }));
      return results.every(Boolean);
    }catch{return false}
  };
  paintState();
  addEventListener('online',()=>{paintState();primeOfflineShell()});
  addEventListener('offline',paintState);
  const overlay=document.getElementById('app-onboarding');
  const steps=[...document.querySelectorAll('[data-app-onboarding-step]')];
  const dots=[...document.querySelectorAll('[data-app-onboarding-dot]')];
  const next=document.getElementById('app-onboarding-next');
  const skip=document.getElementById('app-onboarding-skip');
  const KEY='musitu_chem_onboarding_v1';
  let index=0;
  const show=i=>{index=Math.max(0,Math.min(i,steps.length-1));steps.forEach((el,n)=>el.hidden=n!==index);dots.forEach((el,n)=>el.classList.toggle('active',n===index));if(next)next.textContent=index===steps.length-1?'Enter MUSITU':'Next'};
  const done=()=>{try{localStorage.setItem(KEY,'1')}catch{}if(overlay)overlay.hidden=true};
  let seen=false;try{seen=localStorage.getItem(KEY)==='1'}catch{}
  if(overlay){overlay.hidden=seen;show(0)}
  next?.addEventListener('click',()=>{if(index>=steps.length-1)done();else show(index+1)});
  skip?.addEventListener('click',done);
  document.querySelectorAll('[data-app-jump]').forEach(a=>a.addEventListener('click',e=>{const target=document.querySelector(a.getAttribute('href'));if(target){e.preventDefault();target.scrollIntoView({behavior:'smooth',block:'start'})}}));
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/chemistry/sw.js',{scope:'/chemistry/'}).then(r=>r.update()).catch(()=>{});
  primeOfflineShell();

  const sr=document.querySelector('[data-scientific-response-os]');
  if(!sr)return;
  const SR_SCHEMA='musitu.scientific_response_graph.v1';
  const SR_KEY='musitu_chem_scientific_response_v1';
  const MAX_OBJECTS=180,MAX_EDGES=240,MAX_TRACE=256,MAX_INK_STROKES=180,MAX_POINTS=220;
  const modes=new Set(['equation','ink','structure','mechanism','graph','apparatus','particle','argument','accessibility','graph-data']);
  const blank=()=>({schema:SR_SCHEMA,version:1,examMode:'certified',activeMode:'equation',text:'',argument:{claim:'',evidence:'',principle:'',conclusion:''},accessibilityDescription:'',objects:[],edges:[],ink:[],provenance:[],finalized:false});
  let response=blank();
  try{
    const raw=localStorage.getItem(SR_KEY);
    if(raw){const parsed=JSON.parse(raw);if(parsed&&parsed.schema===SR_SCHEMA&&Array.isArray(parsed.objects)&&Array.isArray(parsed.edges)&&Array.isArray(parsed.ink))response={...blank(),...parsed,argument:{...blank().argument,...(parsed.argument||{})},activeMode:modes.has(parsed.activeMode)?parsed.activeMode:'equation',finalized:parsed.finalized===true};}
  }catch{}
  const live=sr.querySelector('[data-sr-live]');
  const status=sr.querySelector('[data-sr-status]');
  const graphOut=sr.querySelector('[data-sr-graph-output]');
  const textArea=sr.querySelector('[data-sr-equation]');
  const accessArea=sr.querySelector('[data-sr-accessibility]');
  const canvas=sr.querySelector('[data-sr-ink]');
  const ctx=canvas?.getContext('2d');
  let selected=[];
  let activeStroke=null;
  let drag=null;
  let viewMode=response.activeMode;
  const say=t=>{if(live){live.textContent='';requestAnimationFrame(()=>{live.textContent=t})}};
  const trace=(action,detail='')=>{response.provenance.push({t:Math.max(0,Math.round(performance.now())),action:String(action).slice(0,40),detail:String(detail).slice(0,80)});if(response.provenance.length>MAX_TRACE)response.provenance.splice(0,response.provenance.length-MAX_TRACE)};
  const persist=()=>{try{const raw=JSON.stringify(response);if(raw.length<=240000)localStorage.setItem(SR_KEY,raw)}catch{}};
  const renderSummary=()=>{
    if(status)status.textContent=response.finalized?'Response locked for review':(response.objects.length||response.edges.length||response.ink.length||response.text||Object.values(response.argument||{}).some(Boolean)||response.accessibilityDescription)?'Local draft saved':'Ready — local draft only';
    if(graphOut)graphOut.textContent=JSON.stringify({schema:response.schema,examMode:response.examMode,text:response.text,argument:response.argument,objects:response.objects,edges:response.edges,ink:response.ink.map(s=>({tool:s.tool,points:s.points})),accessibilityDescription:response.accessibilityDescription,provenance:response.provenance,finalized:response.finalized},null,2);
  };
  const paintLock=()=>{
    const locked=response.finalized===true;
    if(textArea)textArea.readOnly=locked;
    if(accessArea)accessArea.readOnly=locked;
    sr.querySelectorAll('[data-sr-argument]').forEach(el=>{el.readOnly=locked});
    sr.querySelectorAll('[data-sr-symbol],[data-sr-add],[data-sr-connect],[data-sr-link-representation],[data-sr-delete],[data-sr-ink-undo],[data-sr-ink-clear],[data-sr-reset]').forEach(el=>{el.disabled=locked});
    const finish=sr.querySelector('[data-sr-finalize]');if(finish)finish.disabled=locked;
    const reopen=sr.querySelector('[data-sr-reopen]');if(reopen)reopen.disabled=!locked;
  };
  const touch=()=>{if(response.finalized)return;persist();renderSummary()};
  const panelFor=mode=>sr.querySelector('[data-sr-panel="'+mode+'"]');
  const boardRefs=()=>{const panel=panelFor(viewMode);return {board:panel?.querySelector('[data-sr-board]'),links:panel?.querySelector('[data-sr-links]'),empty:panel?.querySelector('[data-sr-empty]')}};
  const setMode=mode=>{
    if(!modes.has(mode))return;
    viewMode=mode;
    if(!response.finalized){response.activeMode=mode;trace('mode',mode);persist();}
    sr.querySelectorAll('[data-sr-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.srMode===mode)));
    sr.querySelectorAll('[data-sr-panel]').forEach(p=>p.hidden=p.dataset.srPanel!==mode);
    renderSummary();
    if(mode==='ink')resizeInk();else if(['structure','mechanism','graph','apparatus','particle'].includes(mode))renderBoard();
  };
  const insertAtCursor=(el,value)=>{
    if(!el||el.readOnly||response.finalized)return;
    const start=Number.isInteger(el.selectionStart)?el.selectionStart:el.value.length,end=Number.isInteger(el.selectionEnd)?el.selectionEnd:start;
    el.setRangeText(value,start,end,'end');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();
  };
  sr.querySelectorAll('[data-sr-symbol]').forEach(b=>b.addEventListener('click',()=>insertAtCursor(textArea,b.dataset.srSymbol||'')));
  sr.querySelectorAll('[data-sr-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.srMode||'')));
  textArea?.addEventListener('input',()=>{if(response.finalized)return;response.text=String(textArea.value).slice(0,12000);trace('equation-edit');touch()});
  accessArea?.addEventListener('input',()=>{if(response.finalized)return;response.accessibilityDescription=String(accessArea.value).slice(0,6000);trace('accessibility-edit');touch()});
  sr.querySelectorAll('[data-sr-argument]').forEach(el=>el.addEventListener('input',()=>{if(response.finalized)return;const key=el.dataset.srArgument;if(Object.hasOwn(response.argument,key)){response.argument[key]=String(el.value).slice(0,4000);trace('argument-edit',key);touch()}}));

  const modeObjects=()=>response.objects.filter(o=>o.mode===viewMode);
  const modeEdges=()=>response.edges.filter(e=>e.mode===viewMode);
  const uid=()=>{let id='n'+Math.random().toString(36).slice(2,9);while(response.objects.some(o=>o.id===id))id='n'+Math.random().toString(36).slice(2,9);return id};
  const nextPosition=()=>{const n=modeObjects().length;return {x:12+(n%4)*22,y:14+(Math.floor(n/4)%5)*16}};
  const addObject=(kind,label)=>{
    if(response.finalized)return;
    if(response.objects.length>=MAX_OBJECTS){say('Object limit reached');return}
    const p=nextPosition();response.objects.push({id:uid(),mode:response.activeMode,kind:String(kind).slice(0,32),label:String(label).slice(0,48),x:p.x,y:p.y});
    trace('add-object',kind);touch();renderBoard();say(label+' added');
  };
  sr.querySelectorAll('[data-sr-add]').forEach(b=>b.addEventListener('click',()=>addObject(b.dataset.srAdd||'object',b.dataset.srLabel||b.textContent?.trim()||'Object')));
  const selectNode=id=>{selected=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id].slice(-2);renderBoard();say(selected.length===2?'Two objects selected. Connect them or link their representations.':'Object selected')};
  const selectedObjects=()=>selected.map(id=>response.objects.find(o=>o.id===id)).filter(Boolean);
  const addEdge=kind=>{
    if(response.finalized)return;
    const objects=selectedObjects();
    if(objects.length!==2){say('Select two objects first');return}
    if(objects.some(o=>o.mode!==response.activeMode)){say('Those objects are in different representations. Use Link representations.');return}
    if(response.edges.length>=MAX_EDGES){say('Connection limit reached');return}
    const [from,to]=selected;response.edges.push({id:'e'+response.edges.length+'-'+Math.random().toString(36).slice(2,6),mode:response.activeMode,kind:String(kind).slice(0,32),from,to});selected=[];
    trace('add-edge',kind);touch();renderBoard();say(kind+' connection added');
  };
  const linkRepresentations=()=>{
    if(response.finalized)return;
    const objects=selectedObjects();if(objects.length!==2){say('Select one object in each representation first');return}
    if(objects[0].mode===objects[1].mode){say('Choose objects from two different representations');return}
    if(response.edges.length>=MAX_EDGES){say('Connection limit reached');return}
    response.edges.push({id:'e'+response.edges.length+'-'+Math.random().toString(36).slice(2,6),mode:'cross',kind:'same-scientific-concept',from:selected[0],to:selected[1]});selected=[];trace('cross-representation-link');touch();renderBoard();say('Representations linked in the Scientific Response Graph');
  };
  sr.querySelectorAll('[data-sr-connect]').forEach(b=>b.addEventListener('click',()=>addEdge(b.dataset.srConnect||'connection')));
  sr.querySelectorAll('[data-sr-link-representation]').forEach(b=>b.addEventListener('click',linkRepresentations));
  const removeSelected=()=>{
    if(response.finalized||!selected.length)return;
    const gone=new Set(selected);response.objects=response.objects.filter(o=>!gone.has(o.id));response.edges=response.edges.filter(e=>!gone.has(e.from)&&!gone.has(e.to));selected=[];trace('remove-object');touch();renderBoard();
  };
  sr.querySelectorAll('[data-sr-delete]').forEach(b=>b.addEventListener('click',removeSelected));
  const svgEl=(tag,attrs={})=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el};
  const drawLinks=(links,objects)=>{
    if(!links)return;links.replaceChildren();const map=new Map(objects.map(o=>[o.id,o]));
    for(const edge of modeEdges()){
      const a=map.get(edge.from),b=map.get(edge.to);if(!a||!b)continue;
      const x1=a.x,x2=b.x,y1=a.y,y2=b.y;
      if(edge.kind.includes('electron')){links.append(svgEl('path',{d:'M '+x1+' '+y1+' Q '+((x1+x2)/2)+' '+(Math.min(y1,y2)-14)+' '+x2+' '+y2,'data-edge-kind':edge.kind}))}
      else{links.append(svgEl('line',{x1,y1,x2,y2,'data-edge-kind':edge.kind}))}
    }
  };
  const renderBoard=()=>{
    const {board,links,empty}=boardRefs();if(!board||!links)return;
    board.querySelectorAll('[data-sr-node]').forEach(n=>n.remove());
    const objects=modeObjects();drawLinks(links,objects);
    for(const o of objects){
      const n=document.createElement('button');n.type='button';n.className='sr-node';n.dataset.srNode=o.id;n.style.left=o.x+'%';n.style.top=o.y+'%';n.textContent=o.label;n.setAttribute('aria-label',o.kind+': '+o.label);n.setAttribute('aria-pressed',String(selected.includes(o.id)));n.addEventListener('click',()=>selectNode(o.id));
      n.addEventListener('pointerdown',e=>{if(response.finalized)return;drag={id:o.id,pointer:e.pointerId,board};n.setPointerCapture?.(e.pointerId)});
      n.addEventListener('pointermove',e=>{if(!drag||drag.id!==o.id||drag.pointer!==e.pointerId)return;const r=drag.board.getBoundingClientRect();o.x=Math.max(4,Math.min(92,((e.clientX-r.left)/r.width)*100));o.y=Math.max(7,Math.min(88,((e.clientY-r.top)/r.height)*100));n.style.left=o.x+'%';n.style.top=o.y+'%';drawLinks(links,objects)});
      n.addEventListener('pointerup',e=>{if(drag?.id===o.id){drag=null;trace('move-object',o.kind);touch()}});board.append(n);
    }
    if(empty)empty.hidden=objects.length>0;
  };

  const resizeInk=()=>{
    if(!canvas||!ctx)return;const box=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);const w=Math.max(1,Math.round(box.width*ratio)),h=Math.max(1,Math.round(box.height*ratio));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}drawInk();
  };
  const drawInk=()=>{
    if(!canvas||!ctx)return;const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#eef4ff';ctx.lineWidth=Math.max(2,w/300);
    for(const stroke of response.ink){if(!stroke.points?.length)continue;ctx.beginPath();stroke.points.forEach((p,i)=>{const x=p.x*w,y=p.y*h;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke()}
  };
  const inkPoint=e=>{const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}};
  canvas?.addEventListener('pointerdown',e=>{if(response.finalized||response.ink.length>=MAX_INK_STROKES)return;e.preventDefault();activeStroke={tool:e.pointerType==='pen'?'stylus':'ink',points:[inkPoint(e)]};response.ink.push(activeStroke);canvas.setPointerCapture?.(e.pointerId);drawInk()});
  canvas?.addEventListener('pointermove',e=>{if(!activeStroke||activeStroke.points.length>=MAX_POINTS)return;e.preventDefault();activeStroke.points.push(inkPoint(e));drawInk()});
  const finishInk=()=>{if(activeStroke){trace('ink-stroke',activeStroke.tool);activeStroke=null;touch()}};
  canvas?.addEventListener('pointerup',finishInk);canvas?.addEventListener('pointercancel',finishInk);
  sr.querySelector('[data-sr-ink-undo]')?.addEventListener('click',()=>{if(response.finalized)return;response.ink.pop();trace('ink-undo');touch();drawInk()});
  sr.querySelector('[data-sr-ink-clear]')?.addEventListener('click',()=>{if(response.finalized)return;response.ink=[];trace('ink-clear');touch();drawInk()});
  addEventListener('resize',()=>{if(response.activeMode==='ink')resizeInk()},{passive:true});

  sr.querySelector('[data-sr-reset]')?.addEventListener('click',()=>{if(response.finalized)return;response=blank();selected=[];textArea&&(textArea.value='');accessArea&&(accessArea.value='');sr.querySelectorAll('[data-sr-argument]').forEach(el=>{el.value=''});try{localStorage.removeItem(SR_KEY)}catch{}trace('reset');setMode('equation');paintLock();renderBoard();drawInk();renderSummary();say('Local scientific response cleared')});
  sr.querySelector('[data-sr-finalize]')?.addEventListener('click',()=>{response.finalized=true;trace('finalize');persist();paintLock();renderSummary();say('Response locked for review. No network submission has occurred.')});
  sr.querySelector('[data-sr-reopen]')?.addEventListener('click',()=>{response.finalized=false;trace('reopen');persist();paintLock();renderSummary();say('Response reopened for editing')});
  sr.querySelector('[data-sr-export]')?.addEventListener('click',async()=>{const payload=JSON.stringify(response,null,2);try{await navigator.clipboard.writeText(payload);say('Scientific Response Graph copied')}catch{if(graphOut){graphOut.hidden=false;graphOut.focus();say('Copy unavailable. Structured response is shown below.')}}});
  sr.querySelector('[data-sr-toggle-graph]')?.addEventListener('click',()=>{if(graphOut){graphOut.hidden=!graphOut.hidden;if(!graphOut.hidden)graphOut.focus()}});
  textArea&&(textArea.value=response.text||'');accessArea&&(accessArea.value=response.accessibilityDescription||'');sr.querySelectorAll('[data-sr-argument]').forEach(el=>{const key=el.dataset.srArgument;el.value=response.argument?.[key]||''});
  setMode(response.activeMode||'equation');paintLock();renderBoard();renderSummary();
})();
`;

export const APP_SHELL_CSS=String.raw`
:root{background:#07101f;color:#f7f9fc;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#07101f;color:#f7f9fc}body{min-height:100dvh;padding-bottom:calc(82px + env(safe-area-inset-bottom))}a{color:inherit;text-decoration:none}button,input,textarea,select{font:inherit}.app-shell{min-height:100dvh;background:radial-gradient(circle at top right,rgba(56,106,255,.18),transparent 34%),#07101f}.app-topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:calc(.85rem + env(safe-area-inset-top)) 1rem .85rem;background:rgba(7,16,31,.88);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.08)}.app-brand{display:flex;align-items:center;gap:.75rem;min-width:0}.app-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:linear-gradient(145deg,#223255,#111a2d);border:1px solid rgba(255,255,255,.16);font-weight:900;font-size:1.15rem}.app-brand-copy{min-width:0}.app-brand-copy strong{display:block;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.app-brand-copy span{display:block;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#97a6bc}.app-state{flex:none;padding:.38rem .65rem;border-radius:999px;background:rgba(95,215,156,.12);border:1px solid rgba(95,215,156,.35);color:#baf4d2;font-size:.78rem;font-weight:800}
.app-main{width:min(100%,900px);margin:0 auto;padding:1rem}.app-hero{padding:1.3rem 0 1rem}.app-eyebrow{display:inline-flex;align-items:center;gap:.45rem;font-size:.78rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:#9fb2d0}.app-hero h1{font-size:clamp(2rem,9vw,3.7rem);line-height:.98;margin:.65rem 0 .8rem;letter-spacing:-.045em}.app-hero p{margin:0;color:#bcc9dc;font-size:1.03rem;line-height:1.55}.app-primary{display:flex;align-items:center;justify-content:center;min-height:54px;padding:.9rem 1rem;margin-top:1.15rem;border-radius:16px;background:#f7f9fc;color:#07101f;font-weight:900;box-shadow:0 10px 30px rgba(0,0,0,.22)}
.app-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin:1rem 0 1.2rem}.app-stat{padding:1rem .8rem;border-radius:18px;background:#101a2c;border:1px solid rgba(255,255,255,.08)}.app-stat b{display:block;font-size:1.1rem}.app-stat span{display:block;margin-top:.25rem;color:#8fa0b9;font-size:.8rem;line-height:1.25}.app-section{scroll-margin-top:94px;margin:1rem 0 1.5rem}.app-section-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:.8rem}.app-section-head h2{margin:0;font-size:1.25rem}.app-section-head p{margin:0;color:#8798b2;font-size:.82rem}.app-card{border:1px solid rgba(255,255,255,.09);border-radius:22px;background:#101a2c;overflow:hidden}.app-card-row{display:flex;gap:1rem;align-items:flex-start;padding:1rem;border-bottom:1px solid rgba(255,255,255,.07)}.app-card-row:last-child{border-bottom:0}.app-step{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:14px;background:#1a2943;color:#dce8ff;font-weight:900}.app-card-row h3{margin:.05rem 0 .25rem;font-size:1rem}.app-card-row p{margin:0;color:#9eacc0;line-height:1.45;font-size:.9rem}.app-actions{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.8rem}.app-action{display:flex;align-items:center;justify-content:center;min-height:50px;padding:.8rem;border-radius:15px;background:#16233a;border:1px solid rgba(255,255,255,.09);font-weight:800;text-align:center}.app-action.primary{background:#eaf0ff;color:#091324}.app-action small{font-weight:600;color:#92a2b8}.app-note{padding:1rem;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#9eacc0;font-size:.86rem;line-height:1.5}.app-note strong{color:#edf3ff}.app-list{margin:.25rem 0 0;padding:0;list-style:none}.app-list li{padding:.85rem 0;border-bottom:1px solid rgba(255,255,255,.07);color:#b7c4d7;line-height:1.4}.app-list li:last-child{border-bottom:0}.app-list li::before{content:"✓";display:inline-block;margin-right:.6rem;color:#8fe0b4;font-weight:900}.app-contact{margin-top:.85rem;padding:1rem;border-radius:18px;background:#101a2c;border:1px solid rgba(255,255,255,.08)}.app-contact h3{margin:0 0 .35rem}.app-contact p{margin:.25rem 0;color:#9eacc0;line-height:1.45}.app-online-note{display:inline-flex;margin-top:.7rem;padding:.35rem .55rem;border-radius:999px;background:#17243a;color:#aebbd0;font-size:.75rem;font-weight:800}
.app-nav{position:fixed;left:0;right:0;bottom:0;z-index:50;display:grid;grid-template-columns:repeat(5,1fr);padding:.55rem .55rem calc(.55rem + env(safe-area-inset-bottom));background:rgba(8,16,30,.94);backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,.09)}.app-nav a{display:grid;place-items:center;gap:.25rem;min-height:52px;border-radius:14px;color:#8d9cb2;font-size:.68rem;font-weight:800}.app-nav a[aria-current="page"]{background:#15223a;color:#fff}.app-nav b{font-size:1.1rem;line-height:1}
.app-onboarding{position:fixed;inset:0;z-index:100;background:rgba(2,7,15,.96);display:grid;place-items:center;padding:1rem}.app-onboarding[hidden]{display:none}.app-onboarding-card{width:min(100%,520px);padding:1.4rem;border-radius:26px;background:#0f192a;border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 90px rgba(0,0,0,.48)}.app-onboarding-step{min-height:210px}.app-onboarding-step[hidden]{display:none}.app-onboarding-kicker{color:#8ea5ca;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:.75rem}.app-onboarding-step h2{font-size:2rem;margin:.5rem 0 .6rem}.app-onboarding-step p{color:#aebbd0;line-height:1.55}.app-dots{display:flex;gap:.4rem;margin:1rem 0}.app-dots span{height:5px;flex:1;border-radius:999px;background:#27344a}.app-dots span.active{background:#eef3ff}.app-onboarding-actions{display:grid;grid-template-columns:1fr 2fr;gap:.7rem}.app-onboarding-actions button{min-height:50px;border:0;border-radius:15px;font-weight:900}.app-onboarding-actions .skip{background:#17243a;color:#cbd6e6}.app-onboarding-actions .next{background:#f4f7fb;color:#09111f}
.sr-shell{margin:.4rem 0 2rem}.sr-trust{display:grid;grid-template-columns:repeat(3,1fr);gap:.55rem;margin:.8rem 0 1rem}.sr-trust div{padding:.75rem;border-radius:15px;background:#0e1a2c;border:1px solid rgba(255,255,255,.08)}.sr-trust b{display:block;font-size:.78rem}.sr-trust span{display:block;margin-top:.2rem;color:#8fa0b9;font-size:.72rem}.sr-modebar,.sr-tools{display:flex;gap:.45rem;overflow:auto;padding:.25rem 0 .65rem;scrollbar-width:thin}.sr-modebar button,.sr-tools button,.sr-control{flex:0 0 auto;min-width:44px;min-height:44px;border:1px solid rgba(255,255,255,.12);border-radius:13px;background:#13213a;color:#dce7f7;padding:.55rem .72rem;font-weight:800}.sr-modebar button[aria-pressed="true"]{background:#eef3ff;color:#081223}.sr-modebar button:disabled,.sr-tools button:disabled,.sr-actions button:disabled{opacity:.45;cursor:not-allowed}.sr-panel{padding:1rem;border:1px solid rgba(255,255,255,.09);border-radius:20px;background:#0d1728}.sr-panel[hidden]{display:none}.sr-panel h3{margin:.15rem 0 .35rem}.sr-panel-lead{margin:.1rem 0 .8rem;color:#96a8c2;font-size:.86rem;line-height:1.45}.sr-equation{width:100%;min-height:180px;resize:vertical;border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:1rem;background:#07111f;color:#f6f8fc;font:600 1.02rem/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}.sr-board{position:relative;min-height:350px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px),#07111f;background-size:24px 24px;overflow:hidden;touch-action:none}.sr-links{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.sr-links line,.sr-links path{stroke:#9db9ff;stroke-width:1.4;fill:none;vector-effect:non-scaling-stroke}.sr-links [data-edge-kind="double-bond"]{stroke-width:3}.sr-links [data-edge-kind*="electron"]{stroke:#9be7bd;stroke-dasharray:4 2}.sr-node{position:absolute;transform:translate(-50%,-50%);min-width:44px;min-height:44px;border-radius:14px;border:2px solid #6c83aa;background:#162640;color:#f7f9fc;padding:.45rem .6rem;font-weight:850;touch-action:none}.sr-node[aria-pressed="true"]{outline:3px solid #f5d772;outline-offset:2px}.sr-empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:2rem;color:#71839f;pointer-events:none}.sr-ink-wrap{position:relative}.sr-ink{display:block;width:100%;height:360px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#07111f;touch-action:none}.sr-accessibility,.sr-argument-input{width:100%;min-height:130px;border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:1rem;background:#07111f;color:#f6f8fc;resize:vertical}.sr-argument-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.sr-argument-grid label{display:grid;gap:.35rem;font-weight:800}.sr-argument-input{min-height:120px;font-weight:500}.sr-cross{display:flex;align-items:center;justify-content:space-between;gap:.7rem;margin:.65rem 0;padding:.7rem;border-radius:14px;background:rgba(107,133,181,.08);border:1px solid rgba(255,255,255,.06)}.sr-cross span{color:#91a4bf;font-size:.78rem;line-height:1.4}.sr-cross button{min-height:44px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#182842;color:#eef4ff;font-weight:850;padding:.55rem .7rem}.sr-bottom{display:grid;grid-template-columns:1fr auto;gap:.7rem;align-items:center;margin-top:.8rem}.sr-status{color:#a9b8cc;font-size:.8rem}.sr-actions{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end}.sr-actions button{min-height:44px;border-radius:13px;border:1px solid rgba(255,255,255,.12);background:#16233a;color:#eaf1fb;padding:.55rem .75rem;font-weight:800}.sr-actions .sr-finish{background:#eef3ff;color:#07101f}.sr-graph-output{width:100%;max-height:320px;overflow:auto;white-space:pre-wrap;margin-top:.8rem;padding:1rem;border-radius:15px;background:#050b14;border:1px solid rgba(255,255,255,.08);color:#b9c8dd;font-size:.72rem}.sr-graph-output[hidden]{display:none}.sr-live{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.sr-exam-boundary{padding:.85rem 1rem;border-left:3px solid #85d8ad;border-radius:12px;background:rgba(69,160,111,.09);color:#b9c9dc;font-size:.84rem;line-height:1.5}.sr-exam-boundary strong{color:#e9f8ef}
@media(max-width:600px){.sr-trust,.sr-argument-grid{grid-template-columns:1fr}.sr-bottom{grid-template-columns:1fr}.sr-actions{justify-content:stretch}.sr-actions button{flex:1 1 45%}.sr-cross{align-items:stretch;flex-direction:column}.sr-board,.sr-ink{min-height:310px;height:310px}}
@media(max-width:520px){.app-grid{gap:.5rem}.app-stat{padding:.85rem .65rem}.app-stat b{font-size:1rem}.app-actions{grid-template-columns:1fr}.app-brand-copy span{font-size:.65rem}.app-nav a{font-size:.62rem}}
:focus-visible{outline:3px solid #83a9ff;outline-offset:3px}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}.app-topbar,.app-nav{backdrop-filter:none}}
`;

function nav(view){
  const item=(id,href,icon,label)=>`<a href="${href}"${view===id?' aria-current="page"':''}><b>${icon}</b><span>${label}</span></a>`;
  return `<nav class="app-nav" aria-label="App navigation">${item('home','/chemistry/app','⌂','Home')}${item('rescue','/chemistry/app?view=rescue','◫','Rescue')}${item('exam','/chemistry/app?view=exam','∿','Prove')}${item('premium','/chemistry/app?view=premium','◇','Premium')}${item('help','/chemistry/app?view=help','?','Help')}</nav>`;
}

function homeView(){
  return `<section class="app-hero"><span class="app-eyebrow">MUSITU Chemistry · Education Nexus</span><h1>Your Chemistry workspace.</h1><p>One focused place to revise deliberately, express Chemistry precisely, and use Rescue when you need targeted support — without the public website chrome.</p><a class="app-primary" href="/chemistry/app?view=exam">Open Scientific Response OS</a></section><section class="app-grid" aria-label="MUSITU Chemistry workspace"><article class="app-stat"><b>01</b><span>Use Rescue when a topic needs targeted support</span></article><article class="app-stat"><b>02</b><span>Revise with focus</span></article><article class="app-stat"><b>03</b><span>Prove with scientific expression</span></article></section><section class="app-section"><div class="app-section-head"><h2>Quick access</h2><p>Stay inside MUSITU Chemistry</p></div><div class="app-actions"><a class="app-action primary" href="/chemistry/app?view=exam">Open Scientific Response OS</a><a class="app-action" href="/chemistry/app?view=rescue">Chemistry Rescue</a><a class="app-action" href="/chemistry/app?view=premium">Premium options</a><a class="app-action" href="/chemistry/app?view=help">Help &amp; support</a></div></section><p class="app-note"><strong>Installed app mode:</strong> MUSITU Chemistry runs from the same secure web origin, with a dedicated installed launch surface separated from the public marketing site. Home, Rescue, Prove, Premium and Help stay inside the installed app surface. Payment and entitlement remain server-authoritative.</p>`;
}

function rescueView(){
  return `<section class="app-hero"><span class="app-eyebrow">Free entry</span><h1>Chemistry Rescue.</h1><p>Use the same three-step loop every time: diagnose the gap, revise with focus, then prove what survives exam pressure.</p></section><section class="app-section" id="rescue"><div class="app-section-head"><h2>Your Rescue loop</h2><p>Free entry</p></div><div class="app-card"><article class="app-card-row"><span class="app-step">1</span><div><h3>Diagnose</h3><p>Identify the Chemistry areas that deserve attention instead of revising every topic equally.</p></div></article><article class="app-card-row"><span class="app-step">2</span><div><h3>Revise</h3><p>Work through targeted revision deliberately. Free access remains available without payment.</p></div></article><article class="app-card-row"><span class="app-step">3</span><div><h3>Prove</h3><p>Use exam-style scientific expression to expose what still breaks under pressure.</p></div></article></div><div class="app-actions"><a class="app-action primary" href="/chemistry/app?view=exam">Open Prove workspace</a><a class="app-action" href="/chemistry/app?view=premium">See Premium</a></div></section>`;
}

function scientificToolbar(){
  return `<div class="sr-modebar" role="toolbar" aria-label="Scientific response representations"><button type="button" data-sr-mode="equation" aria-pressed="true">Equation</button><button type="button" data-sr-mode="ink" aria-pressed="false">Chemistry Ink</button><button type="button" data-sr-mode="structure" aria-pressed="false">Molecular Structure</button><button type="button" data-sr-mode="mechanism" aria-pressed="false">Reaction Mechanism</button><button type="button" data-sr-mode="graph" aria-pressed="false">Scientific Graph</button><button type="button" data-sr-mode="apparatus" aria-pressed="false">Lab Apparatus</button><button type="button" data-sr-mode="particle" aria-pressed="false">Particle Model</button><button type="button" data-sr-mode="argument" aria-pressed="false">Scientific Argument</button><button type="button" data-sr-mode="accessibility" aria-pressed="false">Accessibility Description</button><button type="button" data-sr-mode="graph-data" aria-pressed="false">Scientific Response Graph</button></div>`;
}

function boardPanel(mode,title,lead,tools,connections=''){
  return `<section class="sr-panel" data-sr-panel="${mode}" hidden><h3>${title}</h3><p class="sr-panel-lead">${lead}</p><div class="sr-tools" aria-label="${title} tools">${tools}${connections}<button type="button" data-sr-delete>Delete selected</button></div><div class="sr-cross"><span>Select an object here, switch representation, select its scientific equivalent, then link them.</span><button type="button" data-sr-link-representation>Link representations</button></div><div class="sr-board" data-sr-board aria-label="${title} construction canvas"><svg class="sr-links" data-sr-links viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><p class="sr-empty" data-sr-empty>Add scientific objects above, then select two objects to connect them.</p></div></section>`;
}

function examView(){
  const structure=`<button type="button" data-sr-add="atom" data-sr-label="C">C</button><button type="button" data-sr-add="atom" data-sr-label="H">H</button><button type="button" data-sr-add="atom" data-sr-label="O">O</button><button type="button" data-sr-add="atom" data-sr-label="N">N</button><button type="button" data-sr-add="atom" data-sr-label="Cl">Cl</button><button type="button" data-sr-add="atom" data-sr-label="Br">Br</button><button type="button" data-sr-add="lone-pair" data-sr-label=":">Lone pair</button><button type="button" data-sr-add="wedge-bond" data-sr-label="▲">Solid wedge</button><button type="button" data-sr-add="dash-bond" data-sr-label="⋯">Dashed wedge</button><button type="button" data-sr-add="stereocenter" data-sr-label="R/S">R/S centre</button><button type="button" data-sr-add="fischer" data-sr-label="Fischer">Fischer</button><button type="button" data-sr-add="haworth" data-sr-label="Haworth">Haworth</button><button type="button" data-sr-add="newman" data-sr-label="Newman">Newman</button><button type="button" data-sr-add="ring" data-sr-label="Ring">Ring</button><button type="button" data-sr-add="orbital" data-sr-label="Orbital">Orbital</button><button type="button" data-sr-add="polymer" data-sr-label="[ ]n">Polymer</button><button type="button" data-sr-add="coordination-centre" data-sr-label="M">Coordination centre</button>`;
  const structureEdges=`<button type="button" data-sr-connect="single-bond">Single bond</button><button type="button" data-sr-connect="double-bond">Double bond</button><button type="button" data-sr-connect="triple-bond">Triple bond</button><button type="button" data-sr-connect="coordinate-bond">Coordinate bond</button>`;
  const mechanism=`<button type="button" data-sr-add="nucleophile" data-sr-label="Nu:">Nu:</button><button type="button" data-sr-add="electrophile" data-sr-label="E⁺">E⁺</button><button type="button" data-sr-add="intermediate" data-sr-label="Intermediate">Intermediate</button><button type="button" data-sr-add="transition-state" data-sr-label="‡">Transition state</button><button type="button" data-sr-add="bond-site" data-sr-label="Bond">Bond site</button><button type="button" data-sr-add="leaving-group" data-sr-label="LG">Leaving group</button>`;
  const mechanismEdges=`<button type="button" data-sr-connect="electron-pair-flow">Electron-pair arrow</button><button type="button" data-sr-connect="single-electron-flow">Single-electron arrow</button><button type="button" data-sr-connect="bond-change">Bond change</button><button type="button" data-sr-connect="reaction-step">Reaction step</button>`;
  const graph=`<button type="button" data-sr-add="data-table" data-sr-label="Data table">Data table</button><button type="button" data-sr-add="x-axis" data-sr-label="x axis">x axis</button><button type="button" data-sr-add="y-axis" data-sr-label="y axis">y axis</button><button type="button" data-sr-add="quantity" data-sr-label="Quantity">Quantity</button><button type="button" data-sr-add="unit" data-sr-label="Unit">Unit</button><button type="button" data-sr-add="point" data-sr-label="Point">Point</button><button type="button" data-sr-add="label" data-sr-label="Label">Label</button><button type="button" data-sr-add="error-bar" data-sr-label="Error bar">Error bar</button><button type="button" data-sr-add="anomaly" data-sr-label="Anomaly">Anomaly</button><button type="button" data-sr-add="gradient" data-sr-label="Gradient">Gradient</button>`;
  const graphEdges=`<button type="button" data-sr-connect="best-fit">Best-fit line</button><button type="button" data-sr-connect="trend">Trend</button><button type="button" data-sr-connect="derived-from">Derived from</button>`;
  const apparatus=`<button type="button" data-sr-add="beaker" data-sr-label="Beaker">Beaker</button><button type="button" data-sr-add="conical-flask" data-sr-label="Conical flask">Conical flask</button><button type="button" data-sr-add="burette" data-sr-label="Burette">Burette</button><button type="button" data-sr-add="pipette" data-sr-label="Pipette">Pipette</button><button type="button" data-sr-add="funnel" data-sr-label="Funnel">Funnel</button><button type="button" data-sr-add="condenser" data-sr-label="Condenser">Condenser</button><button type="button" data-sr-add="gas-syringe" data-sr-label="Gas syringe">Gas syringe</button><button type="button" data-sr-add="electrode" data-sr-label="Electrode">Electrode</button><button type="button" data-sr-add="salt-bridge" data-sr-label="Salt bridge">Salt bridge</button><button type="button" data-sr-add="thermometer" data-sr-label="Thermometer">Thermometer</button><button type="button" data-sr-add="reagent" data-sr-label="Reagent">Reagent</button><button type="button" data-sr-add="measure" data-sr-label="Measure">Measure</button><button type="button" data-sr-add="heat" data-sr-label="Heat">Heat</button><button type="button" data-sr-add="filter" data-sr-label="Filter">Filter</button><button type="button" data-sr-add="evaporate" data-sr-label="Evaporate">Evaporate</button><button type="button" data-sr-add="crystallize" data-sr-label="Crystallize">Crystallize</button><button type="button" data-sr-add="gas-collection" data-sr-label="Collect gas">Collect gas</button>`;
  const apparatusEdges=`<button type="button" data-sr-connect="connected-to">Connect</button><button type="button" data-sr-connect="flow-to">Flow</button><button type="button" data-sr-connect="procedure-next">Next step</button>`;
  const particle=`<button type="button" data-sr-add="atom" data-sr-label="Atom">Atom</button><button type="button" data-sr-add="molecule" data-sr-label="Molecule">Molecule</button><button type="button" data-sr-add="cation" data-sr-label="Cation +">Cation +</button><button type="button" data-sr-add="anion" data-sr-label="Anion −">Anion −</button><button type="button" data-sr-add="electron" data-sr-label="e⁻">e⁻</button><button type="button" data-sr-add="solvent" data-sr-label="Solvent">Solvent</button><button type="button" data-sr-add="precipitate" data-sr-label="Precipitate">Precipitate</button><button type="button" data-sr-add="gas-particle" data-sr-label="Gas particle">Gas particle</button>`;
  const particleEdges=`<button type="button" data-sr-connect="interaction">Interaction</button><button type="button" data-sr-connect="collision">Collision</button><button type="button" data-sr-connect="transformation">Transformation</button><button type="button" data-sr-connect="attraction">Attraction</button>`;
  return `<section class="app-hero"><span class="app-eyebrow">Prove · Scientific Response OS</span><h1>Answer Chemistry as Chemistry.</h1><p>Write, draw, construct, connect and explain on one exam-safe scientific surface. The normal keyboard remains available as a fallback, not the limits of your answer.</p></section><section class="sr-shell" data-scientific-response-os data-sr-schema="${SCIENTIFIC_RESPONSE_SCHEMA}"><div class="sr-exam-boundary"><strong>Certified exam mode.</strong> Expression tools only: no hints, predictive completion, automatic balancing, answer correction, hidden retrieval or generative assistance. Your draft stays local on this device; finishing it here does not transmit or submit an exam.</div><div class="sr-trust" aria-label="Scientific response boundaries"><div><b>Original evidence retained</b><span>Ink and structured actions remain distinct from interpretation.</span></div><div><b>Scientific Response Graph</b><span>Objects, connections, text and provenance share one deterministic schema.</span></div><div><b>Offline capable</b><span>No scientific-response network dependency or external editor.</span></div></div>${scientificToolbar()}<section class="sr-panel" data-sr-panel="equation"><h3>Chemistry equation composer</h3><p class="sr-panel-lead">Use the keyboard when useful, then express scientific notation precisely without fighting plain text.</p><div class="sr-tools" aria-label="Chemistry symbols"><button type="button" data-sr-symbol="₁">₁</button><button type="button" data-sr-symbol="₂">₂</button><button type="button" data-sr-symbol="₃">₃</button><button type="button" data-sr-symbol="₄">₄</button><button type="button" data-sr-symbol="₅">₅</button><button type="button" data-sr-symbol="⁺">⁺</button><button type="button" data-sr-symbol="⁻">⁻</button><button type="button" data-sr-symbol="²⁺">²⁺</button><button type="button" data-sr-symbol="²⁻">²⁻</button><button type="button" data-sr-symbol="³⁺">³⁺</button><button type="button" data-sr-symbol="³⁻">³⁻</button><button type="button" data-sr-symbol="→">→</button><button type="button" data-sr-symbol="⇌">⇌</button><button type="button" data-sr-symbol="(s)">(s)</button><button type="button" data-sr-symbol="(l)">(l)</button><button type="button" data-sr-symbol="(g)">(g)</button><button type="button" data-sr-symbol="(aq)">(aq)</button><button type="button" data-sr-symbol="e⁻">e⁻</button><button type="button" data-sr-symbol="Δ">Δ</button><button type="button" data-sr-symbol="°">°</button><button type="button" data-sr-symbol="×10">×10</button><button type="button" data-sr-symbol="√">√</button><button type="button" data-sr-symbol="λ">λ</button></div><label for="sr-equation"><strong>Scientific answer</strong></label><textarea id="sr-equation" class="sr-equation" data-sr-equation spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="sr-equation-help"></textarea><p id="sr-equation-help" class="sr-panel-lead">Formatting tools change expression only. MUSITU does not balance, complete or correct the chemistry in certified exam mode.</p></section><section class="sr-panel" data-sr-panel="ink" hidden><h3>Chemistry Ink</h3><p class="sr-panel-lead">Use stylus, finger or pointer. Original strokes are preserved as normalized points in the local response graph.</p><div class="sr-tools"><button type="button" data-sr-ink-undo>Undo stroke</button><button type="button" data-sr-ink-clear>Clear ink</button></div><div class="sr-ink-wrap"><canvas class="sr-ink" data-sr-ink aria-label="Chemistry handwriting and drawing canvas">Use the Accessibility Description representation if drawing is not available.</canvas></div></section>${boardPanel('structure','Molecular Structure','Construct atoms, lone pairs, stereochemical representations, orbitals, polymers and chemically meaningful bond relationships. The graph stores connectivity rather than screenshots.',structure,structureEdges)}${boardPanel('mechanism','Reaction Mechanism','Represent nucleophiles, electrophiles, intermediates, transition states and electron movement. Electron-flow connections preserve source and destination.',mechanism,mechanismEdges)}${boardPanel('graph','Scientific Graph','Build data, axes, quantities, points, errors, anomalies and trends as structured objects so each reasoning step remains inspectable.',graph,graphEdges)}${boardPanel('apparatus','Lab Apparatus','Assemble apparatus and procedural operations as an experimental response instead of describing a setup only in prose.',apparatus,apparatusEdges)}${boardPanel('particle','Particle Model','Express the submicroscopic level with particles, ions, electrons, solvent, collisions and transformations.',particle,particleEdges)}<section class="sr-panel" data-sr-panel="argument" hidden><h3>Scientific Argument</h3><p class="sr-panel-lead">Build an explanation without answer prompts: the student supplies every claim, observation, principle and conclusion.</p><div class="sr-argument-grid"><label>Claim<textarea class="sr-argument-input" data-sr-argument="claim"></textarea></label><label>Evidence / observation<textarea class="sr-argument-input" data-sr-argument="evidence"></textarea></label><label>Chemical principle<textarea class="sr-argument-input" data-sr-argument="principle"></textarea></label><label>Conclusion<textarea class="sr-argument-input" data-sr-argument="conclusion"></textarea></label></div></section><section class="sr-panel" data-sr-panel="accessibility" hidden><h3>Accessibility Description</h3><p class="sr-panel-lead">Provide or review a structured verbal equivalent of the scientific response. This channel is first-class, not an afterthought to a picture.</p><label for="sr-accessibility"><strong>Scientific description</strong></label><textarea id="sr-accessibility" class="sr-accessibility" data-sr-accessibility placeholder="Describe the structure, graph, apparatus, particle model or mechanism in scientifically precise language."></textarea></section><section class="sr-panel" data-sr-panel="graph-data" hidden><h3>Scientific Response Graph</h3><p class="sr-panel-lead">This deterministic local representation unifies text, ink, scientific objects, cross-representation links, argument structure, accessibility description and bounded construction provenance.</p><div class="sr-tools"><button type="button" data-sr-toggle-graph>Show / hide graph</button><button type="button" data-sr-export>Copy graph</button></div><pre class="sr-graph-output" data-sr-graph-output tabindex="0"></pre></section><div class="sr-bottom"><span class="sr-status" data-sr-status>Ready — local draft only</span><div class="sr-actions"><button type="button" data-sr-reset>Clear local response</button><button type="button" data-sr-reopen>Reopen</button><button class="sr-finish" type="button" data-sr-finalize>Finish response for review</button></div></div><div class="sr-live" data-sr-live aria-live="polite" aria-atomic="true"></div></section><p class="app-note"><strong>Assessment integrity:</strong> this response surface helps a student express Chemistry; it does not solve Chemistry. A future assessment service can consume the Scientific Response Graph without weakening the server-authoritative commerce or entitlement boundary.</p>`;
}

function premiumView(){
  const features=PREMIUM_FEATURES.map(x=>`<li>${appEsc(x)}</li>`).join('');
  return `<section class="app-hero"><span class="app-eyebrow">Premium</span><h1>Unlock full mastery.</h1><p>Premium adds the complete Chemistry learning and exam-preparation workflow while keeping payment verification outside the offline shell.</p></section><section class="app-section"><div class="app-section-head"><h2>Premium includes</h2><p>No paid access preselected</p></div><div class="app-card"><div class="app-card-row"><div><ul class="app-list">${features}</ul></div></div></div><span class="app-online-note">Internet required to view current secure prices and purchase</span><div class="app-actions"><a class="app-action primary" href="/chemistry/plans">View secure plan options</a><a class="app-action" href="/chemistry/app?view=help">Need help first?</a></div></section><p class="app-note"><strong>Payment boundary:</strong> this installed page contains no cached price or entitlement decision. Current pricing, checkout, settlement verification and Premium issuance remain server-authoritative.</p>`;
}

function helpView(){
  return `<section class="app-hero"><span class="app-eyebrow">Help</span><h1>Help without leaving MUSITU.</h1><p>Use these recovery steps first. Support links only leave the app when you deliberately choose an external contact or secure web action.</p></section><section class="app-section"><div class="app-section-head"><h2>Quick recovery</h2><p>Safe first steps</p></div><div class="app-card"><article class="app-card-row"><span class="app-step">1</span><div><h3>App or install issue</h3><p>Reconnect once, open MUSITU, then retry. For installation diagnostics use the dedicated local check.</p></div></article><article class="app-card-row"><span class="app-step">2</span><div><h3>Premium or payment issue</h3><p>Do not create repeated payments. Premium remains locked until settlement is independently verified.</p></div></article><article class="app-card-row"><span class="app-step">3</span><div><h3>Privacy &amp; credentials</h3><p>Never send a password, payment PIN, OTP, private key or full payment credential to support.</p></div></article></div><div class="app-actions"><a class="app-action" href="/chemistry/install/diagnostics">Run install check</a><a class="app-action" href="/chemistry/verify">Verify release</a></div></section><section class="app-contact"><h3>Contact MUSITU support</h3><p>WhatsApp ${appEsc(SUPPORT.whatsappDisplay)}</p><a class="app-primary" href="${appEsc(SUPPORT.whatsappUrl)}">Open WhatsApp support</a></section>`;
}

function onboarding(){
  return `<section class="app-onboarding" id="app-onboarding" hidden aria-label="First launch introduction"><div class="app-onboarding-card"><article class="app-onboarding-step" data-app-onboarding-step><span class="app-onboarding-kicker">Step 1 of 3</span><h2>Diagnose</h2><p>Find the Chemistry areas that need attention before spending time revising everything.</p></article><article class="app-onboarding-step" data-app-onboarding-step hidden><span class="app-onboarding-kicker">Step 2 of 3</span><h2>Revise</h2><p>Focus your effort where it matters instead of treating every topic as equally weak.</p></article><article class="app-onboarding-step" data-app-onboarding-step hidden><span class="app-onboarding-kicker">Step 3 of 3</span><h2>Prove</h2><p>Use exam pressure to reveal what still needs work, then express the science precisely.</p></article><div class="app-dots" aria-hidden="true"><span data-app-onboarding-dot></span><span data-app-onboarding-dot></span><span data-app-onboarding-dot></span></div><div class="app-onboarding-actions"><button class="skip" id="app-onboarding-skip" type="button">Skip</button><button class="next" id="app-onboarding-next" type="button">Next</button></div></div></section>`;
}

export function renderChemistryApp({view='home'}={}){
  const active=normalizeAppView(view);
  const name=appEsc(PRODUCT.name);
  const body=active==='rescue'?rescueView():active==='exam'?examView():active==='premium'?premiumView():active==='help'?helpView():homeView();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#07101f"><title>${name}</title><link rel="manifest" href="/chemistry/manifest.webmanifest?v=2"><link rel="apple-touch-icon" href="/chemistry/assets/musitu-chemistry-192.png"><link rel="stylesheet" href="/chemistry/assets/app-shell.css?v=4"><script src="/chemistry/assets/app-shell.js?v=4" defer></script></head><body><div class="app-shell"><header class="app-topbar"><div class="app-brand"><div class="app-icon" aria-hidden="true">M</div><div class="app-brand-copy"><strong>MUSITU Chemistry</strong><span>Education Nexus</span></div></div><span class="app-state" data-app-install-state>Installed</span></header><main class="app-main">${body}</main>${nav(active)}</div>${onboarding()}</body></html>`;
}

export const CHEMISTRY_APP_URL=APP_URL;
export {normalizeAppView};
