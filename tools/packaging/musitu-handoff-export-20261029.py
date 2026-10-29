"""Clean whole-product export, no production mutation or private credentials."""
import os,json,io,tarfile,hashlib,subprocess
from datetime import datetime,timezone
from pathlib import Path
REPO="evansmusitu/mft-axiom-build"
MAIN="06cc5f74fb066c11f8d81390f424e58a2f9c261a"
FEATURE="feat/musitu-connect-frontier"
BASE="bc48ab8aed137e61b76e25f113bb29e1efd7b11a"
SEAL="d6a846f6bbe0bccac1758713eb4de167caf07113"
RUNS=[
("PUBLIC_NATIVE_FROZEN_LIGHTGBM",37882474024,"musitu-axiom-native-frozen-lightgbm-research"),
("PUBLIC_SYNTHETIC_REPLAY",37906916355,"musitu-axiom-pinned-native-model-synthetic-smoke"),
("PUBLIC_SYNTHETIC_PROXY_AUDIT",37938799538,"musitu-axiom-research-window-proxy-synthetic-audit"),
("INDEPENDENT_DATA_GAP_AUDIT",37978735182,"musitu-axiom-independent-mine-source-gap-report"),
("LATEST_INDEPENDENT_MINE_CATALOG_GAP_12_SOURCES",40162625422,"musitu-axiom-independent-mine-source-gap-report"),
("FOUR_FOLD_FROZEN_SYNTHETIC_REPLAY",40162694759,"musitu-axiom-exact-fold-synthetic-research-metrics")]
def sh(*args):return subprocess.check_output(args,text=True).strip()
def raw(*args):return subprocess.check_output(args)
def api(endpoint):return json.loads(sh("gh","api","repos/"+REPO+"/"+endpoint))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def dump(p,text):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding="utf-8")
def jsontext(o):return json.dumps(o,sort_keys=True,indent=2,ensure_ascii=False)+"\n"
def snapshot(rev,dest):
 dest.mkdir()
 with tarfile.open(fileobj=io.BytesIO(raw("git","archive","--format=tar",rev))) as tar:
  for ent in tar:
   path=Path(ent.name)
   if path.is_absolute() or ".." in path.parts or ent.issym() or ent.islnk() or ent.isdev():raise RuntimeError("UNSAFE_ARCHIVE_PATH")
  tar.extractall(dest,filter="data")
 files=[f for f in dest.rglob("*") if f.is_file()]
 if not files:raise RuntimeError("EMPTY_SOURCE")
 if any(f.name in (".env","id_rsa","credentials.json") or f.suffix in (".pem",".p12",".key") for f in files):raise RuntimeError("TRACKED_SECRET_FILENAME")
 return len(files)
