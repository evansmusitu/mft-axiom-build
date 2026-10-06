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
}finally{
  globalThis.fetch=originalFetch;
}

console.log("MUSITU_AXIOM_OPERATOR_REVIEWER_CLONE_CONTRACT_PASS");
