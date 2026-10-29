from pathlib import Path, PurePosixPath
import hashlib,json,os,subprocess,tarfile,zipfile,shutil,sys,datetime
from urllib.request import Request,urlopen

MAIN='06cc5f74fb066c11f8d81390f424e58a2f9c261a'
FRONTIER='190363831eded4c1901a141c99302b3c8e2b48bd'
OLD_SHA='656b93c90c539649c3d30702e6cc3cd9ed5d0f3ee36990399cb32be0203fa27f'
MODEL_SHA='3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb'
REPO='evansmusitu/mft-axiom-build'
SOURCES={
 'PRODUCT_LIVE_MAIN_20261029':MAIN,
 'PRODUCT_LIVE_CONNECT_FRONTIER_20261029':FRONTIER,
 'UNMERGED_AXIOM_PLUGIN_REVIEW_PR47':'c6bd56c03f8f2d86315abcbe6a8a2e8c148e9e08',
 'UNMERGED_STUDIO_OFFLINE_PR38':'d5b500ab46e3045dc2c53345552b477178bf9ed9',
 'UNMERGED_ENTERPRISE_WORKSPACE_PR34':'2f71629c654ef02722e014adc1b64d1d26092a7a',
 'UNMERGED_ECC_LOCAL_PR33':'37a4cedec2df2d82d501fab4fdd19111f40703e0'}
ROOT=Path('export/payload')
ROOT.mkdir(parents=True,exist_ok=True)
def hash_bytes(b):return hashlib.sha256(b).hexdigest()
def safe(rel):
 p=PurePosixPath(rel)
 if p.is_absolute() or not p.parts or any(x in ('.','..') for x in p.parts):
  raise RuntimeError('Unsafe archive path')
 return p
def put(rel,bytes_):
 path=ROOT.joinpath(*safe(rel).parts)
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_bytes(bytes_)
def write(rel,value):put(rel,(value.rstrip()+'\n').encode('utf-8'))
def github(path):
 headers={'Accept':'application/vnd.github+json','User-Agent':'MUSITU-Handoff-20261029',
          'Authorization':'Bearer '+os.environ['GH_TOKEN']}
 with urlopen(Request('https://api.github.com/repos/'+REPO+'/'+path,headers=headers),timeout=30) as r:
  return json.load(r)
archive=list(Path('original_handoff').rglob('MUSITU_AXIOM_CONNECT_WHOLE_PRODUCT_CLEAN_HANDOFF_20261027.zip'))
if len(archive)!=1 or hash_bytes(archive[0].read_bytes())!=OLD_SHA:
 raise RuntimeError('Missing verified October 27 whole-product source archive')
with zipfile.ZipFile(archive[0]) as z:
 if z.testzip():raise RuntimeError('Archived ZIP corrupt')
 for member in z.infolist():
  safe(member.filename)
  if not member.is_dir():put(member.filename,z.read(member))
old=subprocess.run([sys.executable,str(ROOT/'HANDOFF/VERIFY_PACKAGE.py')],
                   capture_output=True,text=True,check=True)
if 'PASS 998' not in old.stdout:raise RuntimeError('Historic 998 checks did not pass')
(ROOT/'HISTORY_PREVIOUS_HANDOFF_20261027').mkdir()
shutil.move(str(ROOT/'HANDOFF'),str(ROOT/'HISTORY_PREVIOUS_HANDOFF_20261027'/'HANDOFF'))
counts={}
for name,sha in SOURCES.items():
 subprocess.run(['git','fetch','--no-tags','origin',sha],stdout=subprocess.DEVNULL,check=True)
 resolved=subprocess.check_output(['git','rev-parse',sha+'^{commit}'],text=True).strip()
 if resolved!=sha:raise RuntimeError('Git commit mismatch')
 n=0
 p=subprocess.Popen(['git','archive','--format=tar',sha],stdout=subprocess.PIPE)
 with tarfile.open(fileobj=p.stdout,mode='r|') as tar:
  for obj in tar:
   safe(obj.name)
   if obj.isfile():
    put(name+'/'+obj.name,tar.extractfile(obj).read());n+=1
   elif obj.issym():
    put(name+'/'+obj.name,obj.linkname.encode('utf-8'));n+=1
   elif not obj.isdir():raise RuntimeError('Unsupported Git tree entry')
 if p.wait() or n<100:raise RuntimeError('Incomplete Git archive '+name)
 counts[name]=n
