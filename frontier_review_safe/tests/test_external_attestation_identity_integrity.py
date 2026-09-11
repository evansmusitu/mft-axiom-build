from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationReceipt, ExternalAttestationService


NOW = datetime(2026, 9, 11, 11, 0, tzinfo=timezone.utc).isoformat()
SECRET = b"s" * 32


def issue(**overrides):
    values = {
        "subject_type": "external_run",
        "subject_id": "run-1",
        "subject_hash": "a" * 64,
        "issuer_org": "Independent Lab",
        "verifier_key_id": "lab-key-1",
        "provenance_type": "independent_lab_record",
        "issued_at": NOW,
        "verifier_secret": SECRET,
    }
    values.update(overrides)
    return ExternalAttestationService.issue(**values)


class ExternalAttestationIdentityIntegrityTests(unittest.TestCase):
    def test_truthy_non_string_identity_values_are_rejected_before_signing(self):
        fields = ("subject_type", "subject_id", "issuer_org", "verifier_key_id", "provenance_type")
        for field in fields:
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    issue(**{field: 123})

    def test_identity_whitespace_aliases_and_control_whitespace_are_rejected(self):
        fields = ("subject_type", "subject_id", "issuer_org", "verifier_key_id", "provenance_type")
        bad_values = (" value", "value ", "value  with  gap", "value\talias", "value\nalias", "   ")
        for field in fields:
            for value in bad_values:
                with self.subTest(field=field, value=repr(value)):
                    with self.assertRaises(ValueError):
                        issue(**{field: value})

    def test_single_internal_space_in_organization_name_remains_valid(self):
        receipt = issue(issuer_org="Independent Lab")
        result = ExternalAttestationService.verify(
            receipt,
            expected_subject_type="external_run",
            expected_subject_id="run-1",
            expected_subject_hash="a" * 64,
            verifier_secrets={"lab-key-1": SECRET},
            trusted_issuers={"Independent Lab": frozenset({"lab-key-1"})},
        )
        self.assertEqual(result["status"], "PASS")

    def test_receipt_constructor_rejects_malformed_identity_even_with_valid_shape_elsewhere(self):
        with self.assertRaises(ValueError):
            ExternalAttestationReceipt(
                schema="musitu.axiom.external-attestation.v1",
                subject_type="external_run",
                subject_id=7,
                subject_hash="a" * 64,
                issuer_org="Independent Lab",
                verifier_key_id="lab-key-1",
                provenance_type="independent_lab_record",
                issued_at=NOW,
                receipt_hmac="b" * 64,
            )
        receipt = issue()
        with self.assertRaises(ValueError):
            replace(receipt, issuer_org="Independent  Lab")

    def test_invalid_expected_subject_identity_fails_closed_without_matching(self):
        receipt = issue()
        bad_type = ExternalAttestationService.verify(
            receipt,
            expected_subject_type=123,
            expected_subject_id="run-1",
            expected_subject_hash="a" * 64,
            verifier_secrets={"lab-key-1": SECRET},
            trusted_issuers={"Independent Lab": frozenset({"lab-key-1"})},
        )
        self.assertEqual(bad_type["status"], "FAIL")
        self.assertIn("external_attestation_expected_subject_type_invalid", bad_type["reasons"])
        bad_id = ExternalAttestationService.verify(
            receipt,
            expected_subject_type="external_run",
            expected_subject_id=" run-1",
            expected_subject_hash="a" * 64,
            verifier_secrets={"lab-key-1": SECRET},
            trusted_issuers={"Independent Lab": frozenset({"lab-key-1"})},
        )
        self.assertEqual(bad_id["status"], "FAIL")
        self.assertIn("external_attestation_expected_subject_id_invalid", bad_id["reasons"])

    def test_non_bytes_verifier_secret_is_rejected_cleanly(self):
        with self.assertRaises(ValueError):
            issue(verifier_secret="x" * 32)
        receipt = issue()
        result = ExternalAttestationService.verify(
            receipt,
            expected_subject_type="external_run",
            expected_subject_id="run-1",
            expected_subject_hash="a" * 64,
            verifier_secrets={"lab-key-1": "x" * 32},
            trusted_issuers={"Independent Lab": frozenset({"lab-key-1"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_unavailable", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
