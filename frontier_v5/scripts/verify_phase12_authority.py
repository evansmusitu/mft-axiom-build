#!/usr/bin/env python3
from __future__ import annotations
import json
import pathlib
import subprocess
from frontier_review_safe.review_snapshot import ReviewSnapshotGuard, ReviewSnapshotManifest

EXPECTED = {
    "refs/remotes/origin/main": "d6a846f6bbe0bccac1758713eb4de167caf07113",
    "refs/remotes/origin/frontier/axiom-v5-skill-fabric": "d9196774a9fff3150922e2cb681d16e2423651da",
    "refs/remotes/origin/archive/axiom-track-a-post-freeze-20260912": "20a84b1090b8ad986e35fee20008f3ed8920440c",
    "refs/remotes/origin/frontier/axiom-v5-world-top-tier-review-safe": "73ecdbad38cb10020b6e30ebe42a9222a3bb6c55",
}
PHASE11_SEAL = "98f74b9184dc4ea0bc2e784878c93f436afb0cc9"
PHASE11_IMPLEMENTATION = "3952a9c41f6069f8f0f9427cd99779a95e0cd443"
PHASE12_IMPLEMENTATION = "cabb5767157afa2f688ef5718eee9452b7d98177"
PHASE12_RUN = 34750659969
PHASE12_EVIDENCE = 10320127344
PHASE12_EVIDENCE_DIGEST = "sha256:3874ed2cb8b3081912ba8e09b6944b11a5f6d63628683f5a074582f8d84d6770"
PHASE12_RUNTIME = 10321060112
PHASE12_RUNTIME_DIGEST = "sha256:565648d88b14e1ce4b4d8bc319cadee65a1624219fae4be0d2bbf74b00b8754d"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def verify_surface(surface: dict) -> str:
    authority = surface["authority"]
    if authority.get("qualified_phase11_sha") != PHASE11_IMPLEMENTATION or surface.get("operator_enterprise_control_plane_substrate", {}).get("status") != "EARNED":
        raise SystemExit("earned Phase-11 operator authority drift")
    schema = surface.get("schema")
    phase = surface.get("phase")
    if schema == "musitu.axiom.interface.surface-map.v11" and phase == "PHASE_11_OPERATOR_ENTERPRISE_CONTROL_PLANE":
        if authority.get("qualified_phase12_sha") is not None or "developer_platform_marketplace_substrate" in surface:
            raise SystemExit("Phase-12 authority present before exact green implementation seal")
        return "PHASE12_QUALIFICATION_FROM_PHASE11"
    if schema == "musitu.axiom.interface.surface-map.v12" and phase == "PHASE_12_DEVELOPER_PLATFORM_MARKETPLACE":
        subprocess.check_call(["git", "merge-base", "--is-ancestor", PHASE12_IMPLEMENTATION, "HEAD"])
        expected = {
            "qualified_phase12_sha": PHASE12_IMPLEMENTATION,
            "qualified_phase12_run_id": PHASE12_RUN,
            "qualified_phase12_evidence_artifact_id": PHASE12_EVIDENCE,
            "qualified_phase12_evidence_digest": PHASE12_EVIDENCE_DIGEST,
            "qualified_phase12_runtime_security_artifact_id": PHASE12_RUNTIME,
            "qualified_phase12_runtime_security_evidence_digest": PHASE12_RUNTIME_DIGEST,
            "qualified_phase12_artifact_binding_verified": True,
        }
        for key, value in expected.items():
            if authority.get(key) != value:
                raise SystemExit(f"Phase-12 authority mismatch {key}: {authority.get(key)!r} != {value!r}")
        dev = surface.get("developer_platform_marketplace_substrate", {})
        expected_dev = {
            "status": "EARNED",
            "qualification_scope": "BROWSER_LOCAL_DEVELOPER_PLATFORM_MARKETPLACE_CONFORMANCE_AND_ISOLATION",
            "qualified_sha": PHASE12_IMPLEMENTATION,
            "workflow_run_id": PHASE12_RUN,
            "workflow_run_attempt": 9,
            "evidence_artifact_id": PHASE12_EVIDENCE,
            "evidence_artifact_digest": PHASE12_EVIDENCE_DIGEST,
            "runtime_security_evidence_artifact_id": PHASE12_RUNTIME,
            "runtime_security_evidence_artifact_digest": PHASE12_RUNTIME_DIGEST,
            "evidence_metadata_source": "GITHUB_ACTIONS_RUN_ARTIFACTS_API",
            "evidence_metadata_verified": True,
            "seal_validation_scope": "COMPLETE_PHASE12_WORKFLOW_REQUIRED_AT_EXACT_HEAD",
            "persistence": "INDEXEDDB_BROWSER_LOCAL_DEVICE",
            "network_policy": "DENY_ALL_EXTERNAL_NETWORK",
            "platform_mode": "BROWSER_LOCAL_CONFORMANCE_AND_INSTALL_PREVIEW_ONLY",
            "credential_policy": "SYMBOLIC_HANDLE_ONLY_NO_PLAINTEXT_API_KEYS",
            "webhook_policy": "DECLARATION_AND_LOCAL_SIGNED_FIXTURE_ONLY_NO_DELIVERY",
            "mcp_policy": "MCP_2026_LOCAL_CONFORMANCE_ONLY_NO_REMOTE_BINDING",
            "a2a_policy": "A2A_LOCAL_CAPABILITY_CARD_CONFORMANCE_ONLY",
            "package_execution_policy": "STATIC_MANIFEST_VALIDATION_NO_UNTRUSTED_CODE_EXECUTION",
            "marketplace_policy": "EXACT_PACKAGE_DIGEST_AND_LEAST_PRIVILEGE_INSTALL_APPROVAL",
            "production_api_key_issued": False,
            "remote_mcp_binding_claimed": False,
            "outbound_webhook_delivery_claimed": False,
            "untrusted_package_code_executed": False,
            "external_conformance_certification_claimed": False,
        }
        for key, value in expected_dev.items():
            if dev.get(key) != value:
                raise SystemExit(f"Phase-12 developer authority mismatch {key}: {dev.get(key)!r} != {value!r}")
        if "developer" not in surface.get("workspace_routes", []):
            raise SystemExit("Phase-12 developer route missing")
        if surface.get("execution_boundary") != "PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS":
            raise SystemExit("Phase-12 execution boundary drift")
        return "PHASE12_SEALED"
    raise SystemExit(f"unrecognized Phase-12 authority state: schema={schema!r} phase={phase!r}")


