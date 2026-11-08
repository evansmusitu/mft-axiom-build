#!/usr/bin/env python3
"""Build an independently checkable, PUBLIC-ONLY MUSITU AXIOM whole-product handoff.

Runs in a disposable GitHub Actions job, NEVER on a production worker.
Live public GitHub is canonical. The archive contains ALL public Git refs
in a git bundle, plus selected full source trees and a complete PR inventory.
No private GitLab archive, private GitHub archive, provider tokens or D1 data.
"""
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from zoneinfo import ZoneInfo

REPO="evansmusitu/mft-axiom-build"
OUT=Path(os.environ.get("AXIOM_OUTPUT","/tmp/axiom-whole-product"))
UTC=dt.timezone.utc
NOW=dt.datetime.now(UTC)
LOCAL=NOW.astimezone(ZoneInfo("Africa/Harare"))
DATE=LOCAL.strftime("%Y-%m-%d")
GUARD=("PUBLIC SOURCE ONLY. Production remains NO-GO. Never claim an "
       "offline test proves deployed security, audited invoices, or trading returns.")

def run(*args, cwd=None, capture=False):
    p=subprocess.run(list(map(str,args)),cwd=cwd,text=True,check=True,
                     stdout=subprocess.PIPE if capture else None,
                     stderr=subprocess.PIPE if capture else None)
    return p.stdout if capture else None

def api(path):
    token=os.environ.get("GH_TOKEN")
    if not token:raise RuntimeError("GH_TOKEN read-only workflow token is required")
    request=urllib.request.Request(
        "https://api.github.com/"+path,
        headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
                 "X-GitHub-Api-Version":"2022-11-28","User-Agent":"axiom-public-only-handoff"})
    with urllib.request.urlopen(request,timeout=45) as resp:
        return json.load(resp)

