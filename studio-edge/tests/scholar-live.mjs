import assert from 'node:assert/strict';
const edge=process.env.TARGET_WORKER;
assert.ok(edge?.startsWith('https://'),'Known Cloudflare Worker HTTPS target required.');
const site='https://evansmusitu.github.io';
async function send(path,data){
 const response=await fetch(edge+path,{
  method:'POST',headers:{origin:site,'content-type':'application/json'},
  body:JSON.stringify(data),signal:AbortSignal.timeout(55000)
 });
 const body=await response.text();let json;
 try{json=JSON.parse(body);}catch{throw Error(path+' did not return JSON');}
 if(!response.ok)throw Error(path+' HTTP '+response.status+': '+JSON.stringify(json).slice(0,500));
 return json;
}
let info;
for(let tries=0;tries<18;tries++){
 const res=await fetch(edge+'/api/health?scholarProbe='+Date.now()+'-'+tries,{headers:{origin:site},signal:AbortSignal.timeout(15000)});
 if(res.ok){info=await res.json();if(info.scholarlyRelease==='scholar-20261020-v2' && info.tools?.some(x=>x.id==='scholar'&&x.path==='/api/scholar'))break;}
 await new Promise(r=>setTimeout(r,2000));
}
assert.ok(info?.tools?.some(x=>x.id==='scholar'),'Deployed worker did not advertise Scholar capability');
const blocked=await fetch(edge+'/api/scholar',{
 method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},
 body:JSON.stringify({query:'quantum computing'}),signal:AbortSignal.timeout(15000)
});
assert.equal(blocked.status,403,'Untrusted browser origins must be blocked');
const preflight=await fetch(edge+'/api/scholar',{method:'OPTIONS',headers:{origin:site,'access-control-request-method':'POST'},signal:AbortSignal.timeout(15000)});
assert.equal(preflight.status,204);
assert.equal(preflight.headers.get('access-control-allow-origin'),site);
const bad=await fetch(edge+'/api/scholar',{
 method:'POST',headers:{origin:site,'content-type':'application/json'},
 body:JSON.stringify({query:'x'}),signal:AbortSignal.timeout(15000)
});
assert.equal(bad.status,400,'Short invalid query must fail without calling upstream');
const math=await send('/api/calculate',{expression:'40+2'});
assert.equal(math.result,42);
const bibliography=await send('/api/scholar',{query:'quantum computing'});
assert.equal(bibliography.tool,'scholar');
assert.equal(bibliography.model,null);
assert.equal(bibliography.liveSearch,true);
assert.ok(Array.isArray(bibliography.sources)&&bibliography.sources.length>=1,'Actual DOI records required');
for(const item of bibliography.sources){
 assert.match(item.doi,/^10\.\d{4,9}\//);
 assert.ok(item.title.length>2);
 assert.match(item.url,/^https:\/\/doi\.org\/10\./);
 assert.equal(item.source,'Crossref');
}
assert.match(bibliography.sourceScope,/Not full text|NOT.*full text/);
console.log('LIVE SCHOLAR METADATA PASS',edge,'DOIs',bibliography.sources.length);
const synthesis=await send('/api/chat',{
 mode:'scholar',prompt:'quantum computing',history:[]
});
assert.equal(synthesis.mode,'scholar');
assert.equal(synthesis.liveSearch,true);
assert.equal(synthesis.model,'@cf/meta/llama-3.1-8b-instruct-fp8');
assert.ok(synthesis.reply.length>65,'Grounded model should return useful response');
assert.ok(Array.isArray(synthesis.sources)&&synthesis.sources.length>0,'Model answer must retain real Crossref records');
assert.equal(synthesis.citationAudit.retrievedSourceCount,synthesis.sources.length);
assert.ok(synthesis.citationAudit.linkedSourceNumbers.every(x=>x>=1&&x<=synthesis.sources.length),'Unsupported citation index leaked');
assert.match(synthesis.citationAudit.note,/NOT been independently verified/);
console.log('LIVE SCHOLAR AI SYNTHESIS PASS',edge,'sourceCount',synthesis.sources.length,'chars',synthesis.reply.length);
