from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, IndependentValidationRecord


NOW = datetime(2026, 9, 11, 10, 45, tzinfo=timezone.utc).isoformat()
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
SECRET = b"i" * 32
SECRETS = {"independence-key": SECRET}
TRUST = {"independence-verifier": frozenset({"independence-key"})}
LEVEL5 = {
    "status": "PASS",
    "attestation_verified": True,
    "baseline_registry_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
    "provider_orgs": ["OpenAI", "Anthropic", "Google"],
}


def validation(validator_org: str, provenance_type: str) -> IndependentValidationRecord:
    return IndependentValidationRecord(
        validator_org=validator_org,
        validated_at=NOW,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        reproduction_hash="9" * 64,
        passed=True,
        provenance_type=provenance_type,
    )


def receipt(record: IndependentValidationRecord):
    return ExternalAttestationService.issue(
        subject_type="independent_validation",
        subject_id=record.fingerprint,
        subject_hash=record.fingerprint,
        issuer_org="independence-verifier",
        verifier_key_id="independence-key",
        provenance_type=record.provenance_type,
        issued_at=NOW,
        verifier_secret=SECRET,
    )


class ExternalIndependenceTests(unittest.TestCase):
    def test_provider_export_cannot_masquerade_as_independent_reproduction(self):
        record = validation("Independent Lab", "provider_export")
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt(record)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_provenance_required", result["reasons"])
        self.assertIn("no_attested_independent_end_to_end_reproduction", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_provider_api_receipt_cannot_masquerade_as_independent_reproduction(self):
        record = validation("Independent Lab", "provider_api_receipt")
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt(record)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_provenance_required", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_level5_provider_cannot_validate_itself_even_with_valid_attestation(self):
        record = validation(" openAI ", "independent_lab_record")
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt(record)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("validator_overlaps_level5_provider", result["reasons"])
        self.assertIn("no_attested_independent_end_to_end_reproduction", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_independent_lab_outside_level5_provider_set_still_passes_mechanics(self):
        record = validation("Independent Reproduction Lab", "independent_lab_record")
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt(record)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["attestation_verified"])
        self.assertEqual(result["validation_count"], 1)
        self.assertEqual(result["validators"], ["Independent Reproduction Lab"])

    def test_invalid_extra_records_do_not_poison_a_genuine_independent_validation(self):
        valid = validation("Independent Reproduction Lab", "independent_lab_record")
        provider_export = validation("Other Lab", "provider_export")
        overlap = validation("Google", "independent_lab_record")
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [provider_export, overlap, valid],
            receipts=[receipt(provider_export), receipt(overlap), receipt(valid)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["validation_count"], 1)
        self.assertEqual(result["validators"], ["Independent Reproduction Lab"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
