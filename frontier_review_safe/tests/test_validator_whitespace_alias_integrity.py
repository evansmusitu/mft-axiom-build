from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, IndependentValidationRecord


NOW = datetime(2026, 9, 11, 13, 45, tzinfo=timezone.utc).isoformat()
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
SECRET = b"w" * 32
SECRETS = {"witness-key": SECRET}
TRUST = {"Independent Witness": frozenset({"witness-key"})}
LEVEL5 = {
    "status": "PASS",
    "attestation_verified": True,
    "baseline_registry_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
    "provider_orgs": ["Open AI", "Anthropic", "Google"],
}


def validation(validator_org: str) -> IndependentValidationRecord:
    return IndependentValidationRecord(
        validator_org=validator_org,
        validated_at=NOW,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        reproduction_hash="9" * 64,
        passed=True,
        provenance_type="independent_lab_record",
    )


def receipt(record: IndependentValidationRecord):
    return ExternalAttestationService.issue(
        subject_type="independent_validation",
        subject_id=record.fingerprint,
        subject_hash=record.fingerprint,
        issuer_org="Independent Witness",
        verifier_key_id="witness-key",
        provenance_type="independent_lab_record",
        issued_at=NOW,
        verifier_secret=SECRET,
    )


class ValidatorWhitespaceAliasIntegrityTests(unittest.TestCase):
    def assert_provider_alias_rejected(self, validator_org: str) -> None:
        record = validation(validator_org)
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            (record,),
            receipts=(receipt(record),),
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("validator_overlaps_level5_provider", result["reasons"])
        self.assertIn("no_attested_independent_end_to_end_reproduction", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_tab_alias_cannot_masquerade_as_independent_validator(self):
        self.assert_provider_alias_rejected("Open\tAI")

    def test_repeated_space_alias_cannot_masquerade_as_independent_validator(self):
        self.assert_provider_alias_rejected("Open  AI")

    def test_newline_alias_cannot_masquerade_as_independent_validator(self):
        self.assert_provider_alias_rejected("Open\nAI")


if __name__ == "__main__":
    unittest.main(verbosity=2)