live=github('branches/main')['commit']['sha']
frontier=github('branches/feat%2Fmusitu-connect-frontier')['commit']['sha']
if live!=MAIN or frontier!=FRONTIER:
 raise RuntimeError('Source moved during export; refresh exact branch pins')
prs=github('pulls?state=open&per_page=100')
runs=github('actions/runs?per_page=30')['workflow_runs']
issues=[github('issues/'+str(n)) for n in (35,36,37)]
metadata={
 'repository':REPO,'live_main':MAIN,'live_frontier':FRONTIER,
 'open_prs':[{'number':p['number'],'title':p['title'],'head_ref':p['head']['ref'],
             'head_sha':p['head']['sha'],'draft':p['draft'],'url':p['html_url']} for p in prs],
 'ci':[{'id':r['id'],'name':r['name'],'head_sha':r['head_sha'],
        'status':r['status'],'conclusion':r['conclusion'],'url':r['html_url']} for r in runs],
 'issues':[{'number':i['number'],'title':i['title'],'state':i['state'],
            'url':i['html_url']} for i in issues]}
write('HANDOFF/GITHUB_LIVE_SNAPSHOT.json',json.dumps(metadata,indent=2,sort_keys=True))
ga=json.loads((ROOT/'PRODUCT_LIVE_MAIN_20261029/qualification/musitu_connect_commercial_ga_release.json').read_text())
missing=[k for k,v in ga['qualifications'].items() if v!='QUALIFIED']
if len(missing)!=13 or ga['release']['commercial_ga_enabled'] or ga['release']['new_customer_registration_open']:
 raise RuntimeError('GA unexpectedly enabled or control inventory drift')
model=ROOT/'EVIDENCE_PUBLIC_RESEARCH_ONLY/PUBLIC_NATIVE_FROZEN_LIGHTGBM/model.txt'
if hash_bytes(model.read_bytes())!=MODEL_SHA:raise RuntimeError('Frozen methane model mismatch')
audit=subprocess.run([sys.executable,'qualification/validate_commercial_ga.py','--audit'],
 cwd=ROOT/'PRODUCT_LIVE_MAIN_20261029',capture_output=True,text=True)
enforce=subprocess.run([sys.executable,'qualification/validate_commercial_ga.py','--enforce-ready'],
 cwd=ROOT/'PRODUCT_LIVE_MAIN_20261029',capture_output=True,text=True)
if audit.returncode or not enforce.returncode or 'MISSING_13_COMMERCIAL_CONTROLS' not in enforce.stdout:
 raise RuntimeError('Commercial gate must remain 13-controls blocked')
state={
 'schema':'musitu.whole_product.handoff.v2026_10_29',
 'created_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'repository':REPO,'main_head':MAIN,'connect_frontier_head':FRONTIER,
 'source_commit_pins':SOURCES,'source_file_counts':counts,
 'historic_archive_sha256':OLD_SHA,'historic_checks_passed':998,
 'historic_source_snapshots':['PRODUCT_ACTIVE_FEATURE_BRANCH','PRODUCT_CURRENT_MAIN','REFERENCE_PREVIOUSLY_SEALED_MAIN'],
 'ga_release':ga['release'],'ga_unqualified_controls':missing,
 'commercial_mode':'FULL_GA_NO_PILOT_NO_BETA',
 'engineering_and_verified_merges_authorized':True,
 'external_merchant_legal_security_operations_signoffs_earned':False,
 'public_connect_admission':False,'production_methane_safety_qualified':False,
 'frozen_model_sha256':MODEL_SHA,'last_observed_live_mcp_version':'4.0.2',
 'openai_mcp_pinned_version':'4.0.0'}
