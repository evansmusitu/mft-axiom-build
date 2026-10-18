#!/usr/bin/env python3
"""Reproducible, credential-free MUSITU Studio project handoff bundle.
Uses only tracked Studio source and independent GitHub Actions proof artifacts.
"""
from __future__ import annotations
import hashlib, json, os, pathlib, shutil, subprocess, textwrap, zipfile

ROOT = pathlib.Path.cwd()
OUTPUT = ROOT / "MUSITU_STUDIO_COMPLETE_HANDOFF_20261018"
SOURCE = OUTPUT / "01_PRODUCT_SOURCE"
EVIDENCE = OUTPUT / "02_VERIFIED_EXECUTION_EVIDENCE"
READ = OUTPUT / "00_READ_FIRST"
DOCS = OUTPUT / "03_DEPLOYMENT_AND_OPERATIONS"
REF = "experiments/studio-remote-r2-modal-e2e-20261017"
REPO = "evansmusitu/mft-axiom-build"
EXPECTED = [
    "studio-modal-cpu-pull-evidence.json",
    "studio-real-r2-modal-e2e.json",
    "studio-live-cpu-acceptance.json",
    "studio-cloudflare-1010-cause-readonly.json",
    "studio-pagerules-capacity.json",
]
RUNS = {
 "39060405530": "real deployed Modal CPU Blender render and artifact downloads",
 "39060544185": "remote Cloudflare R2 upload and exact byte readback",
 "39060820517": "real Worker code under local Wrangler, Modal CPU, remote Cloudflare R2",
 "39061172032": "48 Studio/Access/UI security and CI checks (past proof)",
 "39061325303": "live dedicated Cloudflare Worker CPU activation",
 "39061504060": "read-only production Worker, staff Access and R2 binding acceptance",
 "39061736395": "v0.9 source-release artifact",
 "39065129067": "Cloudflare security inventory for Error 1010",
 "39065355637": "Cloudflare Page Rule capacity, read-only",
}
def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
def write(base: pathlib.Path, name: str, value: str) -> None:
    path = base / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(value).lstrip(), encoding="utf-8")
def require(condition: bool, message: str) -> None:
    if not condition: raise AssertionError(message)

def source_snapshot() -> tuple[str, list[str]]:
    branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    require(branch == REF, "Expected exact Studio branch, not production main")
    paths = subprocess.check_output(["git","ls-files","-z"]).decode().split("\0")
    accepted = []
    for relative in paths:
        if not relative:continue
        if not (relative.startswith("musitu_studio/") or
                (relative.startswith("ops/studio_") and relative.endswith(".py")) or
                (relative.startswith(".github/workflows/studio-") and relative.endswith(".yml"))):
            continue
        parts = pathlib.PurePosixPath(relative).parts
        require(not any(x in parts for x in (".git","node_modules",".wrangler","__pycache__",".venv")), relative)
        require(not any(x in relative.lower() for x in (".env",".dev.vars",".pem",".key","credential.json")), relative)
        file = ROOT/relative
        require(file.is_file() and not file.is_symlink(), relative)
        require(file.stat().st_size < 700_000, "Unexpected large source: "+relative)
        target=SOURCE/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(file,target)
        accepted.append(relative)
    require(len(accepted) >= 70, "Incomplete source snapshot: "+str(len(accepted)))
    require("musitu_studio/modal/studio_modal.py" in accepted, "Missing Modal worker")
    require("musitu_studio/edge/src/r2_entry.mjs" in accepted, "Missing R2 edge")
    require("ops/studio_r2_cpu_staff_deploy.py" in accepted, "Missing current deployment")
    require("musitu_studio/edge/src/session.mjs" in accepted, "Missing staff session")
    return commit, sorted(accepted)

