/**
 * MUSITU Axiom / Gemini Enterprise A2A v0.3 candidate (ISOLATED).
 * Only two read-only quantitative operations are exposed. Every execution is
 * authenticated, allowlisted and delegated to an external, separately approved
 * AXIOM core. No model-generated instructions are executed or interpreted.
 * This file does NOT deploy or modify OpenAI/Claude or AXIOM production.
 */
const VERSION = '0.1.0-isolated';
const MAX_BODY = 32 * 1024;
const MAX_RESULT = 64 * 1024;
const text = v => typeof v === 'string' && v.length > 0;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const onlyKeys = (obj, keys) => Object.keys(obj).every(k => keys.includes(k));

const OPS = Object.freeze({
  'arithmetic.evaluate': {
    tool: 'axiom_arithmetic_evaluate',
    validate: a => record(a) && onlyKeys(a, ['expression']) && text(a.expression) && a.expression.length <= 500 && /^[0-9 .+\-*/()%\s^]+$/.test(a.expression)
  },
  'finance.npv': {
    tool: 'investment_npv',
    validate: a => record(a) && onlyKeys(a, ['rate','cashflows']) && finite(a.rate) && a.rate > -1 && a.rate <= 20 && Array.isArray(a.cashflows) && a.cashflows.length >= 2 && a.cashflows.length <= 500 && a.cashflows.every(finite)
  }
});

function json(status, value, headers={}) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...headers }
  });
}
function rpcError(id, code, message, status=400) {
  return json(status, {jsonrpc:'2.0', id, error:{code,message}});
}

export function buildAgentCard(baseUrl) {
  const u = new URL(baseUrl);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error('A2A card requires HTTPS');
  return {
    protocolVersion:'0.3.0', name:'MUSITU Axiom — Quantitative Analysis (isolated candidate)',
    description:'Evidence-oriented quantitative tool invocation. This candidate offers explicitly structured arithmetic and net-present-value analysis; no trade execution or fund movement.',
    url:u.toString(), version:VERSION,
    capabilities:{streaming:true,pushNotifications:false,stateTransitionHistory:false},
    skills:[
      {id:'arithmetic-evaluate', name:'Arithmetic evaluation', description:'Evaluate an arithmetic expression using the MUSITU Axiom quantitative core. Pass JSON text {"operation":"arithmetic.evaluate","args":{"expression":"40+2"}}.', tags:['quantitative','arithmetic'], examples:['{"operation":"arithmetic.evaluate","args":{"expression":"40+2"}}']},
      {id:'investment-npv', name:'Net present value', description:'Compute net present value using the MUSITU Axiom quantitative core. Pass JSON text {"operation":"finance.npv","args":{"rate":0.12,"cashflows":[-1000000,300000,350000,400000,450000]}}.', tags:['finance','npv'], examples:['{"operation":"finance.npv","args":{"rate":0.12,"cashflows":[-1000000,300000,350000,400000,450000]}}']}
    ],
    defaultInputModes:['text/plain'], defaultOutputModes:['text/plain']
  };
}

function parsedCall(body) {
  if(!record(body) || body.jsonrpc!=='2.0' || !(typeof body.id==='string' || typeof body.id==='number') || !['message/send','message/stream'].includes(body.method)) return null;
  const m = body.params?.message;
  if (!record(m) || m.role!=='user' || !text(m.messageId) || !Array.isArray(m.parts) || m.parts.length!==1 || m.parts[0]?.kind!=='text' || !text(m.parts[0].text) || m.parts[0].text.length>MAX_BODY) return null;
  let cmd;
  try { cmd=JSON.parse(m.parts[0].text); } catch { return null; }
  if (!record(cmd) || !onlyKeys(cmd,['operation','args']) || !text(cmd.operation) || !record(cmd.args)) return null;
  return cmd;
}

function finishResponse(id, method, operation, res) {
  // The executor never gets to select a method, operation, or caller identity.
  const result = {
    kind:'message', role:'agent', messageId:crypto.randomUUID(),
    parts:[{kind:'text',text:res.text.slice(0,MAX_RESULT)}],
    metadata:{operation, provider:'MUSITU Axiom', source:'authenticated-core', evidence:res.evidence || null}
  };
  const response = {jsonrpc:'2.0',id,result};
  if (method === 'message/stream') return new Response(`data: ${JSON.stringify(response)}\n\n`,{
    status:200,headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
  });
  return json(200,response);
}

