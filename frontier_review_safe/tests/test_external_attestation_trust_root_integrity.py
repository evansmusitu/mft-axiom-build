from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService


NOW = datetime(2026, 9, 11, 11, 5, tzinfo=timezone.utc).isoformat()
SECRET = b"t" * 32
KEY_ID = "lab-key-1"
ISSUER = "Independent Lab"


def receipt():
    return ExternalAttestationService.issue(
        subject_type="external_run",
        subject_id="run-1",
        subject_hash="a" * 64,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type="provider_api_receipt",
        issued_at=NOW,
        verifier_secret=SECRET,
    )


def verify(trusted_issuers):
    return ExternalAttestationService.verify(
        receipt(),
        expected_subject_type="external_run",
        expected_subject_id="run-1",
        expected_subject_hash="a" * 64,
        verifier_secrets={KEY_ID: SECRET},
        trusted_issuers=trusted_issuers,
    )


class ExternalAttestationTrustRootIntegrityTests(unittest.TestCase):
    def test_plain_string_cannot_masquerade_as_trusted_key_set(self):
        result = verify({ISSUER: KEY_ID})
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_mutable_set_list_or_tuple_cannot_masquerade_as_trusted_key_set(self):
        for keys in ({KEY_ID}, [KEY_ID], (KEY_ID,)):
            with self.subTest(type=type(keys).__name__):
                result = verify({ISSUER: keys})
                self.assertEqual(result["status"], "FAIL")
                self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_frozenset_with_noncanonical_or_non_string_key_is_rejected(self):
        for keys in (
            frozenset({" lab-key-1"}),
            frozenset({"lab-key-1 "}),
            frozenset({"lab  key"}),
            frozenset({123}),
        ):
            with self.subTest(keys=repr(keys)):
                result = verify({ISSUER: keys})
                self.assertEqual(result["status"], "FAIL")
                self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_missing_or_empty_trust_entry_fails_as_untrusted_not_as_valid(self):
        missing = verify({})
        self.assertEqual(missing["status"], "FAIL")
        self.assertIn("untrusted_external_issuer_or_key", missing["reasons"])
        empty = verify({ISSUER: frozenset()})
        self.assertEqual(empty["status"], "FAIL")
        self.assertIn("untrusted_external_issuer_or_key", empty["reasons"])
        self.assertNotIn("external_attestation_trust_root_invalid", empty["reasons"])

    def test_exact_immutable_canonical_trust_root_remains_valid(self):
        result = verify({ISSUER: frozenset({KEY_ID})})
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["reasons"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
