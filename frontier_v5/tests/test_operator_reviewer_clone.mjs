import fs from "node:fs";
import assert from "node:assert/strict";

const oauth="reviewer_clone/musitu_axiom_operator_reviewer_oauth.mjs";
const gate="reviewer_clone/musitu_axiom_operator_reviewer_gate.mjs";
for (const p of [oauth,gate]) assert.equal(fs.existsSync(p),true,`missing ${p}`);

const o=fs.readFileSync(oauth,"utf8");
const g=fs.readFileSync(gate,"utf8");

assert.match(o,/axiom\.operator\.execute/);
assert.match(o,/openid/);
assert.match(o,/email/);
assert.doesNotMatch(o,/https:\/\/auth\.mftintelligence\.com/);
assert.doesNotMatch(o,/https:\/\/mcp\.mftintelligence\.com/);
assert.match(o,/musitu_oauth_flow/);
assert.match(o,/SameSite=Lax/);
assert.match(o,/connector\/oauth\//);
assert.doesNotMatch(o,/name="flow_nonce"/);
assert.doesNotMatch(o,/flow_nonce/);
assert.doesNotMatch(o,/authorization_response_iss_parameter_supported/);
assert.doesNotMatch(o,/searchParams\.set\("iss",c\.issuer\)/);

assert.match(g,/axiom\.operator\.execute/);
assert.match(g,/MODAL_OPERATOR_URL/);
assert.match(g,/MODAL_PROXY_KEY/);
assert.match(g,/MODAL_PROXY_SECRET/);
assert.match(g,/\.well-known\/oauth-protected-resource/);
assert.match(g,/tools\/list/);
assert.match(g,/tools\/call/);
assert.doesNotMatch(g,/https:\/\/mcp\.mftintelligence\.com/);
assert.doesNotMatch(g,/musitu_axiom_plugin_gate_v4/);


const deploy="reviewer_clone/deploy_operator_reviewer_clone.py";
assert.equal(fs.existsSync(deploy),true,`missing ${deploy}`);
const d=fs.readFileSync(deploy,"utf8");
assert.match(d,/workers\.dev/);
assert.match(d,/workers\/subdomain/);
assert.doesNotMatch(d,/rulesets/);
assert.doesNotMatch(d,/CLOUDFLARE_GLOBAL_API_KEY/);
assert.doesNotMatch(d,/X-Auth-Key/);
assert.doesNotMatch(d,/configure_custom_domain/);
assert.doesNotMatch(d,/configure_machine_transport_exception/);
assert.match(d,/Mozilla\/5\.0/);
assert.match(d,/User-Agent/);
assert.match(d,/Sec-Fetch-Site/);
const modalProxy="reviewer_clone/modal_operator_reviewer_proxy.py";
const mp=fs.readFileSync(modalProxy,"utf8");
assert.doesNotMatch(mp,/from __future__ import annotations/);
assert.match(mp,/request: Request/);


const gateModule=await import("../../reviewer_clone/musitu_axiom_operator_reviewer_gate.mjs?contract="+Date.now());
const issuer="https://issuer.example";
const resource="https://resource.example";
let forwardedRequest=null;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input, init)=>{
  forwardedRequest=new Request(input,init);
  return new Response(JSON.stringify({
    jsonrpc:"2.0",
    id:"gateway-contract",
    result:{content:[{type:"text",text:"ok"}],structuredContent:{status:"UNAVAILABLE"}}
  }),{status:200,headers:{"content-type":"application/json"}});
};
try{
  const db={
    prepare(){
      return {
        bind(){
          return {
            async first(){
              return {
                customer_id:"c1",
                issuer,
                resource,
                scope:"axiom.operator.execute",
                expires_at:"2999-01-01T00:00:00.000Z",
                revoked_at:null,
                key_status:"active",
                key_expires:null,
                key_revoked:null
              };
            }
          };
        }
      };
    }
  };
  const message={
    jsonrpc:"2.0",
    id:"gateway-contract",
    method:"tools/call",
    params:{name:"axiom.provider.status",arguments:{}}
  };
  const request=new Request(resource+"/mcp",{
    method:"POST",
    headers:{
      authorization:"Bearer reviewer-contract-token",
      "content-type":"application/json"
    },
    body:JSON.stringify(message)
  });
  const response=await gateModule.default.fetch(request,{
    AXIOM_DB:db,
    AUTH_ISSUER:issuer,
    MCP_PUBLIC_BASE:resource,
    MODAL_OPERATOR_URL:"https://modal.example",
    MODAL_PROXY_KEY:"wk-contract",
    MODAL_PROXY_SECRET:"ws-contract"
  });
  assert.equal(response.status,200);
  assert.ok(forwardedRequest);
  assert.equal(forwardedRequest.headers.get("mcp-method"),"tools/call");
  assert.equal(forwardedRequest.headers.get("mcp-name"),"axiom.provider.status");
  assert.equal(forwardedRequest.headers.get("mcp-protocol-version"),"2026-07-28");
  assert.equal(forwardedRequest.headers.get("authorization"),"Bearer wk-contract.ws-contract");
}finally{
  globalThis.fetch=originalFetch;
}


