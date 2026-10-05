#!/usr/bin/env python3
from __future__ import annotations

from copy import deepcopy

from frontier_v5.runtime.evidence_observatory import (
    ClaimBoundaryViolation,
    EvidenceObservatoryError,
    EvidenceObservatoryLedger,
    ImmutableHistoryViolation,
)


HEX_A = "a" * 64
HEX_B = "b" * 64
HEX_C = "c" * 64


def expect(error, fn, contains: str) -> None:
    try:
        fn()
    except error as exc:
        assert contains in str(exc), (contains, str(exc))
    else:
        raise AssertionError(f"expected {error.__name__}")


def new_ledger() -> EvidenceObservatoryLedger:
    ledger = EvidenceObservatoryLedger(ledger_id="axiom-public-evidence-v1")
    ledger.register_definition(
        definition_id="interface-phase-qualification",
        name="Interface phase qualification envelope",
        methodology="Exact-head protected regression, runtime security and browser evidence envelope.",
        metrics=["runtime_gate", "browser_gate"],
        source_sha256=HEX_A,
    )
    return ledger


def publish_pass(ledger: EvidenceObservatoryLedger, evaluation_id: str = "phase11") -> dict:
    return ledger.publish_evaluation(
        evaluation_id=evaluation_id,
        definition_id="interface-phase-qualification",
        candidate_version="3952a9c41f6069f8f0f9427cd99779a95e0cd443",
        baseline_versions=[{
            "provider": "MUSITU",
            "system": "Axiom Interface Phase 10",
            "version": "78d76060138a00e48839edb1d5454f1a197225b3",
            "evidence_status": "INHERITED_EARNED_ANCESTOR",
            "results_sha256": None,
            "external_origin_authenticated": False,
        }],
        sealed_test_identities=[HEX_A],
        evaluation_date="2026-09-13T09:00:00Z",
        environment={"runner": "ubuntu-24.04", "browser": "chromium"},
        failures=[],
        scores={"runtime_gate": 1, "browser_gate": 1},
        confidence_intervals={},
        external_attestations=[],
        status="PASS",
        evidence_artifact_digests=[HEX_B, HEX_C],
    )


