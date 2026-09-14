from __future__ import annotations

import hashlib
import json
import pathlib
import shutil

ROOT = pathlib.Path("handoff")
if ROOT.exists():
    shutil.rmtree(ROOT)
ROOT.mkdir()

COMMAND = """RESUME MUSITU FOUNDRY + FORGE FROM THE EXACT CURRENT AUTHORITATIVE CONTINUATION STATE. THIS IS A CONTINUATION — NOT A RESTART, REDESIGN, SUMMARY-ONLY EXERCISE, BRAINSTORMING SESSION, OR PERMISSION TO RECONSTRUCT PRODUCT/SOURCE STATE FROM CHAT MEMORY.

Use my connected Google Drive and connected GitHub directly.

FIRST open Google Drive folder:
MUSITU_FOUNDRY_FORGE_HANDOFFS/CURRENT_20260914_0815_AUTHORITATIVE

Retrieve and verify:
MUSITU_FOUNDRY_FORGE_CONTINUATION_AUTHORITY_20260914_0815_AUTHORITATIVE.zip

Read the ZIP contents in this exact order:
00_START_HERE.md
01_CURRENT_CONTINUATION_AUTHORITY.json
02_BASE_WHOLE_PRODUCT_AUTHORITY.json
03_GITHUB_STATE.json
04_DEPLOYMENT_STATE.json
05_TRUTH_BOUNDARY.json
06_NEXT_ACTIONS.md
07_EXACT_NEW_CHAT_COMMAND.txt

Run VERIFY_CONTINUATION.py and require PASS.

THEN open the referenced immutable base folder:
MUSITU_FOUNDRY_FORGE_HANDOFFS/CURRENT_20260913_0456_AUTHORITATIVE

Reassemble its 16 exact transport parts using REASSEMBLE_HANDOFF_20260913_0456.py. Require reconstructed ZIP size EXACTLY 530444942 bytes and SHA-256 EXACTLY 6f11ae4bbbc38e9bda2338294377a015c8f41d3a246a34b8a4f29364f65be852. Verify against the sibling checksum authority and run VERIFY_HANDOFF.py; require PASS. Do not continue from an unverified base.

Treat that verified whole-product ZIP as the immutable product base and the 20260914 continuation authority as the exact current overlay of GitHub/deployment state.

Before any write, re-read and verify these protected refs in evansmusitu/musitu-foundry-forge:
- main = 9fd5394977996388f967ee5c82e49b76bf3f78ef
- recovery/d12-forensic-bootstrap-20260911 = 603a3b3cdd7a4e26c1a47c1f139c6d65acbf2e5b
- PR #4 remains OPEN, DRAFT, UNMERGED, base recovery/d12-forensic-bootstrap-20260911, head integration/d10-r14-research-intelligence-20260911 at 767e4045710b42ad5514decf69137f22ba92524f
Do not modify protected refs.

Current application authority is app/universal-forge-client-20260912 at f0e805ae298b4720f9263dc15d10f4864b385669. Current isolated deployment-plane authority is deploy/forge-axiom-cloudflare-modal-musitu-store-20260913 at e1b32de3e5e4bd4c4498fc671093953cefb8d417. Current credentialed Axiom deployment execution branch is evansmusitu/mft-axiom-build:foundry-forge-runtime-transport-bootstrap-20260913 at ea7070ad6fb3a7ea5e05e700016562d17cdc7581.

Deployment truth at handoff: the private authenticated Modal pilot musitu-forge-private-staging is genuinely deployed and verified against source commit f0e805ae298b4720f9263dc15d10f4864b385669, protocol digest c9fe2c0dcbc51ed7329aeea8b8d9985c0ccfc70123ac181c755285f1a0fbf3de, persistent state, and production_authorized=false. Cloudflare Worker musitu-forge-edge, D1 musitu-forge-edge, certificate and custom domain forge.mftintelligence.com are provisioned, but canonical reachability is NOT functionally sealed: the latest diagnostic returned HTTP 403 with cf-mitigated: challenge, and the failed edge verification deleted its dedicated Modal proxy token. Therefore do not claim the Cloudflare edge is production-ready or end-to-end healthy until the challenge is explicitly bypassed/disabled for the API route and a fresh retained Cloudflare-to-Modal credential is installed and reverified.

MUSITU Store is the application/package/catalog release signing authority. Backend Ed25519 assignment/receipt keys are separate runtime integrity authorities and must not be conflated with MUSITU Store publisher signing.

Do not claim production authorization, commercial sealing, real field evidence, external expert credentials, independent field-evaluation receipt, D12 identity, superiority, private-client compile qualification, device-build-matrix qualification, or qualified video derivation unless new evidence genuinely earns it.

Continue from 06_NEXT_ACTIONS.md. Do not restart or reconstruct from chat memory."""