def add_evidence() -> dict:
    root=ROOT/"_studio_handoff_evidence"
    require(root.is_dir(),"Proof inputs missing")
    receipts={}
    for filename in EXPECTED:
        matches=list(root.rglob(filename))
        require(len(matches)==1, "Missing or duplicated verified receipt "+filename+":"+str(matches))
        src=matches[0]
        dest=EVIDENCE/filename
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(src,dest)
        record=json.loads(dest.read_text())
        receipts[filename]=record
    cpu=receipts["studio-modal-cpu-pull-evidence.json"]
    require(cpu.get("result")=="PASS" and cpu.get("modal_real_cpu_render") is True
            and cpu.get("gpu_entitlement_verified") is False,"CPU proof unsupported")
    require({f["name"] for f in cpu["files"]}=={"scene.blend","scene.glb","preview.png"}, "CPU proof files")
    for f in cpu["files"]:
        matches=list(root.rglob("studio-pull-proof/"+f["name"]))
        require(len(matches)==1,"Missing Blender file "+f["name"])
        content=matches[0].read_bytes()
        require(sha(content)==f["sha256"] and len(content)==f["bytes"],"CPU file integrity "+f["name"])
        output=EVIDENCE/"modal_real_cpu_outputs"/f["name"]
        output.parent.mkdir(exist_ok=True,parents=True)
        output.write_bytes(content)
    cross=receipts["studio-real-r2-modal-e2e.json"]
    require(cross.get("result")=="PASS" and cross.get("cloudflare_r2_binding_remote") is True
       and cross.get("modal_real_render") is True and cross.get("gpu_verified") is False,"Cross-provider proof unsupported")
    readback=receipts["studio-live-cpu-acceptance.json"]
    require(readback.get("production_configuration_readback_pass") is True
       and readback.get("live_cloudflare_modal_cpu_job_via_browser_verified") is False,
       "Live acceptance marker mismatch")
    return receipts