def jsonfile(relative,obj):
    file=OUT/relative
    file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(json.dumps(obj,sort_keys=True,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

def textfile(relative,text):
    file=OUT/relative
    file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(text,encoding="utf-8")

def digest(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def safe_archive(commit,name):
    path=OUT/"PRODUCT"/name
    path.mkdir(parents=True,exist_ok=False)
    raw=subprocess.check_output(["git","archive","--format=tar",commit])
    with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
        members=tf.getmembers()
        for member in members:
            dest=(path/member.name).resolve()
            if not dest.is_relative_to(path.resolve()):
                raise RuntimeError("unsafe public git archive member")
            if member.issym() or member.islnk():
                raise RuntimeError("symlink in public git archive requires inspection")
        tf.extractall(path,filter="data")
    return {"label":name,"sha":commit,"files":sum(p.is_file() for p in path.rglob("*"))}

def main():
    if OUT.exists():shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    print("Capturing current public GitHub refs",flush=True)
    run("git","fetch","--prune","--force","origin",
        "+refs/heads/*:refs/remotes/origin/*",
        "+refs/tags/*:refs/tags/*")
    mainsha=run("git","rev-parse","refs/remotes/origin/main",capture=True).strip()
    pulls=[]
    page=1
    while True:
        rows=api("repos/"+REPO+"/pulls?state=open&per_page=100&page="+str(page))
        for row in rows:
            pulls.append({
              "number":row["number"],"title":row["title"],"url":row["html_url"],
              "draft":bool(row["draft"]),"state":row["state"],
              "head_branch":row["head"]["ref"],"head_sha":row["head"]["sha"],
              "base_branch":row["base"]["ref"],"base_sha":row["base"]["sha"],
              "updated_at":row["updated_at"]
            })
        if len(rows)<100:break
        page+=1
        if page>25:raise RuntimeError("unexpected public PR pagination")
    pulls.sort(key=lambda x:x["number"])
    by_num={r["number"]:r for r in pulls}
    selected=[(76,"draft-76-phase210a"),(81,"draft-81-phase210b"),
              (87,"draft-87-evidence"),(99,"draft-99-hyperdrive"),
              (104,"draft-104-protected-spend"),(119,"draft-119-d1-parity"),
              (128,"draft-128-d1-timetravel"),(133,"draft-133-oauth-recovery"),
              (140,"draft-140-oauth-backup"),(149,"draft-149-pr77-synthetic-d1")]
    if pulls:
        latest=max(pulls,key=lambda p:p["number"])
        if latest["number"] not in [n for n,_ in selected]:
            selected.append((latest["number"],"draft-latest-open-pr"))
    selected=[(n,l) for n,l in selected if n in by_num]
    priority=[76,81,87,99,104,149]
    ci={}
    for n in priority:
        if n not in by_num:continue
        sha=by_num[n]["head_sha"]
        try:
            values=api("repos/"+REPO+"/actions/runs?head_sha="+sha+"&per_page=100")["workflow_runs"]
            ci[str(n)]=[{"id":w["id"],"name":w["name"],"event":w["event"],
                         "status":w["status"],"conclusion":w["conclusion"],
                         "url":w["html_url"],"head_sha":w["head_sha"]} for w in values
                         if w["head_sha"]==sha][:30]
        except Exception as e:
            ci[str(n)]={"lookup_error":type(e).__name__,"verified":False}
    issues={}
    for n in (74,75):
        try:
            v=api("repos/"+REPO+"/issues/"+str(n))
            issues[str(n)]={"state":v["state"],"url":v["html_url"],"title":v["title"],
                            "updated_at":v["updated_at"]}
        except Exception as e:
            issues[str(n)]={"lookup_error":type(e).__name__}
    print("Bundling every public remote branch and tag",flush=True)
    bundle=OUT/"SOURCE_HISTORY"/"public-github-all-refs.bundle"
    bundle.parent.mkdir(parents=True)
    run("git","bundle","create",bundle,"--all")
    verify=run("git","bundle","verify",bundle,capture=True)
    refs=run("git","for-each-ref","--format=%(objectname)\t%(refname)",
             "refs/remotes/origin","refs/tags",capture=True)
    textfile("SOURCE_HISTORY/REFS.tsv",refs)
    textfile("SOURCE_HISTORY/VERIFY.txt",verify+"\nBundle SHA256: "+digest(bundle)+"\n")
    snapshots=[safe_archive(mainsha,"main")]
    for n,label in selected:
        sha=by_num[n]["head_sha"]
        try:
            run("git","cat-file","-e",sha+"^{commit}")
        except subprocess.CalledProcessError:
            run("git","fetch","origin",sha)
        snapshots.append(safe_archive(sha,label))
    print("Completed "+str(len(snapshots))+" exact public source snapshots",flush=True)
    # Do not silently deliver stale PR heads when the public repo changes mid-build.
    if api("repos/"+REPO+"/branches/main")["commit"]["sha"]!=mainsha:
        raise RuntimeError("Public main moved while packaging; rerun from live source")
    for n,_ in selected:
        current=api("repos/"+REPO+"/pulls/"+str(n))
        if current["head"]["sha"]!=by_num[n]["head_sha"]:
            raise RuntimeError("PR "+str(n)+" moved while packaging; rerun")
    # Archived source, not live private GitLab metadata, is intentionally public-safe.
    state={
      "schema":"musitu.axiom.whole_product_continuation.v4",
      "captured_utc":NOW.isoformat(),"timezone":"Africa/Harare",
      "captured_harare":LOCAL.isoformat(),
      "classification":"PUBLIC-SOURCE ONLY; owner-only encrypted backups are excluded",
      "canonical":{"public_github":REPO,"main_sha":mainsha,
                   "private_gitlab_project_id":86647955,
                   "private_gitlab_repository":"PRIVATE; consult live authenticated connector",
                   "private_github_archive":"PRIVATE; not bundled",
                   "private_archive_note":"Prior confirmed 180 branches and 1 tag; verify live; issues/MRs/CI metadata not part of a Git mirror"},
      "public_open_pull_requests":len(pulls),
      "priority_prs":{str(k):by_num.get(k) for k in priority},
      "snapshots":snapshots,
      "history_bundle":"SOURCE_HISTORY/public-github-all-refs.bundle",
      "history_bundle_sha256":digest(bundle),
      "history_ref_lines":len(refs.splitlines()),
      "issues":issues,"ci":ci,
      "neon":{"staging_provider":"Neon PostgreSQL 17",
              "last_verified_pre_package":{"block_public_connections":True,"runtime_roles":["neondb_owner"]},
              "must_recheck_live":True,"no_live_sql_or_role_changes_in_packaging":True},
      "deployment":{"hosting":"Cloudflare Workers; D1 workstreams also exist",
                    "release_status":"NO_GO","mandatory_external_gates":"DO NOT mark pass based on CI",
                    "no_production_changes_during_packaging":True},
      "confidentiality":{"private_gitlab_archives_excluded":True,
                         "customer_data_and_d1_backups_excluded":True,
                         "tokens_and_secrets_excluded":True},
      "source_of_truth":"live public GitHub and owner-authenticated private systems; ZIP is only a frozen public offline handoff"
    }
    jsonfile("HANDOFF/CONTINUATION_STATE.json",state)
    jsonfile("HANDOFF/OPEN_PULL_REQUESTS.json",pulls)
    jsonfile("HANDOFF/PR_WORKFLOW_RUNS.json",ci)
    jsonfile("HANDOFF/SNAPSHOT_MANIFEST.json",snapshots)
    textfile("HANDOFF/README_FIRST.md",
       "# MUSITU AXIOM: whole-product continuation, "+DATE+"\n\n"
       "This is a complete bundle of ALL PUBLIC GitHub branch/tag Git object history, "
       "with pinned full source snapshots, all open PR heads/stacking, workflow evidence, "
       "and continuation gates. It does NOT contain private GitLab-only metadata, "
       "production OAuth/D1 customer rows or owner-encrypted backups, nor secrets.\n\n"
       "Read these before any repository or infrastructure write, IN ORDER:\n"
       "1. HANDOFF/README_FIRST.md\n"
       "2. HANDOFF/CONTINUATION_STATE.md\n"
       "3. HANDOFF/CONTINUATION_STATE.json\n"
       "4. HANDOFF/VERIFICATION_MATRIX.md\n"
       "5. HANDOFF/OPEN_PULL_REQUESTS.json and HANDOFF/PR_WORKFLOW_RUNS.json\n"
       "6. HANDOFF/SNAPSHOT_MANIFEST.json and HANDOFF/SOURCE_MANIFEST.md\n"
       "7. HANDOFF/NEW_CHAT_COMMAND.txt\n"
       "8. HANDOFF/SHA256SUMS.txt and HANDOFF/HASH_VERIFICATION_RESULT.txt\n\n"
       "Live GitHub evansmusitu/mft-axiom-build is canonical; the ZIP is frozen, "
       "so always recheck main, priority PR heads, open PRs and exact-head CI. "
       "Do not publish private archival material to the public repository.\n\n"
       "Critical invariants: PUBLIC main remains protected; no merges/squashes/"
       "force-pushes by packaging. No Neon public-network change, owner-role reuse, "
       "production credential, Cloudflare/D1 restore or paid provider operation. "
       "Release issues #74/#75 remain evidence gates; use live state. "
       "No trading-profit guarantees.\n\n"
       "For complete Git history, the SOURCE_HISTORY/public-github-all-refs.bundle "
       "contains every public branch/tag fetched by the packaging job, "
       "not solely the listed snapshots. Restore with git clone --mirror "
       "SOURCE_HISTORY/public-github-all-refs.bundle local-public-mirror. "
       "This package is not the private GitLab history archive.\n")
    important=", ".join("#"+str(n)+" @ "+by_num[n]["head_sha"][:12]
                         for n in priority if n in by_num)
    textfile("HANDOFF/CONTINUATION_STATE.md",
       "# MUSITU AXIOM: current verified public engineering handoff\n\n"
       "Snapshot "+LOCAL.isoformat()+", source PUBLIC GitHub "+REPO+".\n\n"
       "Canonical public main commit: "+mainsha+". "
       "It was checked again after collecting selected heads. "
       "Do not confuse that frozen main with the substantial open DRAFT changes.\n\n"
       "Priority draft PR checkpoints: "+important+". "
       "Read HANDOFF/OPEN_PULL_REQUESTS.json for ALL "+str(len(pulls))+
       " currently OPEN PRs including long stacked Cloudflare D1, OAuth, "
       "disaster-recovery and PR77 synthetic-only workflows. "
       "Do not assume just five PRs exist. "
       "Full Git history for ALL public refs is bundled.\n\n"
       "Past verified Phase 2.10A and 2.10B introduced tenant and organization "
       "spend caps. Draft #104 introduced separate PostgreSQL SECURITY DEFINER "
       "reserve/settle RPCs, a NOLOGIN owner handoff, a protected runtime ledger, "
       "and optional protected-only production registration. Tests are synthetic. "
       "Draft #99 introduced fail-closed offline Hyperdrive preflight and "
       "read-only DB permission and RPC attestation; it does not prove a live "
       "Neon/Cloudflare connection. Both PRs remain review and deployment gates.\n\n"
       "More recent public drafts (up to PR #"+str(max(by_num) if by_num else 0)+
       ") concern hosted D1, real OAuth encrypted backups, Disaster Recovery "
       "and isolated synthetic PR77 migration rehearsal. Their actual public "
       "source/evidence is in the Git bundle and per-PR inventory. "
       "The private customer snapshots and encryption keys are intentionally NOT copied. "
       "Read actual deployment receipts and owner-only artifacts via connected apps; "
       "the public code snapshots do not independently prove custody or completeness.\n\n"
       "Operational release remains NO-GO pending independent accepted evidence: "
       "cross-worker paid-provider spend controls, live vendor invoices, "
       "credentialed approved evidence smokes, penetration retest, key/IAM/DR "
       "acceptance and complete private historical issue/MR/CI archival. "
       "Private GitLab project ID 86647955 remains a separate authorization "
       "boundary and must NOT be mirrored to public GitHub.\n\n"
       "Owner has standing permission for routine test-first engineering, written "
       "specs, CI, draft PRs, safe non-destructive fixes and evidence reviews; "
       "stop for actual external approval or unauthorized irreversible action. "
       "Keep source branches; no squash/force-push main. Never invent CI results, "
       "production attestations or profitable trading guarantees.\n")
    textfile("HANDOFF/VERIFICATION_MATRIX.md",
       "# Public verification matrix\n\n"
       "All source SHAs and publicly observable PR heads are recorded in "
       "HANDOFF/CONTINUATION_STATE.json. Exact-head workflow statuses and URLs "
       "are in HANDOFF/PR_WORKFLOW_RUNS.json. A workflow conclusion is NOT "
       "approval of production controls.\n\n"
       "Release #74: "+str(issues.get("74",{}).get("state","UNKNOWN"))+
       "; archival #75: "+str(issues.get("75",{}).get("state","UNKNOWN"))+
       ". Recheck through GitHub, including any changes after packaging.\n\n"
       "Integrity: SHA256SUMS.txt includes every source and handoff payload "
       "except itself and HASH_VERIFICATION_RESULT.txt. "
       "The Git bundle was verified and all pinned source snapshots "
       "were extracted using git archive at their EXACT commit SHAs.\n\n"
       "Neon network/role: previous live inspection showed blocked public "
       "connections and only default owner. Recheck via authenticated Neon "
       "before making any claim about present state. NO-GO absent actual "
       "owner/security authorization and verified live runtime topology.\n\n"
       "Private GitLab and owner-only encrypted Cloudflare D1/OAuth backup material "
       "is excluded on purpose. Do not equate public Git refs with private retention.\n")
    textfile("HANDOFF/SOURCE_MANIFEST.md",
       "# Full public source and history\n\n"
       "All remote public branch heads and tags: SOURCE_HISTORY/REFS.tsv and "
       "SOURCE_HISTORY/public-github-all-refs.bundle. "
       "Verify with git bundle verify and restore with git clone --mirror.\n\n"
       "The PRODUCT folder contains pinned snapshots of current main and "
       "selected important draft PR heads. See SNAPSHOT_MANIFEST.json for "
       "exact hashes and per-tree file counts. ALL other branch history is "
       "in the Git bundle and the live public GitHub repository.\n\n"
       "HANDOFF/OPEN_PULL_REQUESTS.json is a complete paginated open PR "
       "inventory from the live public API at packaging time; not all 150+ "
       "public branches are separately materialized as PRODUCT directories.\n\n"
       "Confidential/private histories, backup plaintext, paid provider keys "
       "and private account data are not included. They remain accessible "
       "only in previously connected owner-authorized services.\n")
    command=(
      "Continue MUSITU AXIOM from my newest clean whole-product continuation "
      "ZIP named MUSITU_AXIOM_WHOLE_PRODUCT_CONTINUATION_20261108.zip in "
      "my connected Google Drive. Locate and open that exact ZIP first; "
      "read HANDOFF/README_FIRST.md, HANDOFF/CONTINUATION_STATE.md, "
      "HANDOFF/CONTINUATION_STATE.json, HANDOFF/VERIFICATION_MATRIX.md, "
      "HANDOFF/OPEN_PULL_REQUESTS.json, HANDOFF/PR_WORKFLOW_RUNS.json, "
      "HANDOFF/SNAPSHOT_MANIFEST.json, HANDOFF/SOURCE_MANIFEST.md, "
      "HANDOFF/NEW_CHAT_COMMAND.txt, and HANDOFF/SHA256SUMS.txt in that "
      "order before changing anything. Verify all ZIP hashes and the "
      "SOURCE_HISTORY/public-github-all-refs.bundle; use PRODUCT source "
      "snapshots and restore the public bundle as needed. Treat live "
      "GitHub "+REPO+" as canonical; its main checkpoint is "+mainsha+
      " but recheck live before actions. Recheck EVERY open draft PR in "
      "OPEN_PULL_REQUESTS.json, its exact current head/base/CI and recent "
      "changes; there are many stacked OAuth/D1/DR/PR77 drafts beyond #76, "
      "#81, #87, #99 and #104. Use only the public bundle for public source; "
      "keep private GitLab project 86647955, private GitHub archive, "
      "customer backups and credentials in their existing separately "
      "authorized private systems. The owner authorizes safe routine "
      "engineering, test-first implementation, fixes, security review, "
      "documentation, CI and draft PRs without routine stops. Keep all "
      "source branches and ancestry; do not squash, force-push or assume "
      "drafts are approved for merging. No unauthorized Neon network "
      "exceptions, schema/role changes, customer D1/OAuth restores, "
      "production deploys or paid calls. Verify real external approval "
      "before irreversible or risky operations. Release remains NO-GO "
      "until the six independent gates and private archival issue #75 "
      "are proven and accepted. Never claim guaranteed profits or invent "
      "verification. Continue immediately with highest-priority safe "
      "unfinished work across the WHOLE product, reporting exact commits, "
      "tests and genuine external blockers."
    )
    textfile("HANDOFF/NEW_CHAT_COMMAND.txt",command+"\n")
    textfile("HANDOFF/ARCHIVE_BUILD_LOG.txt",
             "UTC "+NOW.isoformat()+"\nAfrica/Harare "+LOCAL.isoformat()+
             "\nGitHub "+REPO+"\nmain "+mainsha+"\n"+
             str(len(pulls))+" open public PRs\n"+
             str(len(snapshots))+" exact source snapshots\n"+
             str(len(refs.splitlines()))+" public Git refs\n"+
             "All material is public source or public PR metadata. "+GUARD+"\n")
    # Publish the verifier itself inside the ZIP (source is public-only).
    textfile("HANDOFF/VERIFY_PACKAGE.py",
       "import hashlib,pathlib,sys\n"
       "root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()\n"
       "manifest=(root/'HANDOFF/SHA256SUMS.txt').read_text().splitlines()\n"
       "for line in manifest:\n"
       "  sha,rel=line.split('  ',1)\n"
       "  p=(root/rel).resolve()\n"
       "  assert p.is_relative_to(root) and p.is_file(),rel\n"
       "  h=hashlib.sha256(p.read_bytes()).hexdigest()\n"
       "  assert h==sha,'SHA mismatch '+rel\n"
       "print('VERIFIED',len(manifest),'files')\n")
    # Entire ZIP payload is covered by this manifest, apart from the manifest
    # itself and its result report (whose self-hash would be circular).
    files=sorted(p for p in OUT.rglob("*") if p.is_file() and
                 p.relative_to(OUT).as_posix() not in (
                    "HANDOFF/SHA256SUMS.txt","HANDOFF/HASH_VERIFICATION_RESULT.txt"))
    lines=[digest(p)+"  "+p.relative_to(OUT).as_posix() for p in files]
    textfile("HANDOFF/SHA256SUMS.txt","\n".join(lines)+"\n")
    run("python3",OUT/"HANDOFF/VERIFY_PACKAGE.py",OUT)
    textfile("HANDOFF/HASH_VERIFICATION_RESULT.txt",
             "VERIFIED "+str(len(lines))+" payload hashes; zero mismatches. "
             "Excluded circular files: SHA256SUMS.txt, HASH_VERIFICATION_RESULT.txt.\n")
    # Dry-run restoration verifies the Git bundle is a usable offline object store.
    with tempfile.TemporaryDirectory(prefix="axiom-restore-") as tmp:
        run("git","clone","--mirror","--quiet",bundle,Path(tmp)/"restored.git")
        run("git","--git-dir="+str(Path(tmp)/"restored.git"),
            "cat-file","-e",mainsha+"^{commit}")
    print(json.dumps({"public_main":mainsha,"open_prs":len(pulls),
        "source_snapshots":len(snapshots),"bundle_sha256":digest(bundle),
        "files_hashed":len(lines),"output":str(OUT)}),flush=True)

if __name__=="__main__":main()