(ROOT / "07_EXACT_NEW_CHAT_COMMAND.txt").write_text(COMMAND + "\n", encoding="utf-8")

(ROOT / "00_START_HERE.md").write_text(
    """# MUSITU FOUNDRY + FORGE — CURRENT CONTINUATION AUTHORITY

This ZIP is the authoritative 2026-09-14 continuation capsule. It does not replace or duplicate the 530,444,942-byte immutable whole-product archive already held privately in Google Drive. It hash-binds that exact base and freezes all newer GitHub/deployment state required to continue without chat-memory reconstruction.

Read in exact order: 01_CURRENT_CONTINUATION_AUTHORITY.json, 02_BASE_WHOLE_PRODUCT_AUTHORITY.json, 03_GITHUB_STATE.json, 04_DEPLOYMENT_STATE.json, 05_TRUTH_BOUNDARY.json, 06_NEXT_ACTIONS.md, 07_EXACT_NEW_CHAT_COMMAND.txt. Then run VERIFY_CONTINUATION.py and require PASS. Next retrieve/reassemble/verify the referenced 20260913 whole-product base and require VERIFY_HANDOFF.py PASS before changing product source.

Never substitute an older checkpoint, chat summary, similarly named archive, or inferred source state for these authorities.
""",
    encoding="utf-8",
)

current = {
    "schema": "musitu.foundry_forge.current_continuation_authority.v1",
    "authority_timestamp": "2026-09-14T08:15:00+02:00",
    "product": "MUSITU FOUNDRY + FORGE",
    "drive_current_folder": "MUSITU_FOUNDRY_FORGE_HANDOFFS/CURRENT_20260914_0815_AUTHORITATIVE",
    "drive_current_folder_id": "1P_WKw2Ih6kGOUOrVhBoU8QeH15hmwtll",
    "base_authority_file": "02_BASE_WHOLE_PRODUCT_AUTHORITY.json",
    "github_state_file": "03_GITHUB_STATE.json",
    "deployment_state_file": "04_DEPLOYMENT_STATE.json",
    "truth_boundary_file": "05_TRUTH_BOUNDARY.json",
    "next_actions_file": "06_NEXT_ACTIONS.md",
    "new_chat_command_file": "07_EXACT_NEW_CHAT_COMMAND.txt",
    "continuation_rule": "verify capsule, then verify immutable whole-product base, then use current GitHub/deployment overlay; never reconstruct from chat memory",
    "release_signing_authority": "MUSITU_STORE",
    "protocol_digest": "c9fe2c0dcbc51ed7329aeea8b8d9985c0ccfc70123ac181c755285f1a0fbf3de",
}

base = {
    "schema": "musitu.foundry_forge.base_whole_product_authority.v1",
    "drive_folder": "MUSITU_FOUNDRY_FORGE_HANDOFFS/CURRENT_20260913_0456_AUTHORITATIVE",
    "drive_folder_id": "1c-D7MB0YWLwFrjltfDQOTP0JKo9gn05L",
    "reconstructed_zip": "MUSITU_FOUNDRY_FORGE_WHOLE_PRODUCT_CONTINUATION_HANDOFF_20260913_0456_AUTHORITATIVE.zip",
    "size_bytes": 530444942,
    "sha256": "6f11ae4bbbc38e9bda2338294377a015c8f41d3a246a34b8a4f29364f65be852",
    "transport_parts": 16,
    "reassembler": "REASSEMBLE_HANDOFF_20260913_0456.py",
    "verify_script": "VERIFY_HANDOFF.py",
    "nested_baseline": {
        "filename": "MUSITU_FOUNDRY_FORGE_WHOLE_PRODUCT_CONTINUATION_HANDOFF_20260912_2051_AUTHORITATIVE.zip",
        "size_bytes": 530434162,
        "sha256": "bbcd720b6194a7d512750bcba3b9d25b042328268a9cc1bf7337c14e9ba687e7",
    },
    "d10_sha256": "34405cb7209b9f13f67b36d041e4206f85e2f1c787a243cb3b3ec5da3b37ffb4",
    "v9_overlay_sha256": "a1ea53c7d4cf3bdc03352b19a1c5bc23f32c9b9276b30014c13a14d84038a195",
    "v9_reconstructed_tree_sha256": "2f636e5c7feab29216fabbdc18978e8a6d30bc1e3def3ec89a7938b60bfa68f1",
    "v9_tree_entries": 5277,
}