def report(commit: str, paths: list[str], evidence: dict) -> None:
    facts={
      "schema":"musitu.studio.complete-handoff.v1",
      "handoff_created_utc":"2026-10-18",
      "canonical_repo":REPO,"canonical_branch":REF,"canonical_commit_sha":commit,
      "source_files_included":len(paths),
      "active_product":"MUSITU Enterprise 3D Studio",
      "stack":["GitHub Actions","Cloudflare Workers","Cloudflare Access","Cloudflare R2","Modal CPU Blender 4.5"],
      "live_cloudflare_worker":"musitu-studio-v02",
      "live_control_domain":"studio.mftintelligence.com",
      "isolated_r2_bucket":"musitu-studio-v02-assets",
      "cloudflare_access_app":"MUSITU Studio Android Control",
      "live_modal_app":"musitu-studio-v02",
      "active_backend":"R2_CAS_SINGLE_ADMIN",
      "cpu_render_verified_in_real_modal":True,
      "real_worker_code_modal_cpu_live_r2_cross_provider_verified":True,
      "public_android_login_and_render_verified":False,
      "public_access_blocker":"Cloudflare Error 1010 before Worker, may affect automated/bot requests; human Android unknown",
      "cloudflare_security_setting":"Browser Integrity Check ON, security_level under_attack at prior read-only check",
      "d1_database_deployed":False,
      "modal_gpu_qualified":False,
      "modal_t4_payment_method_required":True,
      "full_enterprise_certified":False,
      "owner_approved_existing_provider_use":True,
      "provider_zero_out_of_pocket_hard_cap_proven":False,
      "secrets_included":False,
      "affected_axiom_production_resources":False,
      "proof_run_ids":{k:v for k,v in RUNS.items()},
    }
    write(READ,"CURRENT_STATE.json",json.dumps(facts,indent=2,sort_keys=True)+"\n")
    write(READ,"START_HERE.md",f"""
      # MUSITU Enterprise 3D Studio — full handoff, 18 October 2026

      **Read this directory first. This is a source-and-evidence snapshot, not a declaration of full production acceptance.**

      Canonical GitHub source: `{REPO}`, branch `{REF}`, commit `{commit}`.
      The files in `01_PRODUCT_SOURCE` reproduce the tracked Studio product code, cloud deployment
      actions, qualification scripts, backend schemas, authenticated Android UI and native Blender executor.

      ## What is live
      - Dedicated Cloudflare Worker `musitu-studio-v02`, attached to `studio.mftintelligence.com`.
      - Dedicated R2 bucket `musitu-studio-v02-assets` and an R2 CAS single-admin queue (NOT D1).
      - Staff-only Cloudflare Access app `MUSITU Studio Android Control`, signed Access JWT
        verification and 1-hour bound HttpOnly/Secure staff session.
      - Real Modal app `musitu-studio-v02` deployed with CPU Blender 4.5 rendering and
        protected HTTPS job submission/pull polling; CPU dispatch is enabled in the Studio Worker
        but requires manual approval and explicit action.
      - Proof: actual Modal CPU `.blend`, `.glb`, `.png` output and independent sha256,
        actual remote Cloudflare R2 persistence and Worker-runtime code -> Modal -> remote R2
        E2E tested under local Wrangler with remote R2 binding.

      ## Not finished / do not misstate
      - Public Android browser sign-in and browser-originated live CPU render NOT verified.
        Cloudflare 403 **Error 1010** occurs before Worker on probes (humans may differ).
      - Do not weaken zone-wide security or disturb Axiom to solve Error 1010.
        Zone had Browser Integrity Check ON and Security Level `under_attack` in last read-only probe.
      - Dedicated D1 database could NOT be created with current scoped token. R2 CAS is a
        limited pilot, not production-grade multi-tenant transactional DB.
      - Modal T4/GPU provisioning explicitly rejected by provider:
        **"Please add a payment method to use T4 GPU functions".** No CUDA GPU proof exists.
      - Modal/R2 can incur charges: owner approved existing provider usage, but provider-level
        hard $0 out-of-pocket guarantee was not confirmed. Track billing responsibly.
      - Existing Axiom production Workers, D1, R2 resources, routes and default branches
        must not be modified. No new hardware or unrelated cloud provider required.

      ## Exact navigation
      1. `00_READ_FIRST/CURRENT_STATE.json` — machine-readable status.
      2. `00_READ_FIRST/NEW_CHAT_COMMAND.txt` — paste EXACTLY into the next chat.
      3. `01_PRODUCT_SOURCE/musitu_studio/` — complete Studio source, web UI, Blender executor.
      4. `01_PRODUCT_SOURCE/ops/` — only Studio provisioning/qualification scripts.
      5. `01_PRODUCT_SOURCE/.github/workflows/` — Studio Actions pipelines.
      6. `02_VERIFIED_EXECUTION_EVIDENCE/` — genuine source-of-truth receipts and Blender binaries.
      7. `03_DEPLOYMENT_AND_OPERATIONS/` — safe continuation and CI URLs.
      8. `SHA256SUMS.txt` / `FILE_MANIFEST.json` — checksum inventory.

      Your connected Google Drive has the archive. In the new conversation, supply this
      archive or its **actual verified Drive file link** and ask the assistant to inspect it.
    """)
    write(DOCS,"SAFE_CONTINUATION_PLAN.md",f"""
      # Exact safe continuation priorities
      1. **Read** current production state and the live Cloudflare Worker, Access and R2 binding
         using connected GitHub / read-only Cloudflare checks. Re-verify sources because cloud status changes.
      2. Investigate Cloudflare Error 1010 without global reductions:
         previous zone readback: BIC=on, security_level=under_attack, 0 active UA blocking rules,
         10 http_config_settings rules (none Studio-scoped), custom firewall one rule.
         Rule write to disable BIC ONLY on Studio callback was denied HTTP 403; do NOT
         repeat indiscriminately. Owner/admin may need narrowly scoped settings.
         Verify actual Android user experience first.
      3. Test staff Cloudflare Access -> dashboard -> project -> validated Blender scene ->
         explicit approve -> CPU dispatch -> Modal pull -> Studio R2 -> file download.
         Archive genuine R2/Modal checksums and a full end-to-end acceptance receipt.
      4. Improve R2 CAS pilot recovery, queue durability, backups and RBAC; D1 needs scoped
         D1 Create permission. Do not pretend R2 CAS is D1 enterprise queue.
      5. Qualify Modal T4/CUDA only AFTER Modal account adds required payment method;
         do not invent GPU proofs. Keep GPU execution off until entitlement is real.
      6. Never expose env secrets or embed bearer tokens into downloaded ZIPs, JS, logs or chat.
         Use GitHub Actions existing private secret references.
      7. Do not touch Axiom default branch, paid runtime allocation or existing Axiom Cloudflare policy.
         Studio is isolated on an experimental branch; no blind merge.
      8. Keep source, tests and Drive release current, independently verify each live milestone.

      ## Helpful commands (run in checked-out GitHub branch)
      `cd musitu_studio/edge && npm install --ignore-scripts --no-fund --no-audit && node --test tests/*.test.mjs`
      `python -m compileall -q musitu_studio/studio musitu_studio/modal ops`
      Production deployment is via `.github/workflows/studio-cpu-update.yml` which calls
      `ops/studio_r2_cpu_staff_deploy.py` in `{REPO}`. Do NOT execute this workflow
      until the change is reviewed and authorized; it is a real provider mutation.
      Modal deployed app: `musitu-studio-v02`; do not redeploy the GPU function while
      the T4 payment-method restriction exists.

      ## Confirmed GitHub Actions evidence
    """+"\n".join(f"- Run [{rid}](https://github.com/{REPO}/actions/runs/{rid}): {name}" for rid,name in RUNS.items())+"\n")
    command=f"""Continue MUSITU Enterprise 3D Studio from my attached `MUSITU_STUDIO_COMPLETE_HANDOFF_20261018.zip` (also uploaded to my connected Google Drive). Treat `00_READ_FIRST/START_HERE.md`, `CURRENT_STATE.json`, `03_DEPLOYMENT_AND_OPERATIONS/SAFE_CONTINUATION_PLAN.md`, the entire `01_PRODUCT_SOURCE` tree and `02_VERIFIED_EXECUTION_EVIDENCE` as the complete handoff. First extract, inspect and verify SHA256SUMS, then check live GitHub/Cloudflare/Modal state. Canonical source is `{REPO}` branch `{REF}` commit `{commit}`. Continue autonomously from the exact proven state: live Cloudflare Studio Worker, staff-only Access, dedicated R2, Modal CPU Blender and real cross-provider Worker-runtime -> Modal -> remote R2 proof already exist. The real public Android Access/browser-to-production render is NOT verified because external Cloudflare Error 1010 remains; D1 creation permission is missing and Modal T4 GPU requires a payment method. Diagnose and resolve remaining blockers safely, validate genuine browser-initiated CPU-to-R2 output and only then GPU if entitlement becomes available. Do not repeat completed work, modify Axiom production/default branches or global Cloudflare security, create unrelated infrastructure, expose credentials, or claim unverified success. Record exact tests, releases and any unresolved blockers. Do all practical work in this chat without unnecessary stops."""
    write(READ,"NEW_CHAT_COMMAND.txt",command+"\n")
    write(DOCS,"EVIDENCE_GUIDE.md",f"""
      # Provenance, acceptance boundaries and references
      All evidence files in `02_VERIFIED_EXECUTION_EVIDENCE` came from named GitHub Actions
      artifacts; GitHub logs linked below remain authoritative for status.

      - Modal actual CPU (run 39060405530): `studio-modal-cpu-pull-evidence.json`, and native outputs.
      - Wrangler Worker runtime with **remote** Cloudflare R2 / live Modal (run 39060820517):
        `studio-real-r2-modal-e2e.json` proves this path but not externally hosted public browser.
      - Production Worker/API/Access/R2 readback (run 39061504060):
        `studio-live-cpu-acceptance.json`.
      - Zone Error 1010 rule inventory (run 39065129067): read-only controls, not a fix.
      - Page Rules availability (run 39065355637): query HTTP 400, headroom unknown.
      - Source snapshot includes active deploy/config and all Studio GitHub Actions workflows.
      - Modal T4 GPU remains entitlement blocked; no GPU artifact is included.

      **Do not infer success of a user interaction from a passing GitHub test.**
      Source version must be cross-checked against GitHub head before modification.
    """)
    write(DOCS,"GIT_SOURCE_IDENTITY.json",json.dumps({
      "repository":REPO,"branch":REF,"commit":commit,
      "source_count":len(paths),"packaging_mode":"tracked-source-only",
      "excluded_credential_patterns":[".env",".dev.vars","node_modules",".wrangler","key","pem"]},indent=2)+"\n")

