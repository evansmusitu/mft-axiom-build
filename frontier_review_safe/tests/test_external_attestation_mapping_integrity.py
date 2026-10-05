from __future__ import annotations

from types import MappingProxyType
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService


SECRET = b"m" * 32
ISSUER = "Independent Evaluator"
KEY_ID = "mapping-key"
SUBJECT_HASH = "a" * 64
ISSUED_AT = "2026-09-11T12:15:00+00:00"


def receipt():
    return ExternalAttestationService.issue(
        subject_type="external_run",
        subject_id="run-1",
        subject_hash=SUBJECT_HASH,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type="provider_api_receipt",
        issued_at=ISSUED_AT,
        verifier_secret=SECRET,
    )


def verify(*, secrets, trust):
    return ExternalAttestationService.verify(
        receipt(),
        expected_subject_type="external_run",
        expected_subject_id="run-1",
        expected_subject_hash=SUBJECT_HASH,
        verifier_secrets=secrets,
        trusted_issuers=trust,
    )


class ExternalAttestationMappingIntegrityTests(unittest.TestCase):
    def test_non_mapping_trust_root_fails_closed_instead_of_raising(self):
        result = verify(
            secrets={KEY_ID: SECRET},
            trust=[(ISSUER, frozenset({KEY_ID}))],
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])
        self.assertIn("untrusted_external_issuer_or_key", result["reasons"])

    def test_non_mapping_secret_store_fails_closed_instead_of_raising(self):
        result = verify(
            secrets=[(KEY_ID, SECRET)],
            trust={ISSUER: frozenset({KEY_ID})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])
        self.assertIn("external_verifier_secret_unavailable", result["reasons"])

    def test_none_for_required_runtime_stores_fails_closed(self):
        result = verify(secrets=None, trust=None)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])

    def test_string_containers_cannot_masquerade_as_runtime_mappings(self):
        result = verify(secrets="mapping-key", trust="Independent Evaluator")
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])

    def test_read_only_mapping_implementations_remain_valid(self):
        result = verify(
            secrets=MappingProxyType({KEY_ID: SECRET}),
            trust=MappingProxyType({ISSUER: frozenset({KEY_ID})}),
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["reasons"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
