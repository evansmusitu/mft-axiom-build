import {FA16_BOUNDARY,FA16OfflineQueue,FA16ReconnectSupervisor,evaluatePWAInstallState,evaluateRealDeviceEvidence} from './fa16_pwa_engine.js';

const DB_NAME='musitu-axiom-fa16-local';const DB_VERSION=1;let installPrompt=null;let installConfirmed=false;let rendering=false;
const queue=new FA16OfflineQueue();
const state={connection:'UNKNOWN',queued:0,lastMessage:'Initializing mobile supervision.',install:evaluatePWAInstallState(),device:{status:'REAL_DEVICE_NOT_PROVEN',phase_exit_earned:false}};

function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('queue'))db.createObjectStore('queue',{keyPath:'action_id'});if(!db.objectStoreNames.contains('receipts'))db.createObjectStore('receipts',{keyPath:'receipt_id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function store(mode,name,value){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode);const request=mode==='readonly'?tx.objectStore(name).getAll():tx.objectStore(name).put(value);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close();});}
async function remove(name,key){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(name,'readwrite');tx.objectStore(name).delete(key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});}
const all=name=>store('readonly',name);
const put=(name,value)=>store('readwrite',name,value);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const route=()=>location.hash.replace(/^#\/?/,'').split('/')[0]||'home';

function installLabel(){if(state.install.installed)return 'Installed';if(state.install.prompt_allowed)return 'Install AXIOM';return 'Install unavailable';}
function updatePanel(){
  const panel=document.querySelector('#fa16-mobile-console');if(!panel)return;
  panel.querySelector('[data-fa16-connection]').dataset.state=state.connection;
  panel.querySelector('[data-fa16-connection] span').textContent=state.connection.replaceAll('_',' ');
  panel.querySelector('[data-fa16-queue]').textContent=String(state.queued);
  panel.querySelector('[data-fa16-status]').textContent=state.lastMessage;
  const install=panel.querySelector('[data-fa16-install]');install.textContent=installLabel();install.disabled=!state.install.prompt_allowed||state.install.installed;
  panel.querySelector('[data-fa16-device]').textContent=`Physical-device gate: ${state.device.status}. Phase exit: ${state.device.phase_exit_earned?'earned':'blocked'}.`;
}

function renderPanel(){
  if(rendering)return;rendering=true;
  try{
    document.body.dataset.fa16Route=route();
    const root=document.querySelector('#workspace-root');if(!root||root.querySelector('#fa16-mobile-console')){updatePanel();return;}
    const panel=document.createElement('section');panel.id='fa16-mobile-console';panel.className='card fa16-mobile-console';panel.setAttribute('aria-labelledby','fa16-mobile-title');
    panel.innerHTML=`<div class="card-top"><div><small class="eyebrow">FA-16 · supervision first</small><h2 id="fa16-mobile-title">Mobile control</h2></div><span class="badge">Queue <b data-fa16-queue>0</b></span></div><div class="fa16-install"><div><div class="fa16-connection" data-fa16-connection data-state="UNKNOWN"><i aria-hidden="true"></i><span>UNKNOWN</span></div><p class="fa16-status" data-fa16-status aria-live="polite"></p></div><button class="button secondary" type="button" data-fa16-install>${escapeHtml(installLabel())}</button></div><form class="fa16-mobile-form" data-fa16-form><label>Work ID<input name="work_id" maxlength="180" required autocomplete="off"></label><label>Supervision note<textarea name="note" maxlength="12000" required placeholder="Queue a local note. No external action is executed offline."></textarea></label><button class="button primary" type="submit">Queue local note</button></form><p class="fa16-status" data-fa16-device></p>`;
    root.prepend(panel);
    panel.querySelector('[data-fa16-form]').addEventListener('submit',event=>void queueNote(event));
    panel.querySelector('[data-fa16-install]').addEventListener('click',()=>void requestInstall());
    updatePanel();
  }finally{rendering=false;}
}

async function queueNote(event){
  event.preventDefault();const form=event.currentTarget;const data=new FormData(form);
  try{
    const preview=await queue.prepare({kind:'SUPERVISION_NOTE',risk_class:'S1',payload:{work_id:data.get('work_id'),note:data.get('note')},authority_snapshot:{actor_id:'browser-session',scopes:['mobile.supervision.note'],max_risk_class:'S1'}});
    const record=await queue.enqueue(preview,preview.preview_sha256);await put('queue',record);form.reset();state.queued=(await all('queue')).length;state.lastMessage='Local supervision note queued with tamper evidence. Reconnect replay remains local and policy-revalidated.';updatePanel();if(navigator.onLine)await reconnect();
  }catch(error){state.lastMessage=`Queue blocked: ${error.code||'ERROR'} · ${error.message}`;updatePanel();}
}

async function probeOrigin(){
  const response=await fetch(new URL('/health',location.origin),{method:'GET',cache:'no-store',credentials:'same-origin',headers:{'X-Axiom-Reconnect-Probe':'fa16'}});
  return response.ok;
}
async function reconnect(){
  const records=await all('queue');const fresh=new FA16OfflineQueue();await fresh.hydrate(records);
  const supervisor=new FA16ReconnectSupervisor({queue:fresh,onStateChange:snapshot=>{state.connection=snapshot.state;updatePanel();}});
  const result=await supervisor.reconnect({browser_online:navigator.onLine,probe:probeOrigin,policyRevalidate:async record=>({authorized:record.risk_class==='S1'&&!record.external&&record.authority_snapshot.scopes.includes(record.scope),scope:record.scope,authority_sha256:record.authority_sha256}),applyLocal:async record=>({stored_locally:true,kind:record.kind,action_id:record.action_id})});
  for(const receipt of result.receipts||[]){if(receipt.status==='COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT'){await put('receipts',receipt);await remove('queue',receipt.action_id);}}
  state.queued=(await all('queue')).length;state.lastMessage=result.network_verified?'Network verified. Safe local replay completed; no external side effect occurred.':'Browser signal received, but origin reachability is not verified.';updatePanel();
}

async function requestInstall(){
  if(!installPrompt)return;await installPrompt.prompt();const choice=await installPrompt.userChoice;state.lastMessage=`Install prompt result: ${choice.outcome}. Installation is not claimed until the browser confirms it.`;installPrompt=null;state.install=evaluatePWAInstallState({standalone:matchMedia('(display-mode: standalone)').matches,appinstalled_event:installConfirmed,service_worker_controlled:Boolean(navigator.serviceWorker?.controller)});updatePanel();
}

async function registerPWA(){
  if(!('serviceWorker' in navigator)){state.lastMessage='Service workers are unavailable in this browser.';return;}
  if(!isSecureContext&&!['localhost','127.0.0.1'].includes(location.hostname)){state.lastMessage='PWA service worker requires a secure context.';return;}
  try{await navigator.serviceWorker.register('./fa16_service_worker.js',{scope:'./'});await navigator.serviceWorker.ready;state.install=evaluatePWAInstallState({standalone:matchMedia('(display-mode: standalone)').matches,appinstalled_event:installConfirmed,service_worker_controlled:Boolean(navigator.serviceWorker.controller)});}
  catch(error){state.lastMessage=`Service-worker registration failed: ${error.message}`;}
}

async function boot(){
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;state.install=evaluatePWAInstallState({prompt_available:true,service_worker_controlled:Boolean(navigator.serviceWorker?.controller)});updatePanel();});
  window.addEventListener('appinstalled',()=>{installConfirmed=true;installPrompt=null;state.install=evaluatePWAInstallState({appinstalled_event:true,service_worker_controlled:true});state.lastMessage='Installation confirmed by the browser.';updatePanel();});
  window.addEventListener('online',()=>void reconnect());window.addEventListener('offline',()=>{state.connection='OFFLINE';state.lastMessage='Offline. Only allow-listed local S0/S1 drafts can be queued.';updatePanel();});
  window.addEventListener('hashchange',()=>setTimeout(renderPanel,0));new MutationObserver(()=>renderPanel()).observe(document.querySelector('#workspace-root'),{childList:true});
  await registerPWA();state.device=await evaluateRealDeviceEvidence([]);state.queued=(await all('queue')).length;renderPanel();await reconnect();
}

window.MusituFA16=Object.freeze({boundary:FA16_BOUNDARY,reconnect:()=>reconnect(),deviceStatus:()=>({...state.device}),queueCount:()=>state.queued});
void boot();
