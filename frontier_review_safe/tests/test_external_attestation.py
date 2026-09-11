from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService


NOW = datetime(2026, 9, 11, 5, 15, tzinfo=timezone.utc).isoformat()
SECRET = b"z" * 32
TRUST = {"Independent Lab": frozenset({"lab-key-1"})}
SECRETS = {"lab-key-1": SECRET}


class ExternalAttestationTests(unittest.TestCase):
    def test_receipt_authenticates_exact_subject_and_trust_root(self):
        receipt = ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id="run-1",
            subject_hash="a" * 64,
            issuer_org="Independent Lab",
            verifier_key_id="lab-key-1",
            provenance_type="independent_lab_record",
            issued_at=NOW,
            verifier_secret=SECRET,
        )
        ok = ExternalAttestationService.verify(
            receipt,
            expected_subject_type="external_run",
            expected_subject_id="run-1",
            expected_subject_hash="a" * 64,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(ok["status"], "PASS")
        self.assertEqual(len(ok["receipt_sha256"]), 64)

        tampered = replace(receipt, subject_hash="b" * 64)
        bad = ExternalAttestationService.verify(
            tampered,
            expected_subject_type="external_run",
            expected_subject_id="run-1",
            expected_subject_hash="b" * 64,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(bad["status"], "FAIL")
        self.assertIn("external_attestation_authentication_failed", bad["reasons"])

    def test_untrusted_key_and_missing_secret_fail_closed(self):
        receipt = ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id="run-2",
            subject_hash="c" * 64,
            issuer_org="Independent Lab",
            verifier_key_id="lab-key-1",
            provenance_type="provider_export",
            issued_at=NOW,
            verifier_secret=SECRET,
        )
        bad = ExternalAttestationService.verify(
            receipt,
            expected_subject_type="external_run",
            expected_subject_id="run-2",
            expected_subject_hash="c" * 64,
            verifier_secrets={},
            trusted_issuers={"Independent Lab": frozenset({"different-key"})},
        )
        self.assertEqual(bad["status"], "FAIL")
        self.assertIn("external_verifier_secret_unavailable", bad["reasons"])
        self.assertIn("untrusted_external_issuer_or_key", bad["reasons"])

    def test_malformed_digest_strings_are_rejected_not_accepted_by_length(self):
        with self.assertRaises(ValueError):
            ExternalAttestationService.issue(
                subject_type="external_run",
                subject_id="run-malformed",
                subject_hash="z" * 64,
                issuer_org="Independent Lab",
                verifier_key_id="lab-key-1",
                provenance_type="provider_export",
                issued_at=NOW,
                verifier_secret=SECRET,
            )

        receipt = ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id="run-valid",
            subject_hash="d" * 64,
            issuer_org="Independent Lab",
            verifier_key_id="lab-key-1",
            provenance_type="provider_export",
            issued_at=NOW,
            verifier_secret=SECRET,
        )
        with self.assertRaises(ValueError):
            replace(receipt, receipt_hmac="q" * 64)

    def test_invalid_expected_subject_digest_fails_closed(self):
        receipt = ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id="run-3",
            subject_hash="e" * 64,
            issuer_org="Independent Lab",
            verifier_key_id="lab-key-1",
            provenance_type="provider_export",
            issued_at=NOW,
            verifier_secret=SECRET,
        )
        bad = ExternalAttestationService.verify(
            receipt,
            expected_subject_type="external_run",
            expected_subject_id="run-3",
            expected_subject_hash="z" * 64,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(bad["status"], "FAIL")
        self.assertIn("external_attestation_expected_subject_hash_invalid", bad["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
