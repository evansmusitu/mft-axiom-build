import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';

const baselinePath=process.env.BASELINE_WORKER_PATH||process.argv[2];
const candidatePath=process.env.CANDIDATE_WORKER_PATH||process.argv[3];
if(!baselinePath||!candidatePath) throw new Error('baseline and candidate worker paths required');
const load=async(path,tag)=>(await import(pathToFileURL(path).href+`?${tag}=${Date.now()}-${Math.random()}`)).default;
const baseline=await load(baselinePath,'baseline');
const candidate=await load(candidatePath,'candidate');
const env={STORE_RUNTIME_PUBLICATION_STATE:'production'};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

const normalRoutes=['/store','/store?lite=1','/store/apps/chemistry','/store/install','/store/developer','/store/releases','/store/status','/store/offline','/store/healthz'];
for(const path of normalRoutes){
  const url='https://payments.mftintelligence.com'+path;
  const [a,b]=await Promise.all([baseline.fetch(new Request(url),env,{}),candidate.fetch(new Request(url),env,{})]);
  const [ab,bb]=await Promise.all([Buffer.from(await a.arrayBuffer()),Buffer.from(await b.arrayBuffer())]);
  if(a.status!==b.status||!ab.equals(bb)) throw new Error(`${path}: normal Store response changed`);
  for(const [k,v] of a.headers){if((b.headers.get(k)||'')!==v) throw new Error(`${path}: normal header changed: ${k}`);}
  for(const [k] of b.headers){if(!a.headers.has(k)) throw new Error(`${path}: unexpected normal header added: ${k}`);}
}

const machine=[
  ['/store/catalog.json','application/json','Verified MUSITU catalog'],
  ['/store/catalog.sig','text/plain','Catalog signature'],
  ['/store/ios/source.json','application/json','iOS SideStore source'],
  ['/store/web/adapter.json','application/json','Web adapter metadata'],
  ['/store/android/repo/index-v1.json','application/json','Android repository index'],
  ['/store/apps/chemistry/sbom.json','application/json','Chemistry software bill of materials'],
  ['/store/apps/chemistry/dependencies.json','application/json','Chemistry dependency manifest'],
  ['/store/release/channels.json','application/json','Release channels'],
  ['/store/release/rollback-control.json','application/json','Rollback control'],
  ['/store/bootstrap/release.json','application/json','Store bootstrap release'],
  ['/store/locales.json','application/json','Supported Store languages']
];
const evidence=[];
for(const [path,accept,title] of machine){
  const url='https://payments.mftintelligence.com'+path;
  const [baseRaw,candidateRaw]=await Promise.all([
    baseline.fetch(new Request(url,{headers:{Accept:accept}}),env,{}),
    candidate.fetch(new Request(url,{headers:{Accept:accept}}),env,{})
  ]);
  const [baseBytes,candidateBytes]=await Promise.all([Buffer.from(await baseRaw.arrayBuffer()),Buffer.from(await candidateRaw.arrayBuffer())]);
  if(baseRaw.status!==200||candidateRaw.status!==200||!baseBytes.equals(candidateBytes)) throw new Error(`${path}: raw client bytes changed`);
  if((baseRaw.headers.get('content-type')||'')!==(candidateRaw.headers.get('content-type')||'')) throw new Error(`${path}: raw content type changed`);

  const human=await candidate.fetch(new Request(url,{headers:{Accept:'text/html','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}}),env,{});
  const html=await human.text();
  if(human.status!==200||!(human.headers.get('content-type')||'').toLowerCase().startsWith('text/html')) throw new Error(`${path}: browser view not HTML`);
  for(const token of ['Machine-readable endpoint',title,'Readable browser view.','Back to MUSITU Store',`${path}?raw=1`]) if(!html.includes(token)) throw new Error(`${path}: browser view missing ${token}`);
  if(html.trimStart().startsWith('{')||html.trimStart().startsWith('[')) throw new Error(`${path}: browser still exposes raw payload`);

  const rawOverride=await candidate.fetch(new Request(url+'?raw=1',{headers:{Accept:'text/html','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}}),env,{});
  const rawOverrideBytes=Buffer.from(await rawOverride.arrayBuffer());
  if(!rawOverrideBytes.equals(candidateBytes)) throw new Error(`${path}: raw override changed bytes`);
  evidence.push({path,raw_bytes:candidateBytes.length,raw_sha256:sha(candidateBytes),browser_html:true,raw_override_identical:true});
}
console.log(JSON.stringify({schema:'musitu.store.phase2.browser_machine_presentation_hotfix_preflight.v1',result:'PASS',normal_store_responses_unchanged:true,machine_endpoints:evidence},null,2));