def main():
 if os.getenv("GITHUB_REPOSITORY")!=REPO or os.getenv("GITHUB_REF_NAME")!="chore/musitu-whole-product-handoff-20261029":raise RuntimeError("UNAUTHORIZED_EXPORT_CONTEXT")
 sh("git","fetch","--no-tags","origin","+refs/heads/main:refs/remotes/origin/main","+refs/heads/"+FEATURE+":refs/remotes/origin/"+FEATURE)
 live=sh("git","rev-parse","refs/remotes/origin/main")
 if live!=MAIN or api("branches/main")["commit"]["sha"]!=MAIN:raise RuntimeError("MAIN_MOVED_SINCE_PIN")
 feature_sha=sh("git","rev-parse","refs/remotes/origin/"+FEATURE)
 for commit in (MAIN,feature_sha,BASE,SEAL):sh("git","cat-file","-e",commit+"^{commit}")
 out=Path(os.environ["RUNNER_TEMP"])/"MUSITU_AXIOM_CONNECT_WHOLE_PRODUCT_HANDOFF_20261029"
 out.mkdir()
 refs={"PRODUCT_CURRENT_MAIN":MAIN,"PRODUCT_ACTIVE_FEATURE_BRANCH":feature_sha,"REFERENCE_20261027_MAIN":BASE,"REFERENCE_PREVIOUSLY_SEALED_MAIN":SEAL}
 counts={name:snapshot(rev,out/name) for name,rev in refs.items()}
 evidence=[]
 for name,run,artifact in RUNS:
  path=out/"EVIDENCE_PUBLIC_RESEARCH_ONLY"/name;path.mkdir(parents=True)
  subprocess.run(["gh","run","download",str(run),"--repo",REPO,"--name",artifact,"--dir",str(path)],check=True)
  n=len([f for f in path.rglob("*") if f.is_file()])
  if not n:raise RuntimeError("MISSING_ARTIFACT_"+name)
  evidence.append({"category":name,"run_id":run,"artifact":artifact,"file_count":n,"research_only":True})
 model=out/"EVIDENCE_PUBLIC_RESEARCH_ONLY/PUBLIC_NATIVE_FROZEN_LIGHTGBM"
 if sha(model/"model.txt")!="3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb":raise RuntimeError("FROZEN_MODEL_CORRUPTED")
 if sha(model/"manifest.json")!="f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf":raise RuntimeError("FROZEN_MANIFEST_CORRUPTED")
 release=json.loads((out/"PRODUCT_CURRENT_MAIN/qualification/musitu_connect_commercial_ga_release.json").read_text())
 if len(release["qualifications"])!=13 or any(v=="QUALIFIED" for v in release["qualifications"].values()) or release["release"]["commercial_ga_enabled"] or release["release"]["new_customer_registration_open"]:raise RuntimeError("LAUNCH_GATE_CHANGED_REVIEW_REQUIRED")
 prs=api("pulls?state=all&per_page=60")
 runs=api("actions/runs?per_page=100")["workflow_runs"]
 hand=out/"HANDOFF";hand.mkdir()
 state={"schema":"musitu.whole_product.handoff.v2026_10_29","utc_created":datetime.now(timezone.utc).isoformat(),"repository":REPO,"main_sha":MAIN,"feature_branch":FEATURE,"feature_sha":feature_sha,"snapshots":refs,"source_file_counts":counts,"research_artifacts":evidence,"release":release["release"],"commercial_controls":release["qualifications"],"commercial_controls_qualified":0,"methane_field_qualified":False,"frozen_model_sha256":"3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb","live_mcp_last_observed":"4.0.2","pinned_mcp_contract":"4.0.0","independent_legal_payment_security_approvals_packed":False}
 dump(hand/"STATE.json",jsontext(state))
 dump(hand/"LATEST_PR_STATE.json",jsontext([{"number":p["number"],"title":p["title"],"state":p["state"],"merged_at":p.get("merged_at"),"head":p["head"]["sha"]} for p in prs[:40]]))
 dump(hand/"LATEST_MAIN_CI.json",jsontext([{"name":r["name"],"run":r["id"],"status":r["status"],"conclusion":r["conclusion"],"url":r["html_url"]} for r in runs if r["head_sha"]==MAIN]))
 dump(hand/"MAIN_RECENT_COMMITS.txt",sh("git","log","-n","120","--format=%H %cs %s",MAIN)+"\n")
 dump(hand/"FEATURE_RECENT_COMMITS.txt",sh("git","log","-n","100","--format=%H %cs %s",feature_sha)+"\n")
 dump(hand/"BRANCH_DIVERGENCE.txt",raw("git","diff","--stat",MAIN+"..."+feature_sha).decode("utf-8","replace"))
 dump(hand/"00_READ_FIRST.md",f"""# MUSITU Connect + MUSITU Axiom: whole-product handoff, 29 October 2026

Live GitHub: https://github.com/{REPO}
Current complete main source SHA: {MAIN}
Historical feature branch: {FEATURE} at {feature_sha}
Former main baseline: {BASE}; sealed historic main: {SEAL}

Run python HANDOFF/VERIFY_PACKAGE.py FIRST and read every HANDOFF file.
Four full tracked-source snapshots and six research-only evidence packages
are included. EVIDENCE_PUBLIC_RESEARCH_ONLY has immutable published native
LightGBM model with verified SHA, synthetic replay, proxy and dataset gaps.
This is NOT independently validated operating-mine methane evidence.

Current full commercial GA target has no pilot/beta requirement. All 13
external controls remain NOT DEMONSTRATED. Commercial admission is off.
The 27 October archive's claims that PR #9 is open and main cannot be
merged have been superseded: PR #9 and later GA hardening work were merged.
Owner authorized safe engineering and merges when verified; this does not
substitute for legal, merchant, security or human incident approval.
Keep separately approved Axiom production arithmetic working.

No Cloudflare secret, merchant account, external approval or customer data
is supplied by this archive. Do not promote frozen methane prediction or
expose commercial registration based on this source archive.
""")
 dump(hand/"PRODUCT_AND_LAUNCH_INDEX.md","""# Whole-product source and commercial launch index

PRODUCT_CURRENT_MAIN/ is the SHA-pinned current code at export.
PRODUCT_ACTIVE_FEATURE_BRANCH/ retains feature-side development context.
REFERENCE_20261027_MAIN/ and REFERENCE_PREVIOUSLY_SEALED_MAIN/ are historical.
EVIDENCE_PUBLIC_RESEARCH_ONLY/ contains research and frozen native model.

Connect enterprise platform: connect/, infra/, qualification/, tests/connect/.
Mining adapter: benchmarks/mining_adapter/ and connect/ mining code.
Axiom quantitative compute: reasoning/, mcp/, ops/, tests/, scripts.
GitHub Actions/deployment: .github/workflows/ (production writes manual only).
Product operating procedures: docs/operations/.
Full commercial gate:
PRODUCT_CURRENT_MAIN/qualification/musitu_connect_commercial_ga_release.json

The 13 missing independent release controls: hosted Cloudflare D1 staging,
tenant isolation, exact-once quota enforcement, production-scoped customer
identity, onboarding/offboarding, Connect-specific payment/invoice/refund
reconciliation, backup/restore, external human-acknowledged alerts, on-call
incident rollback, legal/privacy/DPA approval, independent security review,
customer support/SLA and public MCP/domain review.
A green offline CI audit does not prove external certification.
""")
 dump(hand/"CONTINUATION.md","""# Verified continuation instructions

1. Unzip, run HANDOFF/VERIFY_PACKAGE.py, inspect 00_READ_FIRST.md, STATE.json,
   this file, the product index, PR and CI summaries, exact new chat command.
2. FIRST query live GitHub evansmusitu/mft-axiom-build main, PRs #47-#54,
   CI and commercial GA record; reconcile any commits after archive main.
3. Treat main snapshot as current at EXPORT, not forever. Do not undo
   successful merged PRs #9, #39-#54. Continue test-first with GitHub CI.
4. No pilots or beta required: full GA is target. All 13 independent
   merchant/security/legal/Cloudflare/human operations signoffs missing.
   Do not invent or self-sign them or release customers before qualification.
5. Protect approved live Axiom arithmetic. Last public Axiom MCP health
   observation 4.0.2 vs pinned v4 4.0.0; independently inspect Cloudflare
   deployed provenance rather than simply relaxing expected version.
6. Frozen methane model SHA in STATE is only research qualified; source:
   54 LightGBM features, original 1Hz/28 physical measured channels,
   past 600s, t+180–t+360s forecast, 30s stride, physical warning>=1.0,
   threshold 0.022545819099925965, 4 chronological holdout folds,
   >=500 positive windows in >=3 folds, recall>=0.90 precision>=0.10,
   F2 at least 5% above warning baseline in >=3 folds. No independent
   physical mine holdout data or reuse permission has been confirmed.
7. Mining dataset researcher requests have been sent and reply automation
   exists; verify current Gmail rather than creating duplicate outreach.
8. Stored ZIP does not contain authenticated hosted D1 test observations,
   finance merchant original receipts, a signed DPA, legal/security human
   approvals or real production secrets. Preserve safe non-enabling gates.
9. The previous SHA-verified 27 Oct package is still in Drive file
   1LE6p-AQznz7blCWXXnx8bE_qFZpQdDe7 for archival reference.
""")
 dump(hand/"EXACT_NEW_CHAT_COMMAND.txt","""Continue engineering the complete MUSITU Connect and MUSITU Axiom product from the connected Google Drive file MUSITU_AXIOM_CONNECT_WHOLE_PRODUCT_HANDOFF_20261029.zip. Retrieve the entire ZIP, extract, run python HANDOFF/VERIFY_PACKAGE.py, and read HANDOFF/00_READ_FIRST.md, HANDOFF/STATE.json, HANDOFF/CONTINUATION.md, HANDOFF/PRODUCT_AND_LAUNCH_INDEX.md, HANDOFF/LATEST_PR_STATE.json and HANDOFF/LATEST_MAIN_CI.json. Restore four complete SHA-pinned source snapshots and all six frozen-model/research-only evidence archives. FIRST verify the LIVE GitHub main SHA and current PRs, issues, CI and 13-control commercial GA gate. Reconcile newer commits without overwriting production. Proceed toward FULL commercial GA (no pilot/beta), complete useful verified engineering with red-green tests and safe authorized merges, but never claim live Cloudflare staging, finance reconciliation, security/legal approval, human paging or OpenAI publication without independent evidence. Preserve authorized Axiom arithmetic and research-only frozen methane prediction; never change safety thresholds or certify missing independent mine data. Report exact commits, evidence, remaining blockers and any genuine external access requirements. Do not repeat work already merged.
""")
 dump(hand/"VERIFY_PACKAGE.py",'''from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parents[1]
manifest=root/"HANDOFF/CHECKSUMS.json"
expected=json.loads(manifest.read_text())
actual={}
for p in root.rglob("*"):
 if p.is_symlink():raise SystemExit("HANDOFF_UNSAFE_SYMLINK")
 if p.is_file() and p!=manifest:actual[p.relative_to(root).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
if expected!=actual:raise SystemExit("HANDOFF_HASH_MISMATCH missing="+str(sorted(expected.keys()-actual.keys())[:8])+" extra="+str(sorted(actual.keys()-expected.keys())[:8])+" changed="+str(sorted(k for k in expected.keys()&actual.keys() if expected[k]!=actual[k])[:8]))
print("HANDOFF_SHA256_CHECK=PASS",len(expected))
''')
 checks={f.relative_to(out).as_posix():sha(f) for f in out.rglob("*") if f.is_file() and f!=hand/"CHECKSUMS.json"}
 dump(hand/"CHECKSUMS.json",jsontext(checks))
 print(sh("python",str(hand/"VERIFY_PACKAGE.py")))
 print("HANDOFF_MAIN_SHA="+MAIN)
 print("HANDOFF_COUNTS="+json.dumps(counts,sort_keys=True))
 print("HANDOFF_RESEARCH_ARTIFACTS="+str(len(evidence)))
if __name__=="__main__":main()
