import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';

const baselinePath=process.env.BASELINE_WORKER_PATH||process.argv[2];
const candidatePath=process.env.CANDIDATE_WORKER_PATH||process.argv[3];
if(!baselinePath||!candidatePath) throw new Error('baseline and candidate worker paths required');

const load=async(path,tag)=>(await import(pathToFileURL(path).href+`?${tag}=${Date.now()}-${Math.random()}`)).default;
const baseline=await load(baselinePath,'baseline');
const candidate=await load(candidatePath,'candidate');
if(typeof baseline?.fetch!=='function'||typeof candidate?.fetch!=='function') throw new Error('worker default.fetch required');

const env={STORE_RUNTIME_PUBLICATION_STATE:'production'};
const cases=[
  {path:'/store'},
  {path:'/store?lite=1'},
  {path:'/store',headers:{'Save-Data':'on'}},
  {path:'/store?lang=sn'},
  {path:'/store?lang=nd'},
  {path:'/store/apps/chemistry'},
  {path:'/store/install'},
  {path:'/store/install?platform=android'},
  {path:'/store/install?platform=ios'},
  {path:'/store/developer'},
  {path:'/store/releases'},
  {path:'/store/status'},
  {path:'/store/offline'},
  {path:'/store/healthz'}
];

const expectedHeaderDelta=new Set([
  'content-security-policy',
  'cross-origin-opener-policy',
  'x-permitted-cross-domain-policies'
]);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonicalHeaders=h=>Object.fromEntries([...h.entries()].map(([k,v])=>[k.toLowerCase(),v]).sort(([a],[b])=>a.localeCompare(b)));
const report=[];

for(const tc of cases){
  const url='https://payments.mftintelligence.com'+tc.path;
  const makeReq=()=>new Request(url,{headers:tc.headers||{}});
  const [a,b]=await Promise.all([baseline.fetch(makeReq(),env,{}),candidate.fetch(makeReq(),env,{})]);
  const [ab,bb]=await Promise.all([Buffer.from(await a.arrayBuffer()),Buffer.from(await b.arrayBuffer())]);
  if(a.status!==b.status) throw new Error(`${tc.path}: status differs ${a.status} != ${b.status}`);
  if(!ab.equals(bb)) throw new Error(`${tc.path}: response body differs ${sha(ab)} != ${sha(bb)}`);

  const ah=canonicalHeaders(a.headers), bh=canonicalHeaders(b.headers);
  const keys=new Set([...Object.keys(ah),...Object.keys(bh)]);
  const unexpected=[];
  const expected=[];
  for(const key of [...keys].sort()){
    if((ah[key]??null)===(bh[key]??null)) continue;
    const entry={name:key,baseline:ah[key]??null,candidate:bh[key]??null};
    if(expectedHeaderDelta.has(key)) expected.push(entry); else unexpected.push(entry);
  }
  if(unexpected.length) throw new Error(`${tc.path}: unexpected header delta ${JSON.stringify(unexpected)}`);
  for(const required of expectedHeaderDelta){
    if(!(required in bh)) throw new Error(`${tc.path}: hardened header missing ${required}`);
  }
  const csp=bh['content-security-policy']||'';
  for(const token of ["worker-src 'self'","font-src 'self'","object-src 'none'","frame-src 'none'",'upgrade-insecure-requests']){
    if(!csp.includes(token)) throw new Error(`${tc.path}: hardened CSP token missing ${token}`);
  }
  if(bh['cross-origin-opener-policy']!=='same-origin') throw new Error(`${tc.path}: COOP mismatch`);
  if(bh['x-permitted-cross-domain-policies']!=='none') throw new Error(`${tc.path}: X-Permitted-Cross-Domain-Policies mismatch`);

  report.push({
    path:tc.path,
    request_headers:tc.headers||{},
    status:a.status,
    body_bytes:ab.length,
    body_sha256:sha(ab),
    expected_security_header_delta:expected
  });
}

const out={
  schema:'musitu.store.phase2.response_body_equivalence.v1',
  result:'PASS',
  cases:report,
  conclusion:'Hardened candidate response bodies are byte-identical to baseline for the tested accessibility-relevant route matrix; only the explicitly permitted security-header set differs.'
};
console.log(JSON.stringify(out,null,2));