github = {
    "schema": "musitu.foundry_forge.github_state.v1",
    "private_repo": "evansmusitu/musitu-foundry-forge",
    "application_branch": "app/universal-forge-client-20260912",
    "application_head": "f0e805ae298b4720f9263dc15d10f4864b385669",
    "application_evidence": "evidence/app/MUSITU_FORGE_UNIVERSAL_CLIENT_V43_20260913.json",
    "application_evidence_blob": "dcf7ab8070645ea53ba44fea228d68dceeb6b1d9",
    "deployment_branch": "deploy/forge-axiom-cloudflare-modal-musitu-store-20260913",
    "deployment_head": "e1b32de3e5e4bd4c4498fc671093953cefb8d417",
    "cloudflare_worker_blob": "918ec9ba828e367022c231f80344abf50a6210a1",
    "protected_refs": {
        "main": "9fd5394977996388f967ee5c82e49b76bf3f78ef",
        "recovery/d12-forensic-bootstrap-20260911": "603a3b3cdd7a4e26c1a47c1f139c6d65acbf2e5b",
        "pr4": {
            "number": 4,
            "state": "open",
            "draft": True,
            "merged": False,
            "base": "recovery/d12-forensic-bootstrap-20260911",
            "base_sha": "603a3b3cdd7a4e26c1a47c1f139c6d65acbf2e5b",
            "head": "integration/d10-r14-research-intelligence-20260911",
            "head_sha": "767e4045710b42ad5514decf69137f22ba92524f",
        },
    },
    "public_preflight": {
        "repo": "evansmusitu/aurora.com",
        "branch": "foundry-forge-axiom-parity-preflight-20260913",
        "head": "c0c2ca3d79ea948950eebf8756e69a4630bbe047",
        "exact_worker_blob_match": True,
        "tests_passed": 7,
        "tests_run": 7,
    },
    "credentialed_deployment_repo": "evansmusitu/mft-axiom-build",
    "credentialed_deployment_branch": "foundry-forge-runtime-transport-bootstrap-20260913",
    "credentialed_deployment_head": "ea7070ad6fb3a7ea5e05e700016562d17cdc7581",
}

deployment = {
    "schema": "musitu.foundry_forge.deployment_state.v1",
    "source_commit": "f0e805ae298b4720f9263dc15d10f4864b385669",
    "protocol_digest": "c9fe2c0dcbc51ed7329aeea8b8d9985c0ccfc70123ac181c755285f1a0fbf3de",
    "modal": {
        "state": "DEPLOYED_PRIVATE_PILOT_VERIFIED",
        "app": "musitu-forge-private-staging",
        "function": "forge_custody",
        "origin": "https://evansmusitu--musitu-forge-private-staging-forge-custody.modal.run",
        "requires_proxy_auth": True,
        "persistent_state_volume": "musitu-forge-state",
        "production_authorized": False,
        "release_signing_authority": "MUSITU_STORE",
        "workflow_run_id": 34766318183,
        "workflow_job_id": 103747805941,
        "workflow_head": "c9c5a132b5f833fe21cb593a9d25ccaf4cec8948",
        "gate": "PASS",
        "runtime_transport": "PASS",
        "runtime_probe": "PASS",
        "protocol_compatibility": "PASS",
        "evidence_artifact_id": 10320801922,
        "evidence_artifact_sha256": "f2dc995c8940d5ace95f0f271c6010db66be5efff458c87ea6eb5864863199f5",
    },
    "cloudflare": {
        "worker": "musitu-forge-edge",
        "d1": "musitu-forge-edge",
        "custom_domain": "forge.mftintelligence.com",
        "zone": "mftintelligence.com",
        "custom_domain_registered": True,
        "custom_domain_enabled": True,
        "certificate_present": True,
        "worker_uploaded": True,
        "worker_version_id": "b9334780-f405-4b19-a777-985099c892ac",
        "d1_schema_applied": True,
        "modal_proxy_secrets_installed_during_run": True,
        "edge_deploy_run_id": 34766663790,
        "edge_deploy_job_id": 103748732878,
        "edge_deploy_head": "a034349d908855bc8fc3a28e6f8cbbdbc9416d59",
        "edge_deploy_overall_result": "FAILURE_AT_CANONICAL_VERIFICATION",
        "canonical_health_verified": False,
        "latest_http_status": 403,
        "latest_cf_mitigated": "challenge",
        "managed_challenge_blocks_api_probe": True,
        "dedicated_modal_proxy_token_retained": False,
        "credential_note": "failure cleanup deleted the dedicated Modal proxy token after Worker secrets were installed; install a fresh retained credential before re-verification",
        "diagnostic_run_id": 34766955613,
        "diagnostic_job_id": 103749516115,
        "diagnostic_head": "ea7070ad6fb3a7ea5e05e700016562d17cdc7581",
        "diagnostic_result": "PASS_FOR_DIAGNOSTIC_ONLY",
        "production_ready": False,
        "end_to_end_health_verified": False,
    },
}

