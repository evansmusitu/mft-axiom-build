import assert from "node:assert/strict";

const mod=await import("../../reviewer_clone/musitu_axiom_operator_reviewer_oauth.mjs?stale="+Date.now());

const encoder=new TextEncoder();
async function sha256(value){
  const d=await crypto.subtle.digest("SHA-256",encoder.encode(value));
  return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

const csrf="csrf_test_mobile_stale";
const accountKey="fixture_mobile_account_key";
const redirect="https://chatgpt.com/connector/oauth/mobile-stale-proof";
const state="state-mobile-stale-proof";
const now=new Date();
const plus=(sec)=>new Date(now.getTime()+sec*1000).toISOString();

const flow={
  id:"flow_mobile_stale",
  client_id:"client_mobile_stale",
  redirect_uri:redirect,
  state,
  resource:"https://resource.example",
  scope:"axiom.operator.execute openid email",
  code_challenge:"x".repeat(64),
  nonce_hash:await sha256(csrf),
  created_at:now.toISOString(),
  expires_at:plus(600),
  used_at:null,
};
let batchCount=0;
const db={
  prepare(sql){
    return {
      bind(...args){
        return {
          async first(){
            if(sql.includes("FROM oprev_oauth_authorization_flows")) return flow;
            if(sql.includes("FROM oprev_api_keys")) return {
              source_key_id:"k1",
              customer_id:"c1",
              email:"reviewer@example.invalid",
              plan:"developer",
            };
            return null;
          },
          async run(){return {success:true};},
          sql,args,
        };
      }
    };
  },
  async batch(statements){
    batchCount+=1;
    assert.equal(statements.length,2);
    return [{success:true},{success:true}];
  }
};

const form=new URLSearchParams({
  flow_id:flow.id,
  musitu_account_key:accountKey,
});
const request=new Request("https://issuer.example/oauth/authorize",{
  method:"POST",
  headers:{
    "content-type":"application/x-www-form-urlencoded",
    "cookie":"musitu_oauth_flow="+encodeURIComponent(csrf),
  },
  body:form.toString(),
});

const response=await mod.default.fetch(request,{
  AXIOM_DB:db,
  OAUTH_ISSUER:"https://issuer.example",
  MCP_RESOURCE:"https://resource.example",
});
assert.equal(response.status,200);
assert.match(response.headers.get("content-type")||"",/text\/html/);
assert.equal(batchCount,1);

const html=await response.text();
assert.match(html,/Authorization complete/);
assert.match(html,/Continue to ChatGPT/);
assert.match(html,/window\.location\.replace/);
assert.match(html,/rel="noreferrer"/);

const hrefMatch=html.match(/id="continue-chatgpt"[^>]+href="([^"]+)"/);
assert.ok(hrefMatch,"completion page must expose callback href");
const callback=new URL(hrefMatch[1].replaceAll("&amp;","&"));
assert.equal(callback.origin,"https://chatgpt.com");
assert.equal(callback.pathname,"/connector/oauth/mobile-stale-proof");
assert.equal(callback.searchParams.get("state"),state);
assert.ok(callback.searchParams.get("code"),"callback must contain authorization code");

console.log("MUSITU_AXIOM_REVIEWER_STALE_PAGE_PASS");
