import { LiveStore } from './live.js';

const WRAPPED = Symbol.for('musitu.axiom.live.durability.wrapped');
const SESSION_ARG = Object.freeze({
  permission:0,
  setRecording:0,
  setRegion:0,
  addCapture:1,
  annotate:0,
  addNote:1,
  transcriptTurn:0,
  interrupt:0,
  end:0,
});
const queues = new WeakMap();

function sessionQueue(store){
  let map=queues.get(store);
  if(!map){map=new Map();queues.set(store,map);}
  return map;
}

function enqueue(store,sessionId,task){
  if(!sessionId)return task();
  const map=sessionQueue(store),prior=map.get(sessionId)||Promise.resolve();
  const run=prior.catch(()=>{}).then(task);
  map.set(sessionId,run);
  return run.finally(()=>{if(map.get(sessionId)===run)map.delete(sessionId);});
}

export function installLiveDurabilityGuard(){
  if(LiveStore.prototype[WRAPPED])return;
  for(const [name,index] of Object.entries(SESSION_ARG)){
    const original=LiveStore.prototype[name];
    if(typeof original!=='function')throw new TypeError(`LiveStore.${name} unavailable`);
    LiveStore.prototype[name]=function(...args){return enqueue(this,args[index],()=>original.apply(this,args));};
  }
  Object.defineProperty(LiveStore.prototype,WRAPPED,{value:true,configurable:false,enumerable:false,writable:false});
}

export function attachLiveDurability({api,emit=()=>{},timeoutMs=10000}={}){
  if(!api?.store||typeof api.toggleRecording!=='function')throw new TypeError('Axiom Live API required');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const captureBaseline=new Map();

  async function awaitCaptureAfterStop(modality,baseline,timeout=timeoutMs){
    const sessionId=api.getCurrentSessionId();
    const deadline=performance.now()+timeout;
    while(performance.now()<=deadline){
      const row=await api.store.get(sessionId);
      if(row&&row.recording?.[modality]===false&&(row.captures?.length||0)>=baseline+1)return row;
      await sleep(10);
    }
    throw new DOMException(`durable ${modality} capture did not settle`,'TimeoutError');
  }

  async function toggle(modality){
    const sessionId=api.getCurrentSessionId();
    const before=await api.store.get(sessionId);
    if(!before)throw new DOMException('live session not found','NotFoundError');
    const stopping=Boolean(before.recording?.[modality]);
    const baseline=before.captures?.length||0;
    if(stopping)captureBaseline.set(modality,baseline);
    await api.toggleRecording(modality);
    if(stopping){
      const settled=await awaitCaptureAfterStop(modality,baseline);
      captureBaseline.delete(modality);
      emit('live.capture.durable',{state:`${modality}:${settled.captures.length}`});
      await api.refresh();
      return settled;
    }
    return api.store.get(sessionId);
  }

  for(const button of document.querySelectorAll('[data-record]')){
    button.addEventListener('click',event=>{
      event.preventDefault();event.stopImmediatePropagation();
      const modality=button.dataset.record;
      button.disabled=true;
      void toggle(modality).catch(error=>window.AxiomUI?.reportError?.({errorId:'AXIOM-LIVE-DURABILITY',component:'Axiom Live',impact:'Recording transition did not settle durably',failed:error.message,recovery:'Retry the recording after verifying project and browser permissions'})).finally(()=>api.refresh());
    },true);
  }

  const end=document.querySelector('#live-end');
  if(end){
    end.addEventListener('click',event=>{
      event.preventDefault();event.stopImmediatePropagation();
      end.disabled=true;
      void (async()=>{
        const sessionId=api.getCurrentSessionId();
        for(const modality of ['voice','camera','screen']){
          const row=await api.store.get(sessionId);
          if(row?.recording?.[modality])await toggle(modality);
        }
        await api.stopAll();
        await api.store.end(sessionId);
        emit('live.session.ended',{state:'durable-ended'});
        await api.refresh();
      })().catch(error=>window.AxiomUI?.reportError?.({errorId:'AXIOM-LIVE-END-DURABILITY',component:'Axiom Live',impact:'Live session remains active until pending captures settle',failed:error.message,recovery:'Retry End session after the active capture finishes'})).finally(()=>api.refresh());
    },true);
  }

  const durability=Object.freeze({toggle,awaitCaptureAfterStop,getPendingBaselines:()=>Object.fromEntries(captureBaseline)});
  window.AxiomLiveDurability=durability;
  return durability;
}
