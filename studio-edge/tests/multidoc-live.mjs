import assert from 'node:assert/strict';
const base=process.env.TARGET_WORKER;
assert.ok(base?.startsWith('https://'),'Expected canary/production HTTPS worker');
const origin='https://evansmusitu.github.io';
async function api(body) {
  const res=await fetch(base+'/api/chat',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(80000)});
  const data=await res.json();
  return {status:res.status,data};
}
const health=await fetch(base+'/api/health?multidocTest='+Date.now(),{headers:{origin},signal:AbortSignal.timeout(15000)});
assert.equal(health.status,200);
const details=await health.json();
assert.ok(details.tools.some(tool=>tool.id==='multidocument'&&tool.maximumDocuments===3));
const invalid=await api({mode:'compare',prompt:'Compare source notes and explain their differences.',documents:[]});
assert.equal(invalid.status,400);
assert.equal(invalid.data.code,'INVALID_DOCUMENT_COLLECTION');
const single=await api({
 mode:'document',prompt:'What is the controller threshold in this PDF excerpt?',
 fileName:'robotics.pdf',excerpt:'A robotics control experiment used a Schmitt trigger with an upper threshold set at 6 volts. The excerpt does not specify the lower threshold.'
});
assert.equal(single.status,200,'PDF filename must work with live production inference');
assert.equal(single.data.documentReview.fileName,'robotics.pdf');
assert.equal(single.data.documentReview.fullFileAnalyzed,false);
assert.ok(single.data.reply.length>65);
const compare=await api({
 mode:'compare',prompt:'Compare the reported thresholds in these two reports and cite each source.',
 documents:[
  {fileName:'lab_A.pdf',excerpt:'In experiment A, the upper voltage threshold was 6 volts. The note does not mention the sensor calibration.'},
  {fileName:'lab_B.docx',excerpt:'In experiment B, the upper voltage threshold was 8 volts. The note describes the feedback sensor but omits repeated trials.'}
 ]
});
assert.equal(compare.status,200,'Live multi-document model inference must succeed: '+JSON.stringify(compare.data).slice(0,300));
assert.equal(compare.data.documentReview.comparedDocuments.length,2);
assert.equal(compare.data.documentReview.fullFileAnalyzed,false);
assert.ok(compare.data.reply.length>55);
assert.ok(compare.data.citationAudit.linkedSourceNumbers.every(id=>id===1||id===2));
assert.ok(!/\[D[3-9]\]/.test(compare.data.reply));
assert.match(compare.data.citationAudit.note,/NOT independently verified/);
console.log('LIVE PDF AND MULTI-DOCUMENT AI INFERENCE PASS',base,'responseChars',compare.data.reply.length,'citationStatus',compare.data.citationAudit.status);
