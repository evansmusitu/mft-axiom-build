from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, IndependentValidationRecord


NOW = datetime(2026, 9, 11, 10, 55, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
LEVEL5 = {
    "status": "PASS",
    "attestation_verified": True,
    "baseline_registry_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
    "provider_orgs": ["openai", "anthropic", "google"],
}


def validation(name="IndependentLab"):
    return IndependentValidationRecord(
        validator_org=name,
        validated_at=NOW_S,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        reproduction_hash="9" * 64,
        passed=True,
        provenance_type="independent_lab_record",
    )


def issue(record, *, issuer_org: str, key_id: str, secret: bytes):
    return ExternalAttestationService.issue(
        subject_type="independent_validation",
        subject_id=record.fingerprint,
        subject_hash=record.fingerprint,
        issuer_org=issuer_org,
        verifier_key_id=key_id,
        provenance_type=record.provenance_type,
        issued_at=NOW_S,
        verifier_secret=secret,
    )


class Level6AttestationIssuerIndependenceTests(unittest.TestCase):
    def test_level5_provider_cannot_attest_purported_independent_lab_record(self):
        record = validation()
        secret = b"o" * 32
        receipt = issue(record, issuer_org="OpenAI", key_id="openai-key", secret=secret)
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt],
            verifier_secrets={"openai-key": secret},
            trusted_issuers={"OpenAI": frozenset({"openai-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_attester_overlaps_level5_provider", result["reasons"])
        self.assertIn("no_attested_independent_end_to_end_reproduction", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_provider_issuer_case_and_whitespace_alias_still_fails(self):
        record = validation()
        secret = b"a" * 32
        receipt = issue(record, issuer_org=" ANTHROPIC ", key_id="anthropic-key", secret=secret)
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt],
            verifier_secrets={"anthropic-key": secret},
            trusted_issuers={" ANTHROPIC ": frozenset({"anthropic-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_attester_overlaps_level5_provider", result["reasons"])

    def test_independent_attestation_issuer_remains_valid(self):
        record = validation()
        secret = b"l" * 32
        receipt = issue(record, issuer_org="ExternalEvaluator", key_id="external-key", secret=secret)
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt],
            verifier_secrets={"external-key": secret},
            trusted_issuers={"ExternalEvaluator": frozenset({"external-key"})},
        )
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["attestation_verified"])
        self.assertEqual(result["validation_count"], 1)
        self.assertEqual(result["validators"], ["IndependentLab"])

    def test_provider_attested_extra_record_does_not_poison_genuine_independent_validation(self):
        bad = validation("BadButNamedIndependentLab")
        good = IndependentValidationRecord(
            validator_org="IndependentLab",
            validated_at=NOW_S,
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            reproduction_hash="8" * 64,
            passed=True,
            provenance_type="independent_lab_record",
        )
        provider_secret = b"p" * 32
        external_secret = b"e" * 32
        receipts = [
            issue(bad, issuer_org="Google", key_id="google-key", secret=provider_secret),
            issue(good, issuer_org="ExternalEvaluator", key_id="external-key", secret=external_secret),
        ]
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [bad, good],
            receipts=receipts,
            verifier_secrets={"google-key": provider_secret, "external-key": external_secret},
            trusted_issuers={
                "Google": frozenset({"google-key"}),
                "ExternalEvaluator": frozenset({"external-key"}),
            },
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["validation_count"], 1)
        self.assertEqual(result["validators"], ["IndependentLab"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
