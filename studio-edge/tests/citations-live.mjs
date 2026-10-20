import assert from 'node:assert/strict';

const base=process.env.TARGET_WORKER;
assert.ok(base?.startsWith('https://'),'Expected HTTPS canary or production Worker');
const ORIGIN='https://evansmusitu.github.io';
const fetchLimited=(url,init={})=>fetch(url,{...init,signal:AbortSignal.timeout(80000)});
let ready=false;
for(let attempt=0;attempt<15;attempt++){
  const response=await fetchLimited(base+'/api/health?evidenceCheck='+Date.now()+'-'+attempt,{headers:{origin:ORIGIN,'cache-control':'no-cache'}});
  if(response.ok){
    const info=await response.json();
    if(info.service==='MUSITU Intelligence Edge' && info.tools?.some(tool=>tool.id==='research')){
      ready=true;break;
    }
  }
  await new Promise(resolve=>setTimeout(resolve,2500));
}
assert.equal(ready,true,'Public backend not available');

const arithmetic=await fetchLimited(base+'/api/calculate',{
  method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},
  body:JSON.stringify({expression:'40+2'})
});
assert.equal(arithmetic.status,200,'Calculator regression');
assert.equal((await arithmetic.json()).result,42);

const response=await fetchLimited(base+'/api/chat',{
  method:'POST',
  headers:{origin:ORIGIN,'content-type':'application/json'},
  body:JSON.stringify({
    mode:'research',
    prompt:'Research quantum computing using available public sources. Explain the key ideas and cite only the sources that were actually retrieved.'
  })
});
const raw=await response.text();
let data;
try {data=JSON.parse(raw);}catch{throw Error('Research returned invalid JSON');}
if(response.status!==200)throw Error('Research returned HTTP '+response.status+': '+JSON.stringify(data).slice(0,300));
assert.equal(data.mode,'research');
assert.equal(data.liveSearch,true);
assert.ok(Array.isArray(data.sources) && data.sources.length>0,'No actual sources returned');
assert.ok(data.reply.length>60,'Research mode must answer');
assert.equal(data.citationAudit.retrievedSourceCount,data.sources.length);
assert.ok(['indices-linked','no-inline-citations','invalid-indices-removed'].includes(data.citationAudit.status));
assert.match(data.citationAudit.note,/NOT been independently verified/);
assert.ok(data.citationAudit.linkedSourceNumbers.every(id=>id>=1&&id<=data.sources.length),'No fabricated citation indices allowed');
assert.ok(data.citationAudit.invalidSourceNumbersRemoved.every(Number.isInteger));
assert.ok(data.sources.every(x=>x.url.startsWith('https://en.wikipedia.org/wiki/')||x.url.startsWith('https://news.ycombinator.com/item?id=')));
const ids=[...data.reply.matchAll(/\[(\d{1,3})\]/g)].map(match=>Number(match[1]));
assert.ok(ids.every(id=>id>=1&&id<=data.sources.length),'Unsupported source index in final answer');
console.log('RESEARCH REFERENCE AUDIT LIVE PASS; backend',base,'sources',data.sources.length,'audit',data.citationAudit.status,'answer length',data.reply.length);