def main() -> None:
    for ref, expected in EXPECTED.items():
        actual = git("rev-parse", ref)
        if actual != expected:
            raise SystemExit(f"authority drift {ref}: {actual} != {expected}")
    subprocess.check_call(["git", "merge-base", "--is-ancestor", PHASE11_SEAL, "HEAD"])
    surface = json.loads(pathlib.Path("axiom_interface/surface-map.json").read_text(encoding="utf-8"))
    mode = verify_surface(surface)
    raw = json.loads(pathlib.Path("frontier_review_safe/review_snapshot_manifest.json").read_text(encoding="utf-8"))
    manifest = ReviewSnapshotManifest(schema=raw["schema"], authoritative_frontier_sha=raw["authoritative_frontier_sha"], sealed_main_sha=raw["sealed_main_sha"], public_tool_count=raw["public_tool_count"], required_scopes=tuple(raw["required_scopes"]), forbidden_tools=tuple(raw["forbidden_tools"]), protected_paths=tuple(raw["protected_paths"]), protected_git_object_shas=dict(raw["protected_git_object_shas"]), mcp_url=raw["mcp_url"], auth_url=raw["auth_url"], demo_url=raw["demo_url"])
    guard = ReviewSnapshotGuard(manifest)
    authoritative = {path: git("rev-parse", f"{manifest.authoritative_frontier_sha}:{path}") for path in manifest.protected_git_object_shas}
    current = {path: git("rev-parse", f"HEAD:{path}") for path in manifest.protected_git_object_shas}
    guard.verify_tree(authoritative)
    guard.verify_tree(current)
    changed = [path for path in git("diff", "--name-only", f"{manifest.authoritative_frontier_sha}..HEAD").splitlines() if path]
    guard.verify_no_protected_diff(changed, manifest.protected_paths)
    print(json.dumps({"status": "PASS", "authority_mode": mode, "phase11_seal_ancestor": PHASE11_SEAL, "qualified_phase11_sha": PHASE11_IMPLEMENTATION, "qualified_phase12_sha": surface["authority"].get("qualified_phase12_sha"), "protected_objects_verified": len(current)}, sort_keys=True))
    print("MUSITU_AXIOM_INTERFACE_PHASE12_AUTHORITY_PASS")


if __name__ == "__main__":
    main()
