import assert from 'node:assert/strict';
const root=process.env.TARGET_WORKER;
assert.ok(root?.startsWith('https://'),'Expected pinned HTTPS Cloudflare Worker');
const origin='https://evansmusitu.github.io';
async function post(path,payload) {
  const response=await fetch(root+path,{
    method:'POST',
    headers:{'content-type':'application/json',origin},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(30000)
  });
  const body=await response.json();
  return {response,body};
}
for(const [question,result] of [['40+2',42],['what is 37*42?',1554],['calculate sqrt(144)',12]]) {
  const {response,body}=await post('/api/chat',{mode:'explore',prompt:question,history:[]});
  assert.equal(response.status,200,question+': '+JSON.stringify(body).slice(0,220));
  assert.equal(body.toolUsed,'deterministic_calculator');
  assert.equal(body.result,result);
  assert.equal(body.model,null);
  assert.match(body.reply,/deterministically verified/i);
  assert.equal(body.liveSearch,false);
  console.log('Verified no-model math route:',question,'=',result);
}
const invalid=await post('/api/chat',{mode:'learn',prompt:'calculate 1/0'});
assert.equal(invalid.response.status,400);
assert.equal(invalid.body.code,'CALCULATION_INVALID');
console.log('PUBLIC CALCULATION ROUTING PASS',root);
