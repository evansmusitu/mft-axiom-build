#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

from frontier_v5.runtime.benchmark_registry import BenchmarkRegistryGate

ROOT = Path(__file__).resolve().parents[2]
INTERFACE = ROOT / "axiom_interface"
OUT = Path(os.environ.get("AXIOM_PHASE13_SECURITY_ARTIFACT_DIR", "/tmp/axiom-interface-phase13-security"))
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    names = ["evidence_security.js", "evidence_content.js", "evidence_store.js", "evidence_ui.js", "evidence_bootstrap.js"]
    files = {name: (INTERFACE / name).read_text(encoding="utf-8") for name in names}
    joined = "\n".join(files.values())
    for token in ["fetch(", "WebSocket(", "EventSource(", "new Function(", "eval("]:
        if token in joined:
            raise SystemExit(f"Phase 13 external transport or dynamic execution forbidden: {token}")
    required = [
        "APPEND_ONLY_SHA256_LINKED_NO_DELETE_OR_OVERWRITE",
        "FAILED_RETIRED_AND_CONTAMINATED_RESULTS_REMAIN_VISIBLE",
        "FAIL_CLOSED_NO_SELF_ATTESTED_EXTERNAL_OR_SUPERIORITY_CLAIMS",
        "AUTHENTICATED_INDEPENDENT_REVIEW_REQUIRED_OUTSIDE_CANDIDATE",
        "candidate-local publication cannot authenticate external attestations",
        "previous_event_sha256", "event_sha256", "entry_sha256", "definition_sha256",
        "phase12-provider-outage-attempts", "phase15-frontier-comparison-not-run",
        "global_superiority_claim_allowed:false", "independent_review_complete:false", "phase13_earned:false",
    ]
    missing = [token for token in required if token not in joined]
    if missing:
        raise SystemExit("Phase 13 contract tokens missing: " + ",".join(missing))
    if ".put(" in files["evidence_store.js"] or ".delete(" in files["evidence_store.js"] or ".clear(" in files["evidence_store.js"]:
        raise SystemExit("Phase 13 evaluation history must be append-only")
    expected_docs = {
        "ACCESSIBILITY.md": "16e87f5927288373e37d900852d1d605781f2fb5b33ea1a32ef27ec0b0e645e3",
        "EVALUATION_METHODOLOGY.md": "279d9b343d1c20e5e1c9671a92a47e2940831346ee8389956a8767d2c39fa484",
        "GOVERNANCE.md": "8aed4a465fc834dbf779edf7896355fcc8d8ca91917be2990830e936fc92eee6",
        "PRIVACY.md": "7bed182ff3b8d42294f9f831c887bfb665992d7052a53b19aa2969037eeaa802",
        "SECURITY.md": "59fcbb857f5c64590eb8c244f68e87cf69f2dee23b33425fbbd8e69d7e9527f5",
    }
    for name, expected in expected_docs.items():
        actual = hashlib.sha256((INTERFACE / "trust" / name).read_bytes()).hexdigest()
        if actual != expected or expected not in files["evidence_content.js"]:
            raise SystemExit(f"Phase 13 trust document digest mismatch: {name}")
    registry = json.loads((ROOT / "frontier_v5/evals/EXTERNAL_BASELINE_REGISTRY.json").read_text(encoding="utf-8"))
    promotion = BenchmarkRegistryGate().evaluate_promotion(
        registry,
        now=datetime(2026, 9, 13, 10, 13, tzinfo=timezone.utc),
        expected_case_set_sha256=None,
        expected_constraints_sha256=None,
    )
    if promotion["status"] != "BLOCKED" or promotion["eligible_reference_count"] != 0 or promotion["level5_eligible"] is not False:
        raise SystemExit("Phase 13 must preserve the unexecuted external-comparison boundary")
    evidence = {
        "schema": "musitu.axiom.interface.phase13-security-evidence.v1",
        "status": "IMPLEMENTATION_PASS_AWAITING_INDEPENDENT_REVIEW",
        "append_only_history_verified": True,
        "failed_retired_contaminated_visibility_required": True,
        "trust_document_digests_verified": True,
        "self_attested_external_evidence_rejected": True,
        "external_baseline_promotion_status": promotion["status"],
        "eligible_external_reference_count": promotion["eligible_reference_count"],
        "independent_review_complete": False,
        "phase13_earned": False,
        "global_superiority_claim_allowed": False,
        "production_security_certified": False,
        "wcag_conformance_certified": False,
        "public_deployment_claimed": False,
        "phase12_authority_preserved": True,
    }
    (OUT / "phase13-security-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("MUSITU_AXIOM_INTERFACE_PHASE13_SECURITY_CANDIDATE_PASS")


if __name__ == "__main__":
    main()

