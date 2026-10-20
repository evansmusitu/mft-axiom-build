import assert from 'node:assert/strict';
const base=process.env.TARGET_WORKER;
assert.ok(base?.startsWith('https://'),'Live Cloudflare URL is required');
const site='https://evansmusitu.github.io';
async function api(path,payload,origin=site){
 const response=await fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(80000)});
 const json=await response.json();
 return {status:response.status,json};
}
let ready=false;
for(let i=0;i<12;i++){
 const res=await fetch(base+'/api/health?docVersion='+Date.now()+'-'+i,{headers:{origin:site},signal:AbortSignal.timeout(12000)});
 if(res.ok){const data=await res.json();if(data.tools?.some(t=>t.id==='document'&&t.maxExcerptCharacters===4800)){ready=true;break;}}
 await new Promise(resolve=>setTimeout(resolve,3000));
}
assert.equal(ready,true,'Deployed health has no document analysis capability');
const rejected=await api('/api/chat',{mode:'document',prompt:'Please summarize the document.',fileName:'study.txt',excerpt:'short'});
assert.equal(rejected.status,400);
assert.equal(rejected.json.code,'INVALID_DOCUMENT_EXCERPT');
const badOrigin=await api('/api/chat',{mode:'document',prompt:'Please summarize the document.',fileName:'study.txt',excerpt:'These notes explain that feedback control uses sensors and actuators in robots.'},'https://attacker.example');
assert.equal(badOrigin.status,403);
const text='Laboratory notes: The control-system experiment used a temperature sensor and a relay actuator. The sensor measured temperature every second. No calibration details, error bars, or outcome comparisons were included in the supplied excerpt. The experiment was described as preliminary.';
const answer=await api('/api/chat',{mode:'document',prompt:'Summarize what is verifiable from this excerpt, and say what is missing.',fileName:'laboratory_notes.txt',excerpt:text});
assert.equal(answer.status,200,'Live document AI inference must succeed: '+JSON.stringify(answer.json).slice(0,240));
assert.equal(answer.json.mode,'document');
assert.equal(answer.json.documentReview.fileName,'laboratory_notes.txt');
assert.equal(answer.json.documentReview.analyzedCharacters,text.length);
assert.equal(answer.json.documentReview.fullFileAnalyzed,false);
assert.equal(answer.json.documentReview.storedOnServer,false);
assert.ok(answer.json.reply.length>60,'Expected substantive model analysis');
console.log('LIVE DOCUMENT ANALYSIS PASS',base,'responseChars',answer.json.reply.length);