truth = {
    "schema": "musitu.foundry_forge.truth_boundary.v1",
    "earned_true": {
        "public_dependency_stack_qualified": True,
        "qualified_dependency_bytes_complete": True,
        "target_cpython312_fully_qualified": True,
        "current_backend_cpython312_regression_qualified": True,
        "modal_private_pilot_deployed": True,
        "modal_proxy_auth_required": True,
        "cloudflare_worker_provisioned": True,
        "cloudflare_d1_provisioned": True,
        "cloudflare_custom_domain_registered": True,
        "cloudflare_custom_domain_enabled": True,
        "musitu_store_is_release_signing_authority": True,
    },
    "not_earned_or_not_complete": {
        "cloudflare_canonical_api_end_to_end_verified": False,
        "cloudflare_edge_production_ready": False,
        "private_client_compile_qualified": False,
        "device_build_matrix_qualified": False,
        "qualified_video_derivation_runtime_available": False,
        "production_authorized": False,
        "commercial_candidate_sealed": False,
        "real_field_evidence_complete": False,
        "real_external_expert_credentials_present": False,
        "real_field_evaluation_receipt_present": False,
        "d12_identity_resolved": False,
        "superiority_certified": False,
        "private_signing_material_included": False,
    },
    "signing_boundary": "MUSITU Store signs/releases applications/packages/catalog entries; backend Ed25519 assignment and custody-receipt keys are separate runtime integrity authorities.",
}

(ROOT / "06_NEXT_ACTIONS.md").write_text(
    """# NEXT ACTIONS — EXACT FRONTIER

1. Re-read `evansmusitu/mft-axiom-build:foundry-forge-runtime-transport-bootstrap-20260913` and require the recorded head or a reviewed clean descendant before deployment changes.
2. Fix the Cloudflare API-path challenge without weakening unrelated site protection: explicitly exempt/bypass the canonical FORGE API route(s) from interactive managed challenge, preserving normal API security controls.
3. Create a fresh dedicated Modal proxy credential, install it into the Cloudflare Worker as `MODAL_KEY`/`MODAL_SECRET`, and retain it only after end-to-end verification succeeds. The prior edge run's token was deleted on failure.
4. Re-verify `https://forge.mftintelligence.com/v1/health` through Cloudflare: require HTTP 200, `x-musitu-edge: forge-cloudflare-modal-v1`, health schema `musitu.forge.health.v1`, `status=READY`, exact protocol digest, `production_authorized=false`, and custody uploads ready. Then verify wrong protocol digest is rejected at edge and correct digest reaches backend bearer auth; direct unauthenticated Modal origin must remain 401/403.
5. Seal fresh Cloudflare evidence only after that full end-to-end PASS. Do not call the edge production-ready beforehand.
6. Continue private Flutter client qualification: actual proprietary client still needs source-bound analyze/test/build evidence. Public toolchain/dependency qualification is not a substitute for private-client compile proof.
7. Continue six-platform device/build qualification separately; do not infer it from source-free toolchain smoke.
8. Keep MUSITU Store as application release-signing/distribution authority; connect actual Store admission/signing only to verified client build artifacts.
9. D12 remains unresolved until exact missing private D11 output lineage is recovered and hash-traced. Never relabel D10/D11/S2 R12/R14 by naming similarity.
10. Keep production authorization, commercial sealing, real field evidence, external expert credentials, independent field evaluation and superiority false until genuinely earned.
""",
    encoding="utf-8",
)

for name, obj in [
    ("01_CURRENT_CONTINUATION_AUTHORITY.json", current),
    ("02_BASE_WHOLE_PRODUCT_AUTHORITY.json", base),
    ("03_GITHUB_STATE.json", github),
    ("04_DEPLOYMENT_STATE.json", deployment),
    ("05_TRUTH_BOUNDARY.json", truth),
]:
    (ROOT / name).write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")

