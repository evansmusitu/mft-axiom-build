from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, LongitudinalRefreshRecord
from frontier_review_safe.tests.level7_semantic_fixtures import level7_artifact_fields


NOW = datetime(2026, 9, 12, 17, 30, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
ANCHOR = "9" * 64
BASELINE_B = "5" * 64
BASELINE_C = "6" * 64
SECRET = b"g" * 32
KEY_ID = "governance-chain-key"
ISSUER = "Independent Governance Chain Evaluator"
LEVEL6 = {
    "status": "PASS",
    "attestation_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
    "baseline_registry_hash": ANCHOR,
    "level5_provider_orgs": ["OpenAI", "Anthropic", "Google"],
    "latest_validation_at": NOW.isoformat(),
}


def refresh(
    refresh_id: str,
    day: int,
    *,
    before_hash: str,
    after_hash: str,
    decision: str | None = None,
) -> LongitudinalRefreshRecord:
    executed_at = (NOW + timedelta(days=day)).isoformat()
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=after_hash,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org="Independent Longitudinal Lab",
        **level7_artifact_fields(
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            baseline_registry_hash=after_hash,
            generated_at=executed_at,
            governance_before_hash=before_hash,
            governance_decision=decision,
        ),
    )


def receipt(record: LongitudinalRefreshRecord):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type=record.provenance_type,
        issued_at=record.executed_at,
        verifier_secret=SECRET,
    )


def evaluate(records):
    return ExternalEvidenceGate.level7(
        LEVEL6,
        records,
        receipts=[receipt(record) for record in records],
        verifier_secrets={KEY_ID: SECRET},
        trusted_issuers={ISSUER: frozenset({KEY_ID})},
    )


def good_chain():
    return [
        refresh("r1", 0, before_hash=ANCHOR, after_hash=ANCHOR),
        refresh("r2", 30, before_hash=ANCHOR, after_hash=BASELINE_B),
        refresh(
            "r3",
            60,
            before_hash=BASELINE_B,
            after_hash=ANCHOR,
            decision="rollback",
        ),
    ]


class Level7GovernanceChainTests(unittest.TestCase):
    def test_verified_anchor_and_continuous_governance_chain_pass(self):
        result = evaluate(good_chain())
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["governance_chain_verified"])
        self.assertEqual(result["governance_chain_refresh_count"], 3)
        self.assertEqual(result["governance_chain_refresh_ids"], ["r1", "r2", "r3"])
        self.assertEqual(len(result["governance_chain_sha256"]), 64)

    def test_individually_valid_but_discontinuous_transitions_cannot_pass(self):
        records = [
            refresh("r1", 0, before_hash=ANCHOR, after_hash=ANCHOR),
            refresh("r2", 30, before_hash="4" * 64, after_hash=BASELINE_B),
            refresh(
                "r3",
                60,
                before_hash=BASELINE_B,
                after_hash=ANCHOR,
                decision="rollback",
            ),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["governance_chain_verified"])
        self.assertIn("longitudinal_governance_chain_discontinuity", result["reasons"])
        self.assertLess(result["governance_chain_refresh_count"], 3)

    def test_three_semantic_refreshes_without_any_level5_anchor_start_cannot_pass(self):
        records = [
            refresh("r1", 0, before_hash="4" * 64, after_hash=ANCHOR),
            refresh("r2", 30, before_hash="6" * 64, after_hash=BASELINE_B),
            refresh("r3", 60, before_hash="7" * 64, after_hash=ANCHOR),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_governance_chain_anchor_mismatch", result["reasons"])
        self.assertEqual(result["governance_chain_refresh_count"], 0)

    def test_disconnected_extra_does_not_poison_complete_anchored_chain(self):
        records = [
            *good_chain(),
            refresh("disconnected-extra", 90, before_hash="8" * 64, after_hash=BASELINE_B),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["governance_chain_verified"])
        self.assertEqual(result["governance_chain_refresh_ids"], ["r1", "r2", "r3"])
        self.assertEqual(result["refresh_count"], 4)

    def test_replace_cannot_cycle_back_to_previously_seen_baseline(self):
        records = [
            refresh("r1", 0, before_hash=ANCHOR, after_hash=ANCHOR),
            refresh("r2", 30, before_hash=ANCHOR, after_hash=BASELINE_B),
            refresh("r3", 60, before_hash=BASELINE_B, after_hash=ANCHOR, decision="replace"),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["governance_chain_verified"])
        self.assertEqual(result["governance_chain_refresh_count"], 2)
        self.assertIn("longitudinal_governance_chain_discontinuity", result["reasons"])

    def test_rollback_must_target_a_baseline_observed_on_same_chain(self):
        records = [
            refresh("r1", 0, before_hash=ANCHOR, after_hash=ANCHOR),
            refresh("r2", 30, before_hash=ANCHOR, after_hash=BASELINE_B),
            refresh("r3", 60, before_hash=BASELINE_B, after_hash=BASELINE_C, decision="rollback"),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertFalse(result["governance_chain_verified"])
        self.assertEqual(result["governance_chain_refresh_count"], 2)
        self.assertIn("longitudinal_governance_chain_discontinuity", result["reasons"])

    def test_terminal_rollback_cannot_be_reused_to_inflate_refresh_depth(self):
        records = [
            *good_chain(),
            refresh("r4", 90, before_hash=ANCHOR, after_hash=BASELINE_C, decision="replace"),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["governance_chain_verified"])
        self.assertEqual(result["refresh_count"], 4)
        self.assertEqual(result["governance_chain_refresh_count"], 3)
        self.assertEqual(result["governance_chain_refresh_ids"], ["r1", "r2", "r3"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
