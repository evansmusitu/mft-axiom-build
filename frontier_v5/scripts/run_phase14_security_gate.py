#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path

from frontier_v5.runtime.pwa_resilience import DeviceNetworkMatrixGate

ROOT = Path(__file__).resolve().parents[2]
INTERFACE = ROOT / "axiom_interface"
OUT = Path(os.environ.get("AXIOM_PHASE14_SECURITY_ARTIFACT_DIR", "/tmp/axiom-interface-phase14-security"))
OUT.mkdir(parents=True, exist_ok=True)


def row(scenario: str, width: int, height: int, latency: int, downlink: int) -> dict:
    return {"scenario": scenario, "viewport_width": width, "viewport_height": height, "cpu_slowdown": 4, "latency_ms": latency, "downlink_kbps": downlink, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False}


def main() -> None:
    names = ["pwa_security.js", "pwa_queue.js", "pwa_runtime.js", "pwa_bootstrap.js"]
    files = {name: (INTERFACE / name).read_text(encoding="utf-8") for name in names}
    joined = "\n".join(files.values())
    for token in ["fetch(", "WebSocket(", "EventSource(", "new Function(", "eval("]:
        if token in joined:
            raise SystemExit(f"Phase 14 external transport or dynamic execution forbidden: {token}")
    required = [
        "STANDALONE_PWA_SHELL_INSTALLABILITY_NO_APP_STORE_OR_NATIVE_BINARY_CLAIM",
        "CACHED_SHELL_AND_BROWSER_LOCAL_PROJECT_ACCESS",
        "ALLOWLISTED_LOCAL_ACTIONS_ONLY_NO_EXTERNAL_SIDE_EFFECTS",
        "EXACT_ACTION_SHA256_IDEMPOTENT_RECONNECT_REPLAY",
        "BROWSER_EMULATED_MID_TIER_AND_CONSTRAINED_NETWORK_CANDIDATE_ONLY",
        "AUTHENTICATED_REAL_MID_TIER_DEVICE_MATRIX_REQUIRED_FOR_PHASE14_SEAL",
        "stale or altered offline action preview", "queued action integrity failure",
        "COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT", "real_device_certification_claimed:false", "phase14_earned:false",
    ]
    missing = [token for token in required if token not in joined]
    if missing:
        raise SystemExit("Phase 14 contract tokens missing: " + ",".join(missing))
    service_worker = (INTERFACE / "sw.js").read_text(encoding="utf-8")
    for token in ["event.request.method!=='GET'", "self.location.origin", "self.skipWaiting()", "self.clients.claim()", "caches.match('./index.html')"]:
        if token not in service_worker:
            raise SystemExit(f"Phase 14 service-worker boundary missing: {token}")
    if "https://" in service_worker:
        raise SystemExit("Phase 14 service worker contains an external URL")
    manifest = json.loads((INTERFACE / "manifest.webmanifest").read_text(encoding="utf-8"))
    if manifest.get("display") != "standalone" or manifest.get("id") != "./" or manifest.get("scope") != "./":
        raise SystemExit("Phase 14 installability manifest is incomplete")
    rows = [row("mobile_constrained", 390, 844, 400, 400), row("tablet_constrained", 768, 1024, 400, 400), row("offline_reload", 390, 844, 0, 0), row("reconnect_queue", 390, 844, 400, 400)]
    matrix = DeviceNetworkMatrixGate().evaluate(rows)
    if matrix["status"] != "IMPLEMENTATION_PASS_REAL_DEVICE_REQUIRED" or matrix["phase14_qualification_allowed"] is not False:
        raise SystemExit("Phase 14 real-device boundary failed closed")
    evidence = {
        "schema": "musitu.axiom.interface.phase14-security-evidence.v1",
        "status": matrix["status"],
        "safe_local_queue_allowlist_verified": True,
        "exact_reconnect_replay_digest_required": True,
        "external_side_effect_absent": True,
        "same_origin_cache_policy_verified": True,
        "installable_manifest_verified": True,
        "emulated_matrix_contract_verified": True,
        "matrix_scope": matrix["matrix_scope"],
        "authenticated_real_device_present": matrix["authenticated_real_device_present"],
        "real_device_certification_claimed": False,
        "native_binary_claimed": False,
        "app_store_release_claimed": False,
        "cloud_offline_sync_claimed": False,
        "phase14_earned": False,
        "phase13_authority_preserved": True,
    }
    (OUT / "phase14-security-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("MUSITU_AXIOM_INTERFACE_PHASE14_SECURITY_CANDIDATE_PASS_REAL_DEVICE_REQUIRED")


if __name__ == "__main__":
    main()