VERIFIER = r'''from __future__ import annotations
import hashlib,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parent
expected={}
for line in (ROOT/'SHA256SUMS').read_text(encoding='utf-8').splitlines():
    if not line.strip(): continue
    digest,name=line.split('  ',1); expected[name]=digest
errors=[]
for name,digest in expected.items():
    p=ROOT/name
    if not p.is_file(): errors.append('missing:'+name); continue
    got=hashlib.sha256(p.read_bytes()).hexdigest()
    if got!=digest: errors.append('sha256:'+name+':'+got)
cur=json.loads((ROOT/'01_CURRENT_CONTINUATION_AUTHORITY.json').read_text())
base=json.loads((ROOT/'02_BASE_WHOLE_PRODUCT_AUTHORITY.json').read_text())
gh=json.loads((ROOT/'03_GITHUB_STATE.json').read_text())
dep=json.loads((ROOT/'04_DEPLOYMENT_STATE.json').read_text())
truth=json.loads((ROOT/'05_TRUTH_BOUNDARY.json').read_text())
checks=[
(cur.get('schema')=='musitu.foundry_forge.current_continuation_authority.v1','current_schema'),
(base.get('size_bytes')==530444942,'base_size'),
(base.get('sha256')=='6f11ae4bbbc38e9bda2338294377a015c8f41d3a246a34b8a4f29364f65be852','base_sha'),
(gh.get('application_head')=='f0e805ae298b4720f9263dc15d10f4864b385669','app_head'),
(gh.get('deployment_head')=='e1b32de3e5e4bd4c4498fc671093953cefb8d417','deploy_head'),
(gh.get('protected_refs',{}).get('main')=='9fd5394977996388f967ee5c82e49b76bf3f78ef','main'),
(gh.get('protected_refs',{}).get('recovery/d12-forensic-bootstrap-20260911')=='603a3b3cdd7a4e26c1a47c1f139c6d65acbf2e5b','recovery'),
(gh.get('protected_refs',{}).get('pr4',{}).get('head_sha')=='767e4045710b42ad5514decf69137f22ba92524f','pr4_head'),
(dep.get('modal',{}).get('gate')=='PASS','modal_gate'),
(dep.get('modal',{}).get('production_authorized') is False,'modal_prod_false'),
(dep.get('cloudflare',{}).get('custom_domain_enabled') is True,'cf_domain'),
(dep.get('cloudflare',{}).get('end_to_end_health_verified') is False,'cf_not_sealed'),
(dep.get('cloudflare',{}).get('latest_cf_mitigated')=='challenge','cf_challenge'),
(truth.get('not_earned_or_not_complete',{}).get('production_authorized') is False,'prod_false'),
(truth.get('not_earned_or_not_complete',{}).get('d12_identity_resolved') is False,'d12_false'),
]
for ok,label in checks:
    if not ok: errors.append('authority:'+label)
if errors:
    print('CONTINUATION_VERIFY_FAIL')
    for e in errors: print(e)
    sys.exit(1)
print('CONTINUATION_VERIFY_PASS')
print('BASE_REASSEMBLY_REQUIRED=true')
print('BASE_SHA256='+base['sha256'])
print('APPLICATION_HEAD='+gh['application_head'])
print('DEPLOYMENT_HEAD='+gh['deployment_head'])
'''
(ROOT / "VERIFY_CONTINUATION.py").write_text(VERIFIER, encoding="utf-8")

names = [
    "00_START_HERE.md",
    "01_CURRENT_CONTINUATION_AUTHORITY.json",
    "02_BASE_WHOLE_PRODUCT_AUTHORITY.json",
    "03_GITHUB_STATE.json",
    "04_DEPLOYMENT_STATE.json",
    "05_TRUTH_BOUNDARY.json",
    "06_NEXT_ACTIONS.md",
    "07_EXACT_NEW_CHAT_COMMAND.txt",
    "VERIFY_CONTINUATION.py",
]
rows = []
manifest_files = []
for name in names:
    data = (ROOT / name).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    rows.append(f"{digest}  {name}")
    manifest_files.append({"path": name, "size_bytes": len(data), "sha256": digest})
manifest = {
    "schema": "musitu.foundry_forge.continuation_package_manifest.v1",
    "package_name": "MUSITU_FOUNDRY_FORGE_CONTINUATION_AUTHORITY_20260914_0815_AUTHORITATIVE",
    "base_whole_product_sha256": base["sha256"],
    "application_head": github["application_head"],
    "deployment_head": github["deployment_head"],
    "credentialed_deployment_head": github["credentialed_deployment_head"],
    "files": manifest_files,
}
(ROOT / "HANDOFF_PACKAGE_MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
data = (ROOT / "HANDOFF_PACKAGE_MANIFEST.json").read_bytes()
rows.append(f"{hashlib.sha256(data).hexdigest()}  HANDOFF_PACKAGE_MANIFEST.json")
(ROOT / "SHA256SUMS").write_text("\n".join(rows) + "\n", encoding="utf-8")

print("HANDOFF_GENERATED")
print("files=11")