write('HANDOFF/STATE.json',json.dumps(state,indent=2,sort_keys=True))
write('HANDOFF/00_READ_FIRST.md',"""# MUSITU complete verified whole-product continuation

Extract the complete ZIP. FIRST execute python HANDOFF/VERIFY_PACKAGE.py.
It must report PASS and the full SHA-256 count; reject any missing/changed file.
Then read HANDOFF/STATE.json, HANDOFF/CONTINUATION.md,
HANDOFF/PRODUCT_AND_LAUNCH_INDEX.md, HANDOFF/GITHUB_LIVE_SNAPSHOT.json
and HANDOFF/EXACT_NEW_CHAT_COMMAND.txt.

Full latest tracked source snapshots include exact current main, current
Connect frontier and four relevant unmerged PR branches, plus the exact three
original October 27 snapshots, public frozen methane model and research
evidence. Previous handoff documents have been archived intact.
The ZIP contains no production credentials or independent mine data.
Always compare live GitHub refs, PRs and CI before writing.
""")
write('HANDOFF/CONTINUATION.md',"""# Continue the entire MUSITU Connect + Axiom product

SOURCE: current main pinned in STATE.json under PRODUCT_LIVE_MAIN_20261029,
active Connect frontier under PRODUCT_LIVE_CONNECT_FRONTIER_20261029,
four selected unmerged branch source trees, and historical verified snapshots.
The model includes Connect enterprise integration, Mining Adapter, Axiom
quantitative compute, customer/tenant data, billing, MCP, workflows and tests.

MAIN PROGRESS: PRs 44,45,46,48,49,50,51,52 were merged; recheck live history.
Privileged payment/deployment workflows are now gated for manual reviewed
execution; non-enabling Connect Paynow test-export semantics and provider D1
staging evidence exist. They do not prove financial/provider certification.
Open PRs and exact heads are indexed in GITHUB_LIVE_SNAPSHOT.json.
Previously authorized Connect-to-Axiom arithmetic production integration
must not be inadvertently disabled. No production deploy done by this ZIP.

FULL COMMERCIAL GA, NO PILOTS: 13/13 independent external controls remain
NOT_DEMONSTRATED in qualification/musitu_connect_commercial_ga_release.json.
Customer admission, production credential issuance by this release, public
Connect publication and GA remain disabled. User authorized engineering and
safe verified merges, not synthetic payment/provider evidence, legal/security
signatures or production launch without proved controls. Acceptance matrix
at docs/operations/musitu-connect-commercial-launch-acceptance-20261029.md.
Need actual isolated hosted Cloudflare D1/tenant/quota tests, merchant-authorized
Connect-specific Paynow checkout/settlement/invoices/refunds, authorized
customer lifecycle, backup restore RPO/RTO, delivered and human acknowledged
incident response, staffed support/on-call, legal/privacy/DPA, independent
security and public Connect MCP/domain review. Keep original evidence digests
and distinct external signoffs; do not self-certify.

PUBLIC AXIOM MCP last observed 4.0.2, pinned v4 submission contract 4.0.0,
ready=false. Verify production deployment provenance, never silently relax
security/OAuth/version gate. Review issue 36 and open PR 47.

PREDICTIVE METHANE model sha256 is in STATE.json, research-only.
Keep causal 600s, native 1 Hz x 28 measured original channels, 54 features,
180-360s forecast, stride 30s, hard methane warning >=1.0 and frozen score
threshold 0.022545819099925965. Need genuinely independent mine data/permission,
4 chronological folds, precision >=0.10, recall >=0.90, F2 improvement >=5%
in >=3/4 folds, >=500 real positive windows in >=3 folds. Do not fabricate,
upsample, recalibrate external holdout or claim safety qualification.
Researcher outreach to Durham/AUST and UNSW exists; check for actual replies
in Gmail, do not create duplicate reminders.

NEW CHAT PROCEDURE: verify all checksums, read state/continuation/index,
compare current GitHub main/frontier/PRs/CI to recorded exact SHAs, then
continue test-first engineering with safe normal merges. Keep live production
compute, release safety and immutable original model evidence intact.
""")
write('HANDOFF/PRODUCT_AND_LAUNCH_INDEX.md',"""# Product tree index
PRODUCT_LIVE_MAIN_20261029/ complete current main Git source
PRODUCT_LIVE_CONNECT_FRONTIER_20261029/ complete Connect frontier
UNMERGED_AXIOM_PLUGIN_REVIEW_PR47/ full Axiom plugin review source
UNMERGED_STUDIO_OFFLINE_PR38/ full Studio offline source
UNMERGED_ENTERPRISE_WORKSPACE_PR34/ full workspace feature
UNMERGED_ECC_LOCAL_PR33/ full ECC recovery feature
PRODUCT_ACTIVE_FEATURE_BRANCH/, PRODUCT_CURRENT_MAIN/,
REFERENCE_PREVIOUSLY_SEALED_MAIN/: all original historical source
EVIDENCE_PUBLIC_RESEARCH_ONLY/: frozen public model and research evidence
HISTORY_PREVIOUS_HANDOFF_20261027/HANDOFF/: prior 998-check sealed handoff
HANDOFF/GITHUB_LIVE_SNAPSHOT.json: recent live GitHub PRs, CI and issues

Current source entrypoints:
connect/production_worker.mjs; connect/customer_identity.mjs;
connect/customer_admission.mjs; connect/customer_provisioning.mjs;
infra/connect_customer_registry.sql;
qualification/musitu_connect_commercial_ga_release.json;
qualification/validate_commercial_ga.py;
qualification/reconcile_connect_ga_sandbox.py;
qualification/probe_connect_hosted_d1.py;
docs/operations/musitu-connect-commercial-launch-acceptance-20261029.md;
mcp/musitu_axiom_plugin_gate_v4.mjs;
benchmarks/mining_adapter/, tests/connect/, .github/workflows/.
""")
write('HANDOFF/EXACT_NEW_CHAT_COMMAND.txt',f"""Continue the COMPLETE MUSITU Connect and MUSITU Axiom product from my
verified whole-product 2026-10-29 ZIP on connected Google Drive named
MUSITU_AXIOM_CONNECT_WHOLE_PRODUCT_VERIFIED_20261029.zip. Use the exact
Drive link I provide. Download and extract every file, FIRST run
python HANDOFF/VERIFY_PACKAGE.py and require every SHA-256 to match.
Read HANDOFF/00_READ_FIRST.md, HANDOFF/STATE.json,
HANDOFF/CONTINUATION.md, HANDOFF/PRODUCT_AND_LAUNCH_INDEX.md and
HANDOFF/GITHUB_LIVE_SNAPSHOT.json. Restore entire main (SHA {MAIN}),
Connect frontier (SHA {FRONTIER}), selected unmerged PR snapshots,
all three historical source snapshots, original research/frozen methane
model and all workflows. Compare LIVE GitHub main, frontier, open PRs
and CI with the recorded SHA pins before any changes. Continue full-product
test-first engineering, safe authorized merges and independent commercial
qualification, with no pilot/beta requirement. The 13-control GA gate
remains closed until genuine Cloudflare/Paynow/Finance/Legal/Security/Ops,
domain/MCP and human acceptance proof; never fake approvals or real
merchant data. Do not create paying customers, deploy production without
scoped authorization, weaken MCP version/OAuth validation or promote
unqualified methane safety; preserve existing authorized production Axiom
compute. Don't ask me to repeat prior chats; complete feasible work and
report verified commits/CI and genuinely remaining evidence blockers.
""")
verify="""from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parents[1]
expected=json.loads((root/'HANDOFF/CHECKSUMS.json').read_text())
actual={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob('*') if p.is_file() and p!=root/'HANDOFF/CHECKSUMS.json'}
if actual!=expected:
 print('HANDOFF_SHA256_CHECK=FAIL')
 print('MISSING',sorted(expected.keys()-actual.keys()))
 print('EXTRA',sorted(actual.keys()-expected.keys()))
 print('MODIFIED',sorted(k for k in expected.keys()&actual.keys() if expected[k]!=actual[k]))
 sys.exit(1)
print('HANDOFF_SHA256_CHECK=PASS',len(expected))
"""
write('HANDOFF/VERIFY_PACKAGE.py',verify)
inventory={p.relative_to(ROOT).as_posix():hash_bytes(p.read_bytes())
           for p in ROOT.rglob('*') if p.is_file() and p!=ROOT/'HANDOFF/CHECKSUMS.json'}
write('HANDOFF/CHECKSUMS.json',json.dumps(dict(sorted(inventory.items())),indent=2))
check=subprocess.run([sys.executable,str(ROOT/'HANDOFF/VERIFY_PACKAGE.py')],
                    capture_output=True,text=True,check=True)
if 'PASS '+str(len(inventory)) not in check.stdout:
 raise RuntimeError('Final SHA-256 inventory mismatch')
print('MUSITU_WHOLE_PRODUCT_HANDOFF=PASS',json.dumps({
 'all_sha256_checks':len(inventory),'new_snapshot_file_counts':counts,
 'historic_sha256_checks':998,'main':MAIN,'frontier':FRONTIER,
 'external_ga_controls_remaining':len(missing)}))
