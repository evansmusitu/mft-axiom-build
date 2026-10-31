"""Build reproducible, verified LIFELINE source handoff (GitHub Actions).

No credential hydration, API downloads, non-LIFELINE projects, or executable launch.
Preserve GitHub repository paths under source/, attest every packaged file SHA256.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from datetime import datetime,timezone

ROOT=Path.cwd()
OUT=ROOT/"out"/"lifeline-handoff"
PROD="products/lifeline-mt5-ai-studio/"
HANDOFF=PROD+"handoff/"
EXPECTED_BRANCH="product/lifeline-mt5-fivecloud-isolated-20261020"
REQUIRED=["README_START_HERE.md","CURRENT_STATE_AND_NEXT_STEPS.md",
          "SECURITY_EXCLUSIONS.md","CONTINUATION_PROMPT.txt"]

def sha(blob:bytes)->str:
    return hashlib.sha256(blob).hexdigest()

def reject_reason(path:str)->str|None:
    parts=Path(path).parts
    if "node_modules" in parts:return "reconstruct_from_package_lock"
    if "__pycache__" in parts or ".pytest_cache" in parts or ".mypy_cache" in parts:
        return "generated_cache"
    if path.lower().endswith((".pyc",".pyo",".log",".sqlite",".sqlite3",".db")):
        return "generated_runtime"
    if path.lower().endswith(".zip"):
        return "obsolete_nested_archive_not_required"
    if any(p.lower().startswith(".env") for p in parts):
        return "environment_secrets_excluded"
    if path.lower().endswith((".pem",".key",".p12",".pfx",".p8",".p7b")):
        return "secret_key_material_excluded"
    if any(p in ("id_rsa","id_ed25519","credentials.json","secrets.json") for p in parts):
        return "credential_material_excluded"
    return None

def stage(rel:str,blob:bytes):
    target=OUT/rel
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(blob)

def main():
    branch=os.environ.get("GITHUB_REF_NAME")
    if branch!=EXPECTED_BRANCH:
        raise SystemExit("ref_not_the_isolated_lifeline_branch")
    actual=subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()
    if actual!=os.environ.get("GITHUB_SHA"):
        raise SystemExit("checked_out_commit_does_not_match_runner_sha")
    # npm ci may rewrite tracked node_modules files; none enter our ZIP.
    # Fail only if an IN-SCOPE, FIRST-PARTY file differs from frozen Git HEAD.
    changed=subprocess.check_output(["git","diff","--name-only","HEAD","--",
                                     PROD,".github/workflows"],text=True).splitlines()
    changed_first_party=[x for x in changed if reject_reason(x) is None]
    if changed_first_party:
        raise SystemExit("tracked_first_party_source_dirty")
    # GitHub Actions checkout is a frozen source snapshot. Ignore excluded caches.
    candidates=subprocess.check_output(["git","ls-files","-z"]).decode().split("\x00")
    candidates=[p for p in candidates if p and
       (p.startswith(PROD) or
        (p.startswith(".github/workflows/lifeline") and p.endswith((".yml",".yaml"))))]
    if not candidates:raise SystemExit("no_product_files")
    if OUT.exists():shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    included=[];excluded=[]
    for rel in sorted(set(candidates)):
        p=ROOT/rel
        reason=reject_reason(rel)
        if reason:
            excluded.append({"path":rel,"reason":reason})
            continue
        if p.is_symlink() or not p.is_file():
            raise SystemExit("unexpected_link_or_absent_source")
        raw=p.read_bytes()
        if len(raw)>5_000_000:
            raise SystemExit("source_file_unexpectedly_large")
        # Reject actual private-key blocks in the staged source, not syntactic mentions.
        if re.search(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\r\n]{50,}\s*-----END",raw):
            raise SystemExit("private_key_block_in_source")
        stage("source/"+rel,raw)
        included.append({"path":"source/"+rel,"sha256":sha(raw),"bytes":len(raw)})
    product_count=sum(x["path"].startswith("source/"+PROD) for x in included)
    workflow_count=sum(x["path"].startswith("source/.github/workflows/") for x in included)
    if product_count<30 or workflow_count<20:
        raise SystemExit("product_workflow_coverage_incomplete")
    for required in REQUIRED:
        src=ROOT/HANDOFF/required
        if not src.is_file():raise SystemExit("missing_handoff_document")
        stage("handoff/"+required,src.read_bytes())
    # The startup guide is deliberately duplicated at the ZIP root so a new
    # chat can identify the authoritative entry point without browsing folders.
    stage("README_START_HERE.md",(ROOT/HANDOFF/"README_START_HERE.md").read_bytes())
    stage("verify_handoff.py",(ROOT/HANDOFF/"verify_handoff.py").read_bytes())
    native_root=Path("/tmp/lifeline-native-artifact")
    native_included=[]
    expected_ex5="2b4e93999c8ca23954263d20154ff87e97638221dd3ff15ebf454ba1ce913b59"
    evidence_status="not_available_or_expired"
    if native_root.is_dir() and (native_root/"ExampleSafeEA.ex5").is_file():
        ex=native_root/"ExampleSafeEA.ex5"
        if sha(ex.read_bytes())!=expected_ex5:
            raise SystemExit("native_sample_artifact_sha256_mismatch")
        for item in sorted(native_root.iterdir()):
            if item.is_file() and item.name in {"ExampleSafeEA.ex5","reviewed-native-proof.json",
                  "metaeditor-compile.log"}:
                # Native metadata is from the actual previously verified workflow artifact.
                raw=item.read_bytes()
                if len(raw)>2_000_000:raise SystemExit("native_evidence_oversize")
                stage("evidence/native-compiler/"+item.name,raw)
                native_included.append(item.name)
        evidence_status="verified_native_compiler_artifact_included"
    manifest={
        "schema":"lifeline.mt5.complete_handoff_source_manifest.v1",
        "origin_repository":"evansmusitu/mft-axiom-build",
        "origin_branch":branch,
        "origin_commit_sha":actual,
        "github_run_id":os.environ.get("GITHUB_RUN_ID",""),
        "snapshot_utc":datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pr":30,"pr_preserved_draft":True,
        "protected_main_not_modified":True,
        "source_paths_preserved_under":"source/",
        "included_first_party_product_files":product_count,
        "included_lifeline_github_workflows":workflow_count,
        "included_source_file_count":len(included),
        "included_source_files":included,
        "excluded_tracked_files":excluded,
        "native_ex5_sample_evidence_status":evidence_status,
        "native_evidence_filenames":native_included,
        "credential_transport":"no_credentials_or_plaintext_secrets_in_archive",
        "historical_owner_app_access_session_previously_verified":True,
        "current_owner_app_session_at_handoff_unproven":True,
        "legacy_worker_binding_names_last_verified":6,
        "legacy_worker_required_binding_names":10,
        "legacy_worker_four_sensitive_bindings_missing":True,
        "separate_cutover_required_and_not_authorized":True,
        "cloudflare_d1_service_binding_alt_source_only":True,
        "cloudflare_d1_alt_deployed":False,
        "cloudflare_d1_existing_count_last_verified":11,
        "cloudflare_d1_free_numeric_slot_available":False,
        "stateless_d1_free_alternative_source_implemented":True,
        "stateless_d1_free_alternative_deployed":False,
        "cloudflare_d1_account_count_last_verified_20261025":11,
        "cloudflare_d1_candidate_name_exists_last_verified":False,
        "cloudflare_d1_numeric_free_slot_available":False,
        "cloudflare_d1_zero_spend_plan_and_cap_verified":False,
        "full_customer_route_operational":False,
        "persistent_windows_host_paired":False,
        "live_trading":False,"out_of_pocket_spend_authorized":False
    }
    stage("handoff/SOURCE_MANIFEST.json",(json.dumps(manifest,indent=2,sort_keys=True)+"\n").encode())
    logs={}
    for key,filename in (("windows_agent_and_mcp","/tmp/lifeline-windows-tests.txt"),
                         ("modal_neon_and_research","/tmp/lifeline-modal-tests.txt"),
                         ("cloudflare_edge","/tmp/lifeline-edge-tests.txt")):
        p=Path(filename)
        if not p.is_file():raise SystemExit("missing_validation_log")
        # These are synthetic offline test summaries, not user account data.
        txt=p.read_text(errors="replace")
        logs[key]=("PASS" if
           (("FAILED (" not in txt and "not ok" not in txt) and
            ("OK" in txt or "# pass" in txt)) else "FAIL")
    if any(x!="PASS" for x in logs.values()):
        raise SystemExit("offline_validation_not_passed")
    stage("handoff/VALIDATION_REPORT.txt",("\n".join([
        "LIFELINE COMPLETE PORTABLE HANDOFF — CURRENT SOURCE ACCEPTANCE",
        "Snapshot source SHA: "+actual,
        "GitHub workflow run ID: "+os.environ.get("GITHUB_RUN_ID",""),
        "Windows agent and mock MCP offline Linux regression: "+logs["windows_agent_and_mcp"],
        "Modal+Neon queue/research offline Linux regression: "+logs["modal_neon_and_research"],
        "Cloudflare JWT edge tests: "+logs["cloudflare_edge"],
        "Verified historical sample native Windows EX5: "+evidence_status,
        "Earlier actual vendor-signed MetaEditor EX5 run: 39562462108",
        "Earlier private Modal-Neon real signed probe/receipt run: 39549416299",
        "Earlier actual private Neon mismatched-receipt rejection: 39557904660",
        "Cloudflare Access: previously verified app-specific owner session; current active session NOT asserted",
        "Cloudflare legacy Worker latest validated: 6/10 bindings, four sensitive missing (run 40076927002)",
        "Cloudflare separate cutover flag: NOT enabled",
        "New Cloudflare D1/Service Binding alternative: SOURCE ONLY, NOT deployed (runs 40133125178, 40133361256)",
        "25 Oct verified CF D1 account exact: 11 databases, proposed LIFELINE candidate absent, no Workers Free numeric slot (run 40162809028)",
        "Cloudflare Workers Free entitlement and effective hard zero-dollar billing cap: UNVERIFIED",
        "Real provider read-only and 8/8 preflight unit tests: PASS (run 40162809028)",
        "Shared Modal environment 13 other apps; proxy token isolation NOT verified (run 40079161052)",
        "Offline Node+Python signed bridge Windows/Ubuntu: PASS historical (runs 40095181801, 40091145427)",
        "Protected Vercel v1.2 guest-auth redirect run: 39668082801",
        "Full routed Cloudflare+Modal+Neon+permanent Windows host: NOT VERIFIED",
        "Broker login/orders/real trading: DISABLED",
        "Source file count: "+str(len(included)),
        "Excluded generated/legacy file count: "+str(len(excluded)),
        "This report is not proof of current interactive owner app MFA login or permanent Windows.",
        "This handoff packages the complete LIFELINE product scope only, NOT the whole MUSITU monorepo.",
        ""
    ])).encode())
    # Checksums cover every packaged entry except checksum itself.
    checks=[]
    for p in sorted(OUT.rglob("*")):
        if not p.is_file():continue
        rel=p.relative_to(OUT).as_posix()
        checks.append(sha(p.read_bytes())+"  "+rel)
    stage("SHA256SUMS.txt",("\n".join(checks)+"\n").encode())
    # Independently walk and reverify the newly constructed payload.
    for line in checks:
        digest,rel=line.split("  ",1)
        if sha((OUT/rel).read_bytes())!=digest:
            raise SystemExit("payload_checksum_validation_failed")
    print(json.dumps({"schema":"lifeline.complete_handoff.build.v1",
       "commit_sha":actual,"source_files":len(included),"product_files":product_count,
       "workflows":workflow_count,"excluded":len(excluded),
       "native_artifact":evidence_status,
       "verification":"PASS","archive_source_root":"out/lifeline-handoff"},sort_keys=True))

if __name__=="__main__":
    main()