const modernGateModule=await import("../../reviewer_clone/musitu_axiom_operator_reviewer_gate.mjs?modern="+Date.now());
const modernDb={
  prepare(){
    return {bind(){return {async first(){return null;}}}};
  }
};
let modernForwarded=null;
const originalModernFetch=globalThis.fetch;
globalThis.fetch=async (input,init)=>{
  modernForwarded=new Request(input,init);
  return new Response(JSON.stringify({
    jsonrpc:"2.0",
    id:"modern-tools",
    result:{
      tools:[{
        name:"axiom.project.status",
        description:"Read project status",
        inputSchema:{type:"object",properties:{project_id:{type:"string"}},required:["project_id"],additionalProperties:false}
      }]
    }
  }),{status:200,headers:{"content-type":"application/json"}});
};
try{
  const env={
    AXIOM_DB:modernDb,
    AUTH_ISSUER:"https://issuer.example",
    MCP_PUBLIC_BASE:"https://resource.example",
    MODAL_OPERATOR_URL:"https://modal.example",
    MODAL_PROXY_KEY:"wk-contract",
    MODAL_PROXY_SECRET:"ws-contract"
  };
  const discoverReq=new Request("https://resource.example/mcp",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "mcp-protocol-version":"2026-07-28"
    },
    body:JSON.stringify({jsonrpc:"2.0",id:"discover",method:"server/discover",params:{}})
  });
  const discoverRes=await modernGateModule.default.fetch(discoverReq,env);
  assert.equal(discoverRes.status,200);
  const discover=await discoverRes.json();
  assert.equal(discover.result.resultType,"complete");
  assert.deepEqual(discover.result.supportedVersions,["2026-07-28"]);
  assert.equal(discover.result.cacheScope,"public");
  assert.equal(discover.result.ttlMs,60000);
  assert.equal(discover.result._meta["io.modelcontextprotocol/serverInfo"].name,"musitu-axiom-operator-reviewer");

  const listReq=new Request("https://resource.example/mcp",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "mcp-protocol-version":"2026-07-28"
    },
    body:JSON.stringify({
      jsonrpc:"2.0",id:"modern-tools",method:"tools/list",
      params:{_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}
    })
  });
  const listRes=await modernGateModule.default.fetch(listReq,env);
  assert.equal(listRes.status,200);
  const listed=await listRes.json();
  assert.equal(listed.result.resultType,"complete");
  assert.equal(listed.result.cacheScope,"public");
  assert.equal(listed.result.ttlMs,60000);
  assert.equal(listed.result.tools.length,1);
  assert.equal(listed.result.tools[0].name,"axiom.project.status");
  assert.equal(listed.result._meta["io.modelcontextprotocol/serverInfo"].version,"1.0.1");
}finally{
  globalThis.fetch=originalModernFetch;
}

console.log("MUSITU_AXIOM_OPERATOR_REVIEWER_CLONE_CONTRACT_PASS");
