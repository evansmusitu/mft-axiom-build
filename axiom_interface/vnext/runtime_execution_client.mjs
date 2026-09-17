import {parseTaskEventStream} from './runtime_task_service.mjs';

const clean=(value,limit=2000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);

export async function runConnectedTask(objective,{fetchImpl=globalThis.fetch,baseURI=globalThis.document?.baseURI,onEvent=()=>{},signal}={}){
  objective=clean(objective,2000);
  if (objective.length<3) throw new TypeError('Describe a task with at least 3 characters.');
  if (typeof fetchImpl!=='function'||!baseURI) throw new TypeError('same-origin task transport unavailable');
  const endpoint=new URL('./api/tasks',baseURI);
  const response=await fetchImpl(endpoint.href,{
    method:'POST',
    credentials:'same-origin',
    cache:'no-store',
    redirect:'error',
    referrerPolicy:'same-origin',
    headers:{accept:'text/event-stream','content-type':'application/json'},
    body:JSON.stringify({objective}),
    signal,
  });
  if (!response.ok) {
    let body={};
    try { body=await response.json(); } catch {}
    const error=new Error(clean(body.error||`Task request failed HTTP ${response.status}`,240));
    error.code=response.status===401?'AUTHENTICATION_REQUIRED':response.status===429?'RATE_LIMITED':'REQUEST_REJECTED';
    if (response.status===401&&body.sign_in_path) {
      const href=new URL(clean(body.sign_in_path,500),baseURI);
      if (href.origin===endpoint.origin) error.signInHref=href.href;
    }
    throw error;
  }
  if (!(response.headers.get('content-type')||'').toLowerCase().includes('text/event-stream')) throw new DOMException('task endpoint did not return an event stream','DataError');
  let terminal=null;
  for await (const event of parseTaskEventStream(response.body)) {
    onEvent(event);
    if (event.event==='error') {
      const error=new Error(clean(event.data?.error_message||'Task failed',300));
      error.code=clean(event.data?.error_code,80)||'TASK_FAILED';
      error.retryable=event.data?.retryable===true;
      throw error;
    }
    if (event.event==='complete') terminal=event.data;
  }
  if (!terminal||terminal.status!=='COMPLETED') throw new DOMException('task stream ended without a completed result','DataError');
  return terminal;
}

export async function inspectConnectedRuntime({fetchImpl=globalThis.fetch,baseURI=globalThis.document?.baseURI}={}){
  const endpoint=new URL('./api/runtime',baseURI);
  const response=await fetchImpl(endpoint.href,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json'}});
  const body=await response.json();
  if (!response.ok||body?.fully_connected!==true||body?.operation_count!==74) throw new DOMException('complete protected runtime is unavailable','NetworkError');
  return body;
}

export const RUNTIME_EXECUTION_CLIENT_BOUNDARY=Object.freeze({
  transport:'SAME_ORIGIN_EVENT_STREAM',
  browser_bearer_token:false,
  browser_api_key:false,
  complete_runtime_operation_count:74,
});