export function createA2AHandler({enabled=false,baseUrl,verify,execute}) {
  return async function handle(req) {
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/.well-known/agent-card.json') {
      try { return json(200,buildAgentCard(baseUrl)); } catch { return json(503,{error:'agent_card_not_configured'}); }
    }
    if (req.method === 'GET' && path === '/health') return json(enabled?200:503,{status: enabled?'configured_candidate':'disabled', version:VERSION,production_certified:false});
    if (path !== '/a2a') return json(404,{error:'not_found'});
    if (req.method !== 'POST') return json(405,{error:'method_not_allowed'},{allow:'POST'});
    if (!enabled || typeof execute !== 'function' || typeof verify !== 'function') return json(503,{error:'candidate_not_enabled'});
    const authorization=req.headers.get('authorization')||'';
    if (!/^Bearer [^\s]+$/.test(authorization)) return json(401,{error:'invalid_authorization'});
    const token=authorization.slice(7);
    let principal;
    try { principal=await verify(token); } catch { return json(401,{error:'authorization_failed'}); }
    if (!principal || !text(principal.sub)) return json(401,{error:'authorization_failed'});
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json(415,{error:'content_type_must_be_json'});
    if (Number(req.headers.get('content-length')||'0')>MAX_BODY) return json(413,{error:'request_too_large'});
    let raw;
    try { raw=await req.text(); } catch { return rpcError(null,-32700,'Malformed JSON'); }
    if (raw.length>MAX_BODY) return json(413,{error:'request_too_large'});
    let body;
    try {body=JSON.parse(raw);} catch {return rpcError(null,-32700,'Malformed JSON');}
    const id=typeof body?.id==='string'||typeof body?.id==='number'?body.id:null;
    if (!record(body) || body.jsonrpc!=='2.0' || !['message/send','message/stream'].includes(body.method)) return rpcError(id,-32601,'Unsupported A2A method');
    const cmd=parsedCall(body);
    if(!cmd || !Object.hasOwn(OPS,cmd.operation) || !OPS[cmd.operation].validate(cmd.args)) return rpcError(id,-32602,'Invalid request or operation');
    let result;
    try { result=await execute({tool:OPS[cmd.operation].tool,args:cmd.args,token,principal}); }
    catch { return rpcError(id,-32000,'AXIOM core is unavailable',502); }
    if (!record(result) || typeof result.text !== 'string' || result.text.length>MAX_RESULT || (result.evidence!==undefined && typeof result.evidence!=='string')) return rpcError(id,-32000,'AXIOM core returned invalid result',502);
    return finishResponse(id,body.method,cmd.operation,result);
  };
}

function secureHttpsUrl(value) {
  if (!text(value)) throw new Error('Missing endpoint');
  const u = new URL(value);
  if (u.protocol!=='https:' || u.username || u.password || u.hash) throw new Error('Endpoint must be HTTPS');
  return u.toString();
}

/**
 * Controlled production dependencies. Requires deliberately provisioned Google
 * A2A-specific OAuth userinfo and MCP URLs; no fallback to frozen OpenAI or
 * Claude endpoints. JSON-RPC tools/call is supported by AXIOM MCP gateway.
 * Session/cross-provider OAuth compatibility must still be proven live.
 */
export function makeProductionDependencies(env={},f=fetch) {
  const enabled=env.AXIOM_GOOGLE_A2A_ENABLED==='true' &&
    text(env.AXIOM_GOOGLE_A2A_URL) && text(env.AXIOM_GOOGLE_USERINFO_URL) && text(env.AXIOM_GOOGLE_MCP_URL);
  const disabled=async()=>{throw new Error('not configured');};
  if(!enabled) return {enabled:false,baseUrl:env.AXIOM_GOOGLE_A2A_URL||'https://isolated.invalid/a2a',verify:disabled,execute:disabled};
  const baseUrl=secureHttpsUrl(env.AXIOM_GOOGLE_A2A_URL);
  const userinfo=secureHttpsUrl(env.AXIOM_GOOGLE_USERINFO_URL);
  const mcp=secureHttpsUrl(env.AXIOM_GOOGLE_MCP_URL);
  const authHeaders=token=>({'authorization':`Bearer ${token}`});
  return {
    enabled:true,baseUrl,
    verify:async token=>{
      const r=await f(userinfo,{method:'GET',headers:authHeaders(token),redirect:'error'});
      if (!r.ok) return null;
      const body=await r.json();
      return record(body)&&text(body.sub)?{sub:body.sub}:null;
    },
    execute:async ({tool,args,token})=>{
      // No discovery through arbitrary client-specified URLs or tool names.
      if (!Object.values(OPS).some(x=>x.tool===tool)) throw Error('Unsupported tool');
      const request={jsonrpc:'2.0',id:7,method:'tools/call',params:{name:tool,arguments:args}};
      const r=await f(mcp,{method:'POST',headers:{...authHeaders(token),'content-type':'application/json','accept':'application/json, text/event-stream'},body:JSON.stringify(request),redirect:'error'});
      if (!r.ok) throw Error('Upstream MCP failed');
      const value=await r.json();
      if (value?.jsonrpc!=='2.0' || value.id!==7 || value.error || value.result?.isError===true) throw Error('Upstream MCP error');
      const content=value.result?.content;
      const first=Array.isArray(content)?content.find(x=>x?.type==='text'&&typeof x.text==='string'):null;
      if(!first) throw Error('Missing MCP tool text');
      return {text:first.text};
    }
  };
}

export default {
  async fetch(req,env) {
    let deps;
    try {deps=makeProductionDependencies(env);} catch { return json(503,{error:'invalid_candidate_configuration'}); }
    return createA2AHandler(deps)(req);
  }
};