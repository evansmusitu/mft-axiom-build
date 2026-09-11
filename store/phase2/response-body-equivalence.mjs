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
const machineCases=[
  {path:'/store/catalog.json',accept:'application/json',title:'Verified MUSITU catalog'},
  {path:'/store/catalog.sig',accept:'text/plain',title:'Catalog signature'},
  {path:'/store/ios/source.json',accept:'application/json',title:'iOS SideStore source'},
  {path:'/store/web/adapter.json',accept:'application/json',title:'Web adapter metadata'},
  {path:'/store/android/repo/index-v1.json',accept:'application/json',title:'Android repository index'},
  {path:'/store/apps/chemistry/sbom.json',accept:'application/json',title:'Chemistry software bill of materials'},
  {path:'/store/apps/chemistry/dependencies.json',accept:'application/json',title:'Chemistry dependency manifest'},
  {path:'/store/release/channels.json',accept:'application/json',title:'Release channels'},
  {path:'/store/release/rollback-control.json',accept:'application/json',title:'Rollback control'},
  {path:'/store/bootstrap/release.json',accept:'application/json',title:'Store bootstrap release'},
  {path:'/store/locales.json',accept:'application/json',title:'Supported Store languages'}
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

  report.push({path:tc.path,request_headers:tc.headers||{},status:a.status,body_bytes:ab.length,body_sha256:sha(ab),expected_security_header_delta:expected});
}

const machineReport=[];
for(const tc of machineCases){
  const url='https://payments.mftintelligence.com'+tc.path;
  const [baseRaw,candidateRaw]=await Promise.all([
    baseline.fetch(new Request(url,{headers:{Accept:tc.accept}}),env,{}),
    candidate.fetch(new Request(url,{headers:{Accept:tc.accept}}),env,{})
  ]);
  const [baseBytes,candidateBytes]=await Promise.all([Buffer.from(await baseRaw.arrayBuffer()),Buffer.from(await candidateRaw.arrayBuffer())]);
  if(baseRaw.status!==candidateRaw.status||baseRaw.status!==200) throw new Error(`${tc.path}: machine HTTP status changed`);
  if(!baseBytes.equals(candidateBytes)) throw new Error(`${tc.path}: machine payload bytes changed ${sha(baseBytes)} != ${sha(candidateBytes)}`);
  if((baseRaw.headers.get('content-type')||'')!==(candidateRaw.headers.get('content-type')||'')) throw new Error(`${tc.path}: machine content type changed`);

  const human=await candidate.fetch(new Request(url,{headers:{Accept:'text/html'}}),env,{});
  const humanBody=await human.text();
  if(human.status!==200) throw new Error(`${tc.path}: human browser view HTTP ${human.status}`);
  if(!(human.headers.get('content-type')||'').toLowerCase().startsWith('text/html')) throw new Error(`${tc.path}: human browser view is not HTML`);
  if(!humanBody.includes('<span class="eyebrow">Machine-readable endpoint</span>')) throw new Error(`${tc.path}: human browser presentation marker missing`);
  if(!humanBody.includes(tc.title)) throw new Error(`${tc.path}: human browser title missing`);
  if(!humanBody.includes(`${tc.path}?raw=1`)) throw new Error(`${tc.path}: raw-data escape hatch missing`);
  if(humanBody.trimStart().startsWith('{')) throw new Error(`${tc.path}: browser still dumps raw JSON`);

  const rawOverride=await candidate.fetch(new Request(url+'?raw=1',{headers:{Accept:'text/html'}}),env,{});
  const rawOverrideBytes=Buffer.from(await rawOverride.arrayBuffer());
  if(!rawOverrideBytes.equals(candidateBytes)) throw new Error(`${tc.path}: ?raw=1 does not preserve original bytes`);

  machineReport.push({path:tc.path,raw_body_bytes:candidateBytes.length,raw_body_sha256:sha(candidateBytes),browser_html:true,raw_override_byte_identical:true});
}

const out={
  schema:'musitu.store.phase2.response_body_equivalence.v2',
  result:'PASS',
  cases:report,
  machine_endpoints:machineReport,
  conclusion:'Accessibility-relevant Store response bodies remain byte-identical to the baseline; machine endpoint payload bytes remain unchanged for software clients, while direct browser navigation is intentionally rendered as a readable HTML page with an explicit raw-data escape hatch.'
};
console.log(JSON.stringify(out,null,2));
