/** Operator-only D1 transport for one freshly provisioned acceptance database.
 * One HTTP attempt per operation. A lost mutation response must be reconciled,
 * never automatically resent. This module needs no Node APIs or provider keys.
 */
const encoder=new TextEncoder();
const statementState=new WeakMap();
const runPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;

export class RemoteD1Error extends Error{
  constructor(code,{message,status,mayHaveExecuted=false}={}){
    super(message||code);
    this.name='RemoteD1Error';this.code=code;
    this.mayHaveExecuted=mayHaveExecuted;
    if(status!==undefined)this.status=status;
  }
}

function target(baseUrl){
  const url=new URL(baseUrl);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&local))||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new TypeError('one HTTPS acceptance origin required');
  return new URL('/rpc-d1',url).href;
}
function wireValue(value){
  if(value===null||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return value;
  if(value instanceof ArrayBuffer)return {$d1_blob:[...new Uint8Array(value)]};
  if(ArrayBuffer.isView(value))return {$d1_blob:[...new Uint8Array(value.buffer,value.byteOffset,value.byteLength)]};
  throw new TypeError('D1 bindings require null, finite numbers, strings, or binary values');
}
function sqlText(sql){
  if(typeof sql!=='string'||!sql.trim()||encoder.encode(sql).byteLength>262144)throw new TypeError('bounded nonempty D1 SQL required');
  return sql;
}
function deadline(timeoutMs){
  const controller=new AbortController();let failure;
  const timer=setTimeout(()=>{failure=new RemoteD1Error('D1_RPC_DEADLINE',{mayHaveExecuted:true});controller.abort(failure);},timeoutMs);
  return {
    signal:controller.signal,
    async wait(work){
      if(failure)throw failure;
      let aborted;
      const stop=new Promise((_,reject)=>{aborted=()=>reject(failure);controller.signal.addEventListener('abort',aborted,{once:true});});
      try{return await Promise.race([Promise.resolve().then(work),stop]);}
      finally{controller.signal.removeEventListener('abort',aborted);}
    },
    dispose(){clearTimeout(timer);controller.abort();},
  };
}
async function responseJson(response,context,maxBytes){
  const announced=Number(response.headers.get('content-length')||0);
  if(announced>maxBytes){void response.body?.cancel().catch(()=>{});throw new RemoteD1Error('D1_RPC_BODY_LIMIT',{mayHaveExecuted:true});}
  if(!(response.headers.get('content-type')||'').toLowerCase().startsWith('application/json')||!response.body){void response.body?.cancel().catch(()=>{});throw new RemoteD1Error('D1_RPC_PROTOCOL',{mayHaveExecuted:true});}
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',received=0,done=false;
  try{
    for(;;){
      const next=await context.wait(()=>reader.read());
      if(next.done){done=true;break;}
      received+=next.value.byteLength;
      if(received>maxBytes)throw new RemoteD1Error('D1_RPC_BODY_LIMIT',{mayHaveExecuted:true});
      text+=decoder.decode(next.value,{stream:true});
    }
    text+=decoder.decode();
    try{return JSON.parse(text);}catch{throw new RemoteD1Error('D1_RPC_PROTOCOL',{mayHaveExecuted:true});}
  }finally{
    if(!done)void reader.cancel().catch(()=>{});
    else reader.releaseLock();
  }
}

export function createRemoteD1({baseUrl,operatorToken,runId,fetchImpl=globalThis.fetch,timeoutMs=15000,maxBodyBytes=8388608,maxRequestBytes=4194304}={}){
  const url=target(baseUrl);
  if(typeof operatorToken!=='string'||!/^[\x21-\x7e]{32,512}$/.test(operatorToken))throw new TypeError('bounded operator bearer required');
  if(typeof runId!=='string'||!runPattern.test(runId))throw new TypeError('isolated acceptance run id required');
  if(typeof fetchImpl!=='function')throw new TypeError('fetch implementation required');
  for(const [value,limit,label]of[[timeoutMs,60000,'deadline'],[maxBodyBytes,16777216,'response byte limit'],[maxRequestBytes,4194304,'request byte limit']])if(!Number.isSafeInteger(value)||value<1||value>limit)throw new TypeError(`invalid RPC ${label}`);
  const owner={};
  async function rpc(operation){
    const body=JSON.stringify({run_id:runId,...operation});
    if(encoder.encode(body).byteLength>maxRequestBytes)throw new RemoteD1Error('D1_RPC_REQUEST_LIMIT');
    const context=deadline(timeoutMs);
    try{
      const response=await context.wait(()=>fetchImpl(url,{method:'POST',headers:{authorization:'Bearer '+operatorToken,'content-type':'application/json',accept:'application/json'},body,redirect:'error',credentials:'omit',cache:'no-store',signal:context.signal}));
      if(response.redirected||response.status>=300&&response.status<400||response.url&&new URL(response.url).origin!==new URL(url).origin){
        void response.body?.cancel().catch(()=>{});
        throw new RemoteD1Error('D1_RPC_TRANSPORT_POLICY',{mayHaveExecuted:true});
      }
      const result=await responseJson(response,context,maxBodyBytes);
      if(!response.ok||result?.ok!==true){
        const error=result?.error;
        throw new RemoteD1Error(typeof error?.code==='string'?error.code:'D1_RPC_REJECTED',{status:response.status,message:typeof error?.message==='string'?error.message:'D1 RPC request rejected',mayHaveExecuted:error?.may_have_executed===true});
      }
      if(result.run_id!==runId||!Object.hasOwn(result,'result'))throw new RemoteD1Error('D1_RPC_PROTOCOL',{mayHaveExecuted:true});
      return result.result;
    }catch(error){
      if(error instanceof RemoteD1Error)throw error;
      throw new RemoteD1Error('D1_RPC_NETWORK',{mayHaveExecuted:true});
    }finally{context.dispose();}
  }
  function prepare(sql,params=[]){
    const state={owner,sql:sqlText(sql),params};
    const statement=Object.freeze({
      bind(...values){return prepare(state.sql,values.map(wireValue));},
      first(column){
        if(column!==undefined&&(typeof column!=='string'||!column||column.length>200))throw new TypeError('bounded first-column name required');
        return rpc({action:'first',sql:state.sql,params:state.params,...(column===undefined?{}:{column})});
      },
      all(){return rpc({action:'all',sql:state.sql,params:state.params});},
      run(){return rpc({action:'run',sql:state.sql,params:state.params});},
    });
    statementState.set(statement,state);return statement;
  }
  return Object.freeze({
    prepare,
    batch(statements){
      if(!Array.isArray(statements)||!statements.length||statements.length>100)throw new TypeError('one bounded nonempty D1 batch required');
      return rpc({action:'batch',statements:statements.map(statement=>{
        const state=statementState.get(statement);
        if(!state||state.owner!==owner)throw new TypeError('batch statement belongs to another D1 binding');
        return {sql:state.sql,params:state.params};
      })});
    },
    exec(sql){return rpc({action:'exec',sql:sqlText(sql)});},
  });
}
