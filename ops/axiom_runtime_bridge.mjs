const encoder=new TextEncoder();
const clean=(value,limit=200)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,limit);

async function sha256(value){
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function randomToken(){
  const bytes=new Uint8Array(48);crypto.getRandomValues(bytes);
  return `musitu_axiom_browser_task_${btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
}

function randomId(){return `browser_task_key_${crypto.randomUUID().replaceAll('-','')}`;}

async function jsonResponse(service,path,init={}){
  if (!service?.fetch) throw new DOMException('protected runtime service binding unavailable','NetworkError');
  const response=await service.fetch(`https://axiom-runtime.internal${path}`,init);
  const text=await response.text();
  let body={};
  try { body=JSON.parse(text||'{}'); } catch {}
  return {status:response.status,body};
}

function toolNames(body){
  return (Array.isArray(body?.tools)?body.tools:[]).map(item=>clean(typeof item==='string'?item:item?.operation||item?.name||item?.id,120)).filter(Boolean);
}

export function createProtectedRuntimeBridge({db,service,tokenFactory=randomToken,idFactory=randomId,now=()=>new Date()}={}){
  if (!db?.prepare||!service?.fetch) throw new TypeError('D1 and protected runtime service bindings required');
  return Object.freeze({
    async inspect(){
      const [health,registry]=await Promise.all([
        jsonResponse(service,'/health',{headers:{accept:'application/json','user-agent':'MUSITU-Axiom-Connected-UI/1.0'}}),
        jsonResponse(service,'/v1/tools',{headers:{accept:'application/json','user-agent':'MUSITU-Axiom-Connected-UI/1.0'}}),
      ]);
      const tools=toolNames(registry.body),count=Number(registry.body?.operation_count||health.body?.operation_count);
      if (health.status!==200||health.body?.ok!==true||registry.status!==200||count!==74||tools.length!==74||new Set(tools).size!==74) throw new DOMException('complete protected runtime contract unavailable','NetworkError');
      return {ok:true,build_id:clean(registry.body?.build_id||health.body?.build_id,160),operation_count:count,tools};
    },
    async execute({customer_id,operation,args={},request_id}={}){
      customer_id=clean(customer_id,180);operation=clean(operation,120);request_id=clean(request_id,120);
      if (!customer_id||!operation||!request_id||!args||typeof args!=='object'||Array.isArray(args)) throw new TypeError('customer, operation, args and request id required');
      const token=String(tokenFactory()),keyId=clean(idFactory(),180),created=now().toISOString(),expires=new Date(now().getTime()+10*60*1000).toISOString(),tokenHash=await sha256(token);
      if (token.length<48||!/^[A-Za-z0-9._~-]+$/.test(token)||!keyId) throw new DOMException('delegated credential generation failed','SecurityError');
      await db.prepare("INSERT INTO api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,'browser-task-one-request','active',?5,NULL,?6,NULL)").bind(keyId,customer_id,tokenHash,token.slice(0,16),created,expires).run();
      let response,ledger=null;
      try {
        response=await jsonResponse(service,'/v1/compute',{
          method:'POST',
          headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json','x-musitu-request-id':request_id,'user-agent':'MUSITU-Axiom-Connected-UI/1.0'},
          body:JSON.stringify({operation,args}),
        });
        if (response.status<200||response.status>=300) throw new DOMException(`protected runtime compute failed HTTP ${response.status}`,'NetworkError');
        ledger=await db.prepare('SELECT request_id,operation,compute_units,http_status,result_sha256 FROM usage_events WHERE request_id=?1 AND customer_id=?2 AND key_id=?3 LIMIT 1').bind(request_id,customer_id,keyId).first();
        if (!ledger||ledger.request_id!==request_id||ledger.operation!==operation||Number(ledger.http_status)!==200||Number(ledger.compute_units)<=0||!/^[0-9a-f]{32,64}$/i.test(String(ledger.result_sha256||''))) throw new DOMException('protected runtime metering receipt unavailable','DataError');
      } finally {
        try {
          await db.prepare('DELETE FROM api_keys WHERE id=?1 AND key_hash=?2').bind(keyId,tokenHash).run();
        } catch {
          await db.prepare("UPDATE api_keys SET status='revoked',revoked_at=?3 WHERE id=?1 AND key_hash=?2").bind(keyId,tokenHash,now().toISOString()).run();
        }
      }
      return {
        operation,
        request_id,
        http_status:response.status,
        result:response.body?.result??response.body,
        receipt:{
          compute_units:Number(ledger.compute_units),
          result_sha256:String(ledger.result_sha256),
          runtime_receipt_present:Boolean(response.body?.receipt||response.body?.signature),
          customer_metered:true,
          delegated_credential_disclosed:false,
        },
      };
    },
  });
}

export const RUNTIME_BRIDGE_BOUNDARY=Object.freeze({
  complete_catalog_required:74,
  delegated_credential_scope:'ONE_REQUEST',
  raw_credential_persisted:false,
  browser_credential_access:false,
  metering_required:true,
});
