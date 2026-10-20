#!/usr/bin/env python3
"""Reproducible, source-only, complete MUSITU Studio new-chat transfer builder.
Run on a checkout of the isolated Studio branch. No network/cloud mutations.
"""
from __future__ import annotations
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile

TARGET_NAME = "MUSITU_STUDIO_COMPLETE_NEW_CHAT_HANDOFF_20261020.zip"
BUNDLE = "MUSITU_STUDIO_COMPLETE_NEW_CHAT_HANDOFF_20261020"
BRANCH = "experiments/studio-enterprise-v03-sqlite-do-20261018"
GIT_REPO = "evansmusitu/mft-axiom-build"
SOURCE_PATH = "PRODUCT_SOURCE"
DATE = "2026-10-20"

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def command(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()

def select(path: str) -> bool:
    return (path.startswith("musitu_studio/")
            or path.startswith("ops/studio_")
            or path.startswith("docs/STUDIO_")
            or path.startswith(".github/workflows/studio-"))

def file_list() -> list[str]:
    names = subprocess.check_output(["git","ls-files","-z"]).split(b"\0")
    paths = [x.decode("utf-8") for x in names if x]
    return sorted(x for x in paths if select(x) and Path(x).is_file())

def safe_content(relative: str, data: bytes):
    # Refuse plausible actual secrets. No user credentials should be in Git history
    # or any source-only transfer, even if accidentally committed.
    patterns = [
        rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        rb"gh[pousr]_[A-Za-z0-9]{30,}",
        rb"github_pat_[A-Za-z0-9_]{30,}",
        rb"sk-proj-[A-Za-z0-9_-]{28,}",
        rb"(?i)modal_token_secret[ ]*=[ ]*['\x22][A-Za-z0-9_-]{32,}",
        rb"(?i)cloudflare_api_token[ ]*=[ ]*['\x22][A-Za-z0-9_-]{32,}",
    ]
    for pat in patterns:
        if re.search(pat, data):
            raise ValueError("POTENTIAL_SECRET_MUST_BE_REMOVED_FROM_SOURCE: " + relative)
    if len(data) > 2_000_000:
        raise ValueError("UNEXPECTEDLY_LARGE_SOURCE_FILE: " + relative)

def continuation_instruction() -> str:
    return """CONTINUE MUSITU ENTERPRISE 3D STUDIO V0.3 USING THE COMPLETE VERIFIED CROSS-CHAT HANDOFF.

Locate the attached or connected-Google-Drive ZIP named MUSITU_STUDIO_COMPLETE_NEW_CHAT_HANDOFF_20261020.zip. Extract it, read 00_START_HERE.md, 02_CURRENT_PRODUCT_STATE.md, 03_CONTINUATION_CHECKLIST.md and PRODUCT_SOURCE/docs/STUDIO_NEW_CHAT_ZERO_LOSS_HANDOFF_20261020.md; verify 07_VERIFY_HANDOFF.py against the ZIP and MANIFEST_SHA256.json before acting.

Access connected GitHub repository evansmusitu/mft-axiom-build and isolated branch experiments/studio-enterprise-v03-sqlite-do-20261018. Compare the actual current commit and source to the ZIP manifest. This project is MUSITU Studio ONLY. Keep original studio.mftintelligence.com (V0.2), the entire Axiom main branch and unrelated Cloudflare/D1/R2/Modal services untouched.

Real current V0.3 is https://studio-v03.mftintelligence.com/ with Cloudflare Access, a SQLite Durable Object, Android staff UI, R2, and CPU dispatch/GPU DISABLED. Verify LIVE provider state, staff signed-JWT audience, domain and bindings read-only before any changes. Historical CI 54/54 pass, guardrailed V0.3-only deploy and independent 8-route Access verification are documented inside the ZIP. Do not mistake cached ZIP state for live verification.

Carry the enterprise work forward without asking me to retell our prior chat: continue safe tests/security/reliability work, plan and implement only authorized scoped changes, run real verification and publish fresh evidence. Outstanding genuine acceptance: an actual second independent human reviewer (do not impersonate), provider-enforced no-out-of-pocket Modal rendering before enabling any compute, hosted disposable Cloudflare PITR blocked by pre-Worker HTTP 403 (never restore live ledger), GPU entitlement and billing. Preserve free-tools-only, Android-remote-client and separation-of-duties constraints. DO NOT promise asynchronous work. DO NOT declare blocked items complete. Document every new change, protect secrets and update GitHub + private Drive handoff with SHA-verified outputs. Begin with verification of the handoff, repository and live environment, then execute the next safe work in this turn.
"""

def verification_script() -> str:
    return r'''#!/usr/bin/env python3
"""Verify entire handoff ZIP against internal SHA-256 manifest: python 07_VERIFY_HANDOFF.py FILE.zip"""
import hashlib, json, pathlib, sys, zipfile
def main():
    if len(sys.argv)!=2:raise SystemExit("Usage: python 07_VERIFY_HANDOFF.py /path/to/MUSITU_STUDIO_COMPLETE_NEW_CHAT_HANDOFF_20261020.zip")
    p=pathlib.Path(sys.argv[1]);assert p.is_file(),"ZIP_MISSING"
    with zipfile.ZipFile(p) as z:
        assert z.testzip() is None,"ZIP_CRC_ERROR"
        paths=z.namelist()
        roots=set(x.split("/",1)[0] for x in paths)
        assert len(roots)==1,roots
        root=next(iter(roots))
        m=json.loads(z.read(root+"/MANIFEST_SHA256.json"))
        entries=m["files"]
        included=set()
        for item in entries:
            inner=root+"/"+item["path"]
            assert inner in paths,"MISSING "+item["path"]
            data=z.read(inner)
            assert len(data)==item["bytes"],"SIZE "+item["path"]
            assert hashlib.sha256(data).hexdigest()==item["sha256"],"SHA "+item["path"]
            included.add(inner)
        expected=included|{root+"/MANIFEST_SHA256.json",root+"/SHA256SUMS.txt"}
        assert set(paths)==expected,{"unexpected":sorted(set(paths)-expected),"missing":sorted(expected-set(paths))}
        sums=z.read(root+"/SHA256SUMS.txt").decode()
        required="".join(x["sha256"]+"  "+x["path"]+"\n" for x in entries)
        assert sums==required,"SHA256SUMS_CONTENT_MISMATCH"
    print("MUSITU_STUDIO_HANDOFF_VERIFIED",len(entries),"files ZIP_SHA256",hashlib.sha256(p.read_bytes()).hexdigest())
if __name__=="__main__":main()
'''

def main():
    root=Path.cwd()
    assert (root/"musitu_studio/edge/src/v03_do_entry.mjs").is_file(), "RUN_FROM_REPO_ROOT"
    head=command("git","rev-parse","HEAD")
    actual_branch=command("git","branch","--show-current")
    # Github detached HEAD checkouts are allowed if GITHUB_REF_NAME is exact.
    env_branch=os.environ.get("GITHUB_REF_NAME")
    assert actual_branch==BRANCH or (actual_branch=="HEAD" and env_branch==BRANCH), (
        "REFUSE_TO_PACKAGE_WRONG_BRANCH",actual_branch,env_branch)
    paths=file_list()
    required=[
      "musitu_studio/edge/src/v03_do_entry.mjs",
      "musitu_studio/edge/src/v03_entry.mjs",
      "musitu_studio/edge/src/v03_identity.mjs",
      "musitu_studio/edge/src/v03_do_schema.mjs",
      "musitu_studio/edge/wrangler.v03.do.jsonc",
      "musitu_studio/edge/src/r2_entry.mjs",
      "musitu_studio/edge/public_v03/studio.js",
      "musitu_studio/modal/studio_modal.py",
      "musitu_studio/studio/execute_job.py",
      "musitu_studio/edge/tests/v03_enterprise.test.mjs",
      "musitu_studio/edge/migrations/v03/0001_enterprise.sql",
      "docs/STUDIO_NEW_CHAT_ZERO_LOSS_HANDOFF_20261020.md",
      "docs/STUDIO_PRODUCTION_ANDROID_CPU_R2_CORRELATED_EVIDENCE_20261018.md",
      ".github/workflows/studio-v03-do-manual-guarded-release.yml",
      ".github/workflows/studio-v03-render-terminal-integrity-release-20261019.yml",
      "ops/studio_build_new_chat_handoff_20261020.py"
    ]
    for path in required: assert path in paths,"MISSING_PRODUCT_COMPONENT:"+path
    assert len(paths)>=145,"INCOMPLETE_STUDIO_SOURCE_TREE"
    files: dict[str,bytes]={}
    for p in paths:
        if Path(p).is_symlink():raise ValueError("SYMLINK_NOT_ALLOWED: "+p)
        raw=Path(p).read_bytes()
        safe_content(p,raw)
        files[SOURCE_PATH+"/"+p]=raw
    lock=root/"musitu_studio/edge/package-lock.json"
    if lock.is_file():
        files["DEPENDENCIES/edge-package-lock.json"]=lock.read_bytes()
    readme=f"""# MUSITU Enterprise 3D Studio — Complete Cross-Chat Source Handoff
Date: {DATE}
Repository: https://github.com/{GIT_REPO}
Exact source commit: {head}
Source branch: {BRANCH}

**START WITH:** 01_COPY_TO_NEW_CHAT.txt then 02_CURRENT_PRODUCT_STATE.md, 03_CONTINUATION_CHECKLIST.md and PRODUCT_SOURCE/docs/STUDIO_NEW_CHAT_ZERO_LOSS_HANDOFF_20261020.md.

This is a source/evidence/operations transfer of the **entire Studio-specific tracked product**, not a dump of private Cloudflare/Modal provider data. All original repository-relative source paths are preserved under PRODUCT_SOURCE/. All Studio workflows, legacy V0.2, active V0.3, Blender/Modal Python renderer, SQL, tests, operator scripts and dated Studio proof documents are included.

Manifest: MANIFEST_SHA256.json and SHA256SUMS.txt. Verify with:
python 07_VERIFY_HANDOFF.py MUSITU_STUDIO_COMPLETE_NEW_CHAT_HANDOFF_20261020.zip

Safety: The packaged Wrangler config has invalid Access placeholders by design. Do NOT deploy it directly. Use only guarded workflows with provider-readback. Do NOT merge into Axiom main, create fake staff identities, exceed free-use budgets, enable GPU, modify live R2/DO database or override Cloudflare security.
"""
    state="""# Studio V0.3 — exact product state at transfer
- **Live current Studio:** https://studio-v03.mftintelligence.com/
- **Protected legacy V0.2:** https://studio.mftintelligence.com/ (CPU Blender -> Modal -> R2 genuinely completed on v02)
- **V0.3 Worker:** musitu-studio-v03-do ; SQLite Durable Object STUDIO_LEDGER / StudioEnterpriseSqliteLedger
- **V0.3 Access:** dedicated self-hosted application, two email-only allowed policies, signed JWT audience; actual staff session proof is limited to one approved login in prior sampling.
- **Cloud R2 bucket:** musitu-studio-v02-assets; active V0.3 prefix studio-v03/jobs/ ; existing V0.2 single-admin state stays isolated.
- **CPU dispatch budget and GPU:** ALL OFF in V0.3 at last verified independent readback. No V0.3 Modal CPU paid execution proved.
- **Latest production fix:** terminal-job audits conditional on successful update; completed replay requires three distinct matching artifacts. CI **54/54 PASS** (https://github.com/evansmusitu/mft-axiom-build/actions/runs/39196695142); guarded release SUCCESS (https://github.com/evansmusitu/mft-axiom-build/actions/runs/39196779161). Independent Cloudflare Access eight-route readback PASS (https://github.com/evansmusitu/mft-axiom-build/actions/runs/39147347026).
- **Hosted PITR:** Disposable provider test blocked by Cloudflare pre-Worker 403; temporary Worker deleted and verified HTTP 404; local Workerd backup/restore PASSED but cannot be called hosted PITR.
- **Outstanding:** distinct authenticated second reviewer; enforceable $0-overspend Modal entitlement; actual V0.3 CPU render under legitimate approved conditions; hosted throwaway PITR; GPU entitlement.
- **Cloud accounts/connectors:** GitHub and Google Drive have been used; Cloudflare/Modal via protected GitHub Actions secrets. Secrets, staff PII, live DO data, live R2 binary objects and payment settings deliberately NOT copied.
- **User requirements:** enterprise-grade Blender/3D for multiple project types; Android remote client only; free tools, no unapproved billable spend; cannot weaken unrelated Axiom services.
- **Exact Git source commit:** """+head+"\n"
    checklist="""# New-chat operations checklist
[ ] Verify ZIP CRC, all SHA256 manifest entries, exact GitHub commit and source branch.
[ ] Read PRODUCT_SOURCE/docs/STUDIO_NEW_CHAT_ZERO_LOSS_HANDOFF_20261020.md and its embedded test/provider run IDs.
[ ] Enumerate actually connected GitHub/Drive/Cloudflare/Modal capabilities; reconnect only if required.
[ ] Read-only check Cloudflare V0.3 and V0.2 domains, Access signed JWT audience, R2 and Durable Object settings; recheck eight anonymous routes.
[ ] Compare new CI runs and GitHub SHA to exported SHA before source changes; keep Axiom main untouched.
[ ] Recheck Modal *enforceable* zero-overage account plan and CPU/GPU quotas; don't assume current billed cost is a hard cap.
[ ] Pursue real second-person approval only with a distinct authorized human (no test identity on prod).
[ ] Diagnose Cloudflare pre-Worker 403 before any hosted disposable PITR retry; never restore live DO or relax Access.
[ ] For code changes: red test -> green implementation -> 54+ tests -> real workerd -> guarded only-V0.3 deploy -> independent provider readback.
[ ] Update dated handoff and SHA verified private Drive archive after substantive progress.
"""
    structure="## Product files in this ZIP, preserving original paths\n\n"+"\n".join("- "+p for p in paths)+"\n"
    limitations="""# NOT inside this export — because it is a source handoff, not a provider backup
- Real signed Access staff tokens, login codes, cookies, callback URLs, operator identities.
- GitHub Actions and Cloudflare/Modal API secret VALUES. Use verified provider secrets in connected GitHub Actions, never put raw secrets in chats or this archive.
- Live SQLite Durable Object contents, Cloudflare R2 object bytes or production data snapshots; these remain on Cloudflare, should be backed up by permitted provider actions, not presumed to be in ZIP.
- Actual Modal account billing credits or payment instruments.
- Physical Android device attestation; prior mobile analytics do not prove it.
- Full unrelated Axiom source. Explicitly excluded to keep isolation.
The Studio app is live; status may change after the exported Git SHA. Revalidate provider-backed claims on every new chat.
"""
    proof={
      "scope":"MUSITU Studio, not Axiom",
      "captured_source_sha":head,
      "source_branch":BRANCH,
      "test_command":"cd musitu_studio/edge && npm test",
      "latest_v03_unit_tests":{"pass":54,"fail":0,"run":39196695142},
      "latest_v03_deploy":{"success":True,"run":39196779161},
      "latest_cloudflare_8_route_readback":{"success":True,"run":39147347026},
      "v02_modal_cpu_r2_proven":True,
      "v03_cpu_dispatch_enabled":False,
      "v03_gpu_enabled":False,
      "real_two_human_acceptance_proven":False,
      "hosted_pitr_restore_proven":False,
      "modal_zero_overspend_guard_proven":False,
      "these_are_historical_receipts_not_fresh_live_attestations":True
    }
    files["00_START_HERE.md"]=readme.encode()
    files["01_COPY_TO_NEW_CHAT.txt"]=continuation_instruction().encode()
    files["02_CURRENT_PRODUCT_STATE.md"]=state.encode()
    files["03_CONTINUATION_CHECKLIST.md"]=checklist.encode()
    files["04_SOURCE_INVENTORY.md"]=structure.encode()
    files["05_SECURITY_AND_EXPORT_LIMITATIONS.md"]=limitations.encode()
    files["06_HISTORICAL_PROVIDER_EVIDENCE.json"]=(json.dumps(proof,indent=2,sort_keys=True)+"\n").encode()
    files["07_VERIFY_HANDOFF.py"]=verification_script().encode()
    report={
        "package_version":"2026-10-20",
        "source_git_commit":head,
        "source_git_branch":BRANCH,
        "source_blob_count":len(paths),
        "source_only":True,
        "cloud_resources_modified_by_builder":False,
        "package_contains_real_credentials":False,
        "package_contains_live_db_snapshot":False,
        "package_contains_customer_render_asset_bytes":False,
        "selected_rules":["musitu_studio/**","ops/studio_*","docs/STUDIO_*",".github/workflows/studio-*"],
        "critical_paths_present":True,
        "external_provider_receipts_must_be_revalidated":True,
        "created_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    snapshot=root/"PROVIDER_READONLY_HANDOFF_SNAPSHOT_20261020.json"
    if snapshot.is_file():
        data=snapshot.read_bytes()
        provider=json.loads(data)
        assert provider.get("schema")=="musitu.studio.2026-10-20.provider-readonly-topology.v1"
        assert provider.get("cloudflare_account_mutated") is False
        assert provider.get("credentials_exposed") is False
        assert provider.get("staff_emails_or_subjects_exposed") is False
        files["09_FRESH_PROVIDER_READONLY_TOPOLOGY.json"]=data
        report["fresh_provider_read_only_snapshot_included"]=True
        report["fresh_provider_checks_all_passed"]=provider.get("release_safety_confirmed_read_only",False)
    else:
        report["fresh_provider_read_only_snapshot_included"]=False
    files["08_PACKAGE_REPORT.json"]=(json.dumps(report,indent=2,sort_keys=True)+"\n").encode()
    manifest=[{"path":p,"bytes":len(d),"sha256":sha(d)} for p,d in sorted(files.items())]
    m={
      "schema":"musitu.studio.complete.newchat.handoff.v1",
      "repo":GIT_REPO,
      "branch":BRANCH,
      "git_sha":head,
      "source_blob_count":len(paths),
      "archive_members_without_manifest":len(manifest),
      "hash":"SHA-256",
      "files":manifest
    }
    sums="".join(x["sha256"]+"  "+x["path"]+"\n" for x in manifest)
    files["MANIFEST_SHA256.json"]=(json.dumps(m,sort_keys=True,indent=2)+"\n").encode()
    files["SHA256SUMS.txt"]=sums.encode()
    target=root/TARGET_NAME
    with zipfile.ZipFile(target,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
      for p,d in sorted(files.items()):
        info=zipfile.ZipInfo(BUNDLE+"/"+p,date_time=(2026,10,20,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=(0o100644 & 0xFFFF)<<16
        z.writestr(info,d,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    # Independent full byte-for-byte verification against the *zipped* data
    with zipfile.ZipFile(target) as z:
      assert z.testzip() is None,"ZIP_CRC_INVALID"
      assert len(z.namelist())==len(manifest)+2
      assert all(z.read(BUNDLE+"/"+item["path"]) and
            sha(z.read(BUNDLE+"/"+item["path"]))==item["sha256"] for item in manifest)
      assert z.read(BUNDLE+"/SHA256SUMS.txt").decode()==sums
      assert len([n for n in z.namelist() if n.endswith(".zip")])==0,"NO_NESTED_DUPLICATE_PACKAGES"
    result={
      "status":"VERIFIED",
      "filename":TARGET_NAME,
      "zip_size":target.stat().st_size,
      "zip_sha256":sha(target.read_bytes()),
      "git_sha":head,
      "included_source_files":len(paths),
      "sha256_checked_internal_files":len(manifest),
      "safety_scanner":"PASS",
      "zip_test":"PASS",
      "contains_live_cloud_data":False
    }
    (root/"STUDIO_NEW_CHAT_HANDOFF_BUILD_RECEIPT_20261020.json").write_text(json.dumps(result,indent=2)+"\n")
    print("MUSITU_NEW_CHAT_FULL_HANDOFF="+json.dumps(result,sort_keys=True))
    return 0

if __name__=="__main__":
    sys.exit(main())