def finalize() -> None:
    hashes={}
    for item in sorted(OUTPUT.rglob("*")):
        if item.is_file() and item.name not in ("FILE_MANIFEST.json","SHA256SUMS.txt"):
            rel=item.relative_to(OUTPUT).as_posix()
            hashes[rel]={"sha256":sha(item.read_bytes()),"bytes":item.stat().st_size}
    write(OUTPUT,"FILE_MANIFEST.json",json.dumps({"schema":"musitu.studio.file-manifest.v1",
      "file_count":len(hashes),"files":hashes},indent=2,sort_keys=True)+"\n")
    write(OUTPUT,"SHA256SUMS.txt","".join(f"{data['sha256']}  {file}\n"
        for file,data in sorted(hashes.items())))
    count=len(hashes)+2
    require(count>80,"Handoff unexpectedly sparse "+str(count))
    print("MUSITU_STUDIO_CONTINUITY_READY="+json.dumps({
        "files":count,"source_files":sum(name.startswith("01_PRODUCT_SOURCE/") for name in hashes),
        "has_binary_blender":(EVIDENCE/"modal_real_cpu_outputs"/"scene.blend").is_file(),
        "has_real_remote_r2_proof":(EVIDENCE/"studio-real-r2-modal-e2e.json").is_file()}))

if __name__=="__main__":
    if OUTPUT.exists():shutil.rmtree(OUTPUT)
    for directory in (READ,SOURCE,EVIDENCE,DOCS):directory.mkdir(parents=True,exist_ok=True)
    commit,paths=source_snapshot()
    ev=add_evidence()
    report(commit,paths,ev)
    finalize()
