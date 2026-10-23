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

TARGET_NAME = "MUSITU_STUDIO_ENTERPRISE_COMPLETE_HANDOFF_20261021.zip"
BUNDLE = "MUSITU_STUDIO_ENTERPRISE_COMPLETE_HANDOFF_20261021"
BRANCH = "experiments/studio-enterprise-v03-sqlite-do-20261018"
GIT_REPO = "evansmusitu/mft-axiom-build"
SOURCE_PATH = "PRODUCT_SOURCE"
DATE = "2026-10-21"

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def command(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()

def select(path: str) -> bool:
    return (path.startswith("musitu_studio/")
            or path.startswith("ops/studio_")
            or path.startswith("ops/tests/test_studio_")
            or path.startswith("creative/god_mode_2099/")
            or path.startswith(".github/workflows/god-mode-2099-")
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
    return "CONTINUE MUSITU ENTERPRISE 3D STUDIO V0.3 — VERIFIED CROSS-CHAT HANDOFF (21 OCTOBER 2026).\n\nUse the attached ZIP MUSITU_STUDIO_ENTERPRISE_COMPLETE_HANDOFF_20261021.zip, or retrieve the same ZIP from connected private Google Drive. This archive has the entire Studio-specific tracked product source, tests, workflows, operations scripts and dated evidence, NOT live production databases or secret values.\n\nFIRST: verify ZIP CRC and SHA256 by running embedded 07_VERIFY_HANDOFF.py against the ZIP; read 00_START_HERE.md, 02_CURRENT_PRODUCT_STATE.md, 03_CONTINUATION_CHECKLIST.md, 05_SECURITY_AND_EXPORT_LIMITATIONS.md, PRODUCT_SOURCE/docs/STUDIO_NEW_CHAT_ZERO_LOSS_HANDOFF_20261020.md, PRODUCT_SOURCE/docs/STUDIO_NEON_SCALE_GATED_MIGRATION_20261021.md and PRODUCT_SOURCE/docs/STUDIO_NEW_CHAT_TRANSFER_BRIEF_20261021.md. Compare manifest commit with LIVE GitHub and reconcile newer changes, never overwrite them.\n\nCanonical repo evansmusitu/mft-axiom-build, ISOLATED branch experiments/studio-enterprise-v03-sqlite-do-20261018. Live production https://studio-v03.mftintelligence.com/: protected Cloudflare Access, SQLite Durable Object Studio ledger, R2; verified signed owner sole-admin approval with explicit consent and truthful JOB_APPROVED_SINGLE_ADMIN audit. Legacy protected V0.2 https://studio.mftintelligence.com/ and Axiom main must remain unchanged.\n\nI have already AUTHORIZED Neon Scale to become Studio's future production database CONDITIONAL ON complete end-to-end security, zero-loss data migration, verified recovery, private/protected transport and acceptable spend safeguards. Current Neon org is Scale; staging project proud-frog-19561447 is synthetic-only PostgreSQL 17, 0.25 CU, 60-second suspend, tight project quotas, block_public_connections=true. Source includes staged SQL migrations 0001/0002, real Neon synthetic hosted snapshot-restoration proof, Postgres SERIALIZABLE adapter, immutable audit/asset triggers, keyed record-by-record source/target reconciliation and tests. Live Studio has NOT been cut over and no live customer data export/import is verified. A Neon quota is NOT a guaranteed dollar-denominated zero-bill cap.\n\nOPEN GATES: authorized signed owner READ-ONLY Cloudflare SQLite DO export; frozen-source / staged-Neon all-record counts and keyed HMAC comparison including immutable audit and R2 references; least-privilege Cloudflare-to-Neon connection without disabling public DB block; actual signed-browser end-to-end test and guarded reversible cutover; separately enforceable organization spending checks. Modal hard $0-out-of-pocket protection remains UNVERIFIED, so V0.3 CPU/GPU remain SOURCE/PROVIDER OFF. Hosted Cloudflare DO PITR also remains NOT VERIFIED, despite genuine successful Neon synthetic recovery.\n\nWORK AUTONOMOUSLY using connected GitHub, Neon and Google Drive; Cloudflare/Modal via already-present protected GitHub Actions. Verify LIVE repo head, latest CI, provider topology and spend before changing anything; do not reuse stale run counts as current. No repeat screenshots, owner staff ID, payment method, fake identity or repeated authorization requests. Do not weaken Cloudflare Access, alter V0.2, Axiom main, customer data or R2. Make only isolated reversible fail-closed changes with actual tests. Preserve secrets. Never claim a cutover or hosted production restore without proof. If blocked, document the exact gate and complete all safe source/test work. Refresh SHA-verified ZIP and private Drive handoff after a substantial milestone. BEGIN with independent archive/repo/provider verification and execute the next safe Neon migration step in this turn."


def verification_script() -> str:
    return r'''#!/usr/bin/env python3
"""Verify entire handoff ZIP against internal SHA-256 manifest: python 07_VERIFY_HANDOFF.py FILE.zip"""
import hashlib, json, pathlib, sys, zipfile
def main():
    if len(sys.argv)!=2:raise SystemExit("Usage: python 07_VERIFY_HANDOFF.py /path/to/MUSITU_STUDIO_ENTERPRISE_COMPLETE_HANDOFF_20261021.zip")
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
      "docs/STUDIO_NEW_CHAT_TRANSFER_BRIEF_20261021.md",
      "docs/STUDIO_PRODUCTION_ANDROID_CPU_R2_CORRELATED_EVIDENCE_20261018.md",
      ".github/workflows/studio-v03-do-manual-guarded-release.yml",
      ".github/workflows/studio-v03-render-terminal-integrity-release-20261019.yml",
      "ops/studio_build_new_chat_handoff_20261020.py"
    ]
    for path in required: assert path in paths,"MISSING_PRODUCT_COMPONENT:"+path
    assert len(paths)>=190,"INCOMPLETE_STUDIO_SOURCE_TREE"
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

**START WITH:** 01_COPY_TO_NEW_CHAT.txt then 02_CURRENT_PRODUCT_STATE.md, 03_CONTINUATION_CHECKLIST.md, PRODUCT_SOURCE/docs/STUDIO_NEW_CHAT_TRANSFER_BRIEF_20261021.md and PRODUCT_SOURCE/docs/STUDIO_NEW_CHAT_ZERO_LOSS_HANDOFF_20261020.md.

This is a source/evidence/operations transfer of the **entire Studio-specific tracked product**, not a dump of private Cloudflare/Modal provider data. All original repository-relative source paths are preserved under PRODUCT_SOURCE/. All Studio workflows, legacy V0.2, active V0.3, Blender/Modal Python renderer, SQL, tests, operator scripts and dated Studio proof documents are included.

Manifest: MANIFEST_SHA256.json and SHA256SUMS.txt. Verify with:
python 07_VERIFY_HANDOFF.py MUSITU_STUDIO_ENTERPRISE_COMPLETE_HANDOFF_20261021.zip

Safety: The packaged Wrangler config has invalid Access placeholders by design. Do NOT deploy it directly. Use only guarded workflows with provider-readback. Do NOT merge Axiom main, create fake staff identities, assume Scale/Modal cannot incur charges, enable GPU, modify live R2/DO database or override Cloudflare security. The authorized Neon migration is CONDITIONAL and NOT deployed.
"""
    state=f"""# Studio V0.3 — authoritative source snapshot state (2026-10-21)
- GitHub branch: {BRANCH}, captured commit: {head}.
- Live V0.3 URL: https://studio-v03.mftintelligence.com/ ; signed Cloudflare Access owner, authorized sole-admin self-approval, immutable audit, SQLite Durable Object primary ledger, R2.
- Protected legacy V0.2: https://studio.mftintelligence.com/ ; Axiom main, original R2 and Access policy MUST remain unchanged.
- Neon Scale: sample-only isolated PG17 project proud-frog-19561447 (us-east-2); .25 CU, 60-second auto-suspend, tight per-project quotas, block_public_connections=true at latest authenticated readback.
- Neon staged source: migrations 0001 and 0002, real synthetic Neon hosted snapshot/restore with database triggers and audit, PG transaction adapter, fail-closed HMAC full-record reconciliation. Actual Cloudflare customer data NOT exported, no Neon production cutover, no real browser-to-Neon qualification.
- Transfer-start verified CI on SHA 8e8a39d5d2067d0793ae051ecce698f2a647a15a: Studio Edge 95/95; Neon 54/54 (runs 39667545038 and 39667545018). THESE ARE HISTORICAL: verify CI on the new source SHA.
- Cloudflare read-only at transfer start 2026-10-21 20:09 UTC: eight Access redirects; CPU OFF, GPU OFF, safe isolated V0.2/V0.3 domains, no account writes.
- Unresolved: source DO export and all-row reconciliation, private/protected Cloudflare-to-Neon connectivity, auth end-to-end, reversible cutover, Neon account dollar spending guarantee and distinct Modal enforceable $0 overage.
- Genuine hosted Cloudflare SQLite DO PITR is NOT proven. Neon synthetic hosted snapshot restore is proved but does NOT constitute live production data backup.
- This ZIP never includes live customer DB rows, R2 asset bytes, staff tokens, passwords, API secrets or billed-provider state.
- All live facts may change after this snapshot. Revalidate live providers and code before work.
"""
    checklist="""# Safe next-chat continuation checklist
[ ] Verify ZIP SHA256 CRC / exact embedded manifest; check GitHub SHA and latest CI on that SHA.
[ ] Read 01_COPY_TO_NEW_CHAT.txt and dated STUDIO handoff, Neon migration plan, terminal-integrity tests and security limits.
[ ] Read-only verify Cloudflare signed Access 8 routes, sole owner mapping, V0.2/V0.3 isolation, R2 and CPU/GPU OFF.
[ ] Read-only verify Neon Scale project, network public blocking, quota and genuine synthetic snapshot evidence; no assumptions of $0 billing.
[ ] Carry forward staging-only 0001/0002 Postgres migrations, SQL triggers, adapter, HMAC reconciliation; do not substitute SQL connection string for full migration.
[ ] Find authenticated and scoped READ-ONLY existing DO export path without exposing customer data; preserve forensic immutable audit and all R2 references.
[ ] Prove Cloudflare-to-Neon connection through truly protected least-privilege infrastructure, not broad database public access.
[ ] Reconcile frozen source / target all rows, approval lineage, R2 metadata, and signed source checkpoint. Fail closed on any missing/altered record.
[ ] Perform REAL signed staff Access browser E2E on staged backend, hosted Neon recovery of imported data, rollback and safe cutover only after independently verified guards.
[ ] Do not enable Modal CPU/GPU or claim provider-guaranteed $0 spend; Neon paid Scale quotas are not an account billing cap.
[ ] Do not merge Axiom main, change protected Studio V0.2, secrets, live R2 or unauthenticated production users.
[ ] Execute tests + provider readbacks at exact commit, update evidence and private Drive handoff with checked SHA.
"""
    structure="## Product files in this ZIP, preserving original paths\n\n"+"\n".join("- "+p for p in paths)+"\n"
    limitations="""# NOT inside this export — because it is a source handoff, not a provider backup
- Real signed Access staff tokens, login codes, cookies, callback URLs, operator identities.
- GitHub Actions and Cloudflare/Modal API secret VALUES. Use verified provider secrets in connected GitHub Actions, never put raw secrets in chats or this archive.
- Live SQLite Durable Object contents, Cloudflare R2 object bytes or production data snapshots; these remain on Cloudflare, should be backed up by permitted provider actions, not presumed to be in ZIP.
- Actual Modal account billing credits or payment instruments.
- Physical Android device attestation; prior mobile analytics do not prove it.
- Full unrelated Axiom source. Explicitly excluded to keep isolation.
The Studio app is live; Neon staging does not change the live SQLite Durable Object. Status may change after the exported Git SHA. Revalidate provider-backed claims on every new chat.
"""
    proof={
      "scope":"Entire tracked MUSITU Studio V0.2/V0.3 and staged Neon source, NOT Axiom",
      "captured_source_sha":head,
      "source_branch":BRANCH,
      "historical_test_runs_to_revalidate":[
        {"suite":"Studio Edge","passed":95,"failed":0,"run":39667545038,"sha":"8e8a39d5d2067d0793ae051ecce698f2a647a15a"},
        {"suite":"Neon migration","passed":54,"failed":0,"run":39667545018,"sha":"8e8a39d5d2067d0793ae051ecce698f2a647a15a"}],
      "signed_owner_single_admin_verified":True,
      "v02_legacy_preserved":True,
      "neon_scale_plan_connected":True,
      "neon_synthetic_restore_verified":True,
      "neon_real_customer_migration_completed":False,
      "live_studio_primary_is_sqlite_do":True,
      "v03_cpu_dispatch_enabled":False,
      "v03_gpu_enabled":False,
      "hosted_cloudflare_sqlite_pitr_restore_proven":False,
      "modal_zero_overspend_guard_proven":False,
      "neon_account_zero_dollar_billing_proven":False,
      "provider_receipts_historical":True}
    files["00_START_HERE.md"]=readme.encode()
    files["01_COPY_TO_NEW_CHAT.txt"]=continuation_instruction().encode()
    files["02_CURRENT_PRODUCT_STATE.md"]=state.encode()
    files["03_CONTINUATION_CHECKLIST.md"]=checklist.encode()
    files["04_SOURCE_INVENTORY.md"]=structure.encode()
    files["05_SECURITY_AND_EXPORT_LIMITATIONS.md"]=limitations.encode()
    files["06_HISTORICAL_PROVIDER_EVIDENCE.json"]=(json.dumps(proof,indent=2,sort_keys=True)+"\n").encode()
    files["07_VERIFY_HANDOFF.py"]=verification_script().encode()
    report={
        "package_version":"2026-10-21",
        "source_git_commit":head,
        "source_git_branch":BRANCH,
        "source_blob_count":len(paths),
        "source_only":True,
        "cloud_resources_modified_by_builder":False,
        "package_contains_real_credentials":False,
        "package_contains_live_db_snapshot":False,
        "package_contains_customer_render_asset_bytes":False,
        "selected_rules":["musitu_studio/**","ops/studio_*","ops/tests/test_studio_*","creative/god_mode_2099/**","docs/STUDIO_*",".github/workflows/studio-*",".github/workflows/god-mode-2099-*"],
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