def main() -> None:
    ledger = new_ledger()
    row = publish_pass(ledger)
    assert len(row["entry_sha256"]) == 64
    assert row["external_attestations"] == []

    local = ledger.claim_authorization(evaluation_id="phase11", claim_class="LOCAL_FUNCTIONAL_QUALIFICATION")
    assert local["authorized"] is True
    assert local["status"] == "AUTHORIZED_LOCAL_SCOPE"

    for claim_class in ["EXTERNAL_COMPARATIVE", "GLOBAL_SUPERIORITY", "PRODUCTION_SECURITY_CERTIFICATION", "WCAG_CONFORMANCE_CERTIFICATION"]:
        blocked = ledger.claim_authorization(evaluation_id="phase11", claim_class=claim_class)
        assert blocked["authorized"] is False
        assert blocked["independent_review_complete"] is False
        assert blocked["global_superiority_claim_allowed"] is False

    expect(ImmutableHistoryViolation, lambda: publish_pass(ledger), "already exists")
    original = deepcopy(ledger.evaluations["phase11"])
    retirement = ledger.append_lifecycle_status(evaluation_id="phase11", status="RETIRED", reason="Superseded without deletion")
    assert retirement["payload"]["original_entry_sha256"] == original["entry_sha256"]
    assert ledger.evaluations["phase11"] == original
    assert ledger.claim_authorization(evaluation_id="phase11", claim_class="LOCAL_FUNCTIONAL_QUALIFICATION")["authorized"] is False

    failed = ledger.publish_evaluation(
        evaluation_id="phase12-provider-outage",
        definition_id="interface-phase-qualification",
        candidate_version="cabb5767157afa2f688ef5718eee9452b7d98177",
        baseline_versions=[{
            "provider": "External Provider",
            "system": "Current strong system",
            "version": "NOT_CAPTURED",
            "evidence_status": "NOT_RUN",
            "results_sha256": None,
            "external_origin_authenticated": False,
        }],
        sealed_test_identities=[HEX_C],
        evaluation_date="2026-09-13T10:00:00Z",
        environment={"provider": "GitHub Actions", "runner_allocated": False},
        failures=[{"failure_id": "run-34750659969-attempt-3", "summary": "No runner allocation; zero steps and no logs", "status": "PROVIDER_OUTAGE"}],
        scores={},
        confidence_intervals={},
        external_attestations=[],
        status="FAIL",
        evidence_artifact_digests=[],
    )
    assert failed["failures"][0]["status"] == "PROVIDER_OUTAGE"

    snapshot = ledger.public_snapshot()
    assert snapshot["integrity"]["status"] == "PASS"
    assert snapshot["failed_evaluations_visible"] is True
    assert snapshot["retired_and_contaminated_history_visible"] is True
    assert any(item["status"] == "FAIL" for item in snapshot["evaluations"])

    packet = ledger.independent_review_packet(trust_documents={
        "security": "Fail-closed architecture and incident response.",
        "privacy": "Browser-local storage and explicit retention boundaries.",
        "accessibility": "WCAG 2.2 AA target; independent audit not complete.",
        "methodology": "Exact-head tests, retained failures, and narrow claims.",
    })
    assert packet["review_status"] == "AWAITING_AUTHENTICATED_INDEPENDENT_REVIEW"
    assert packet["phase13_earned"] is False
    assert packet["independent_review_complete"] is False

    expect(
        ClaimBoundaryViolation,
        lambda: ledger.publish_evaluation(
            evaluation_id="forged-external",
            definition_id="interface-phase-qualification",
            candidate_version="candidate",
            baseline_versions=[{
                "provider": "Vendor",
                "system": "System",
                "version": "v1",
                "evidence_status": "AUTHENTICATED_EXTERNAL_RUN",
                "results_sha256": HEX_A,
                "external_origin_authenticated": False,
            }],
            sealed_test_identities=[HEX_A],
            evaluation_date="2026-09-13T10:00:00Z",
            environment={"runner": "fixture"},
            failures=[],
            scores={},
            confidence_intervals={},
            external_attestations=[],
            status="NOT_RUN",
            evidence_artifact_digests=[],
        ),
        "authenticated external baseline",
    )
    expect(
        ClaimBoundaryViolation,
        lambda: ledger.publish_evaluation(
            evaluation_id="self-attestation",
            definition_id="interface-phase-qualification",
            candidate_version="candidate",
            baseline_versions=[{
                "provider": "Vendor",
                "system": "System",
                "version": "NOT_CAPTURED",
                "evidence_status": "NOT_RUN",
                "results_sha256": None,
                "external_origin_authenticated": False,
            }],
            sealed_test_identities=[HEX_A],
            evaluation_date="2026-09-13T10:00:00Z",
            environment={"runner": "fixture"},
            failures=[],
            scores={},
            confidence_intervals={},
            external_attestations=[{"signed": True}],
            status="NOT_RUN",
            evidence_artifact_digests=[],
        ),
        "cannot authenticate external attestations",
    )

    tampered = deepcopy(ledger.evaluations["phase12-provider-outage"])
    ledger.evaluations["phase12-provider-outage"]["failures"] = []
    assert ledger.verify()["status"] == "FAIL"
    ledger.evaluations["phase12-provider-outage"] = tampered
    assert ledger.verify()["status"] == "PASS"

    expect(EvidenceObservatoryError, lambda: ledger.append_lifecycle_status(evaluation_id="phase11", status="PASS", reason="overwrite"), "only retired")
    print("MUSITU_AXIOM_INTERFACE_PHASE13_EVIDENCE_OBSERVATORY_PASS")


if __name__ == "__main__":
    main()
