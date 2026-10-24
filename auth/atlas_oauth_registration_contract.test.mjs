import assert from 'node:assert/strict';
import provider,{ATLAS_OAUTH_REDIRECT,ATLAS_OAUTH_CLIENT_NAME} from './musitu_axiom_oauth_worker.mjs';
let dbWrites=[];
const saved=new Map();
const db={
 prepare(sql){return {bind(...args){return {
  async run(){
   dbWrites.push({sql});
   if(sql.startsWith('INSERT INTO oauth_clients'))saved.set(args[0],{client_name:args[2],redirect_uris_json:args[1]});
   return {success:true,meta:{changes:1}};
  },
  async first(){
   if(sql.startsWith('SELECT client_name,redirect_uris_json FROM oauth_clients'))return saved.get(args[0])||null;
   throw Error('Unexpected statement');
  }
 };}};}
};
async function register(name,uri,enabled){
 const response=await provider.fetch(new Request('https://auth.mftintelligence.com/oauth/register',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({client_name:name,redirect_uris:[uri]})
 }),{AXIOM_DB:db,ATLAS_OAUTH_CALLBACK_ENABLED:enabled?'enabled':'disabled'});
 return {status:response.status,data:await response.json()};
}
const disabled=await register(ATLAS_OAUTH_CLIENT_NAME,ATLAS_OAUTH_REDIRECT,false);
assert.equal(disabled.status,400);
assert.equal(dbWrites.length,0);
const aliases=[
 'https://musitu-atlas-ai-lab.vercel.app/api/axiom/capabilities?state=evil',
 'https://musitu-atlas-ai-lab.vercel.app.evil.example/api/axiom/capabilities',
 'https://musitu-atlas-ai-lab.vercel.app/api/axiom/execute',
 'https://musitu-atlas-ai-lab.vercel.app/api/axiom/capabilities#fragment',
];
for(const alias of aliases)assert.equal((await register(ATLAS_OAUTH_CLIENT_NAME,alias,true)).status,400);
assert.equal(dbWrites.length,0);
assert.equal((await register('Other Client',ATLAS_OAUTH_REDIRECT,true)).status,400);
const ok=await register(ATLAS_OAUTH_CLIENT_NAME,ATLAS_OAUTH_REDIRECT,true);
assert.equal(ok.status,201);
assert.ok(/^musitu_dcr_/.test(ok.data.client_id));
assert.deepEqual(ok.data.redirect_uris,[ATLAS_OAUTH_REDIRECT]);
assert.equal(dbWrites.length,1);
const c=await provider.fetch(new Request(
 'https://auth.mftintelligence.com/oauth/authorize?'+new URLSearchParams({
 response_type:'code',client_id:ok.data.client_id,redirect_uri:ATLAS_OAUTH_REDIRECT,
 resource:'https://mcp.mftintelligence.com',scope:'axiom.execute',
 code_challenge:'A'.repeat(43),code_challenge_method:'S256'
 }).toString()
),{AXIOM_DB:db,ATLAS_OAUTH_CALLBACK_ENABLED:'disabled'});
assert.equal(c.status,400);
assert.equal(dbWrites.length,1);
const approve=await provider.fetch(new Request(
 'https://auth.mftintelligence.com/oauth/authorize?'+new URLSearchParams({
 response_type:'code',client_id:ok.data.client_id,redirect_uri:ATLAS_OAUTH_REDIRECT,
 resource:'https://mcp.mftintelligence.com',scope:'axiom.execute',
 code_challenge:'A'.repeat(43),code_challenge_method:'S256'
 }).toString()
),{AXIOM_DB:db,ATLAS_OAUTH_CALLBACK_ENABLED:'enabled'});
assert.equal(approve.status,200);
const page=await approve.text();
assert.ok(page.includes('Authorize MUSITU ATLAS'));
assert.ok(!page.includes('Authorize ChatGPT'));
assert.equal(dbWrites.length,2);
const chatgpt=await register('ChatGPT','https://chatgpt.com/connector/oauth/atlas-regression',false);
assert.equal(chatgpt.status,201);
console.log('PASS: disabled ATLAS registration causes zero D1 writes');
console.log('PASS: exact ATLAS callback and named-client registration succeed when explicitly opted in');
console.log('PASS: disabled callback cannot be used to authorize existing ATLAS clients');
console.log('PASS: legacy ChatGPT connector redirect registration remains functional');

console.log('PASS: owner consent names MUSITU ATLAS, not the unrelated ChatGPT client');
