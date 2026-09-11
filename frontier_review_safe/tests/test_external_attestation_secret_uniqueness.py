from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService


NOW = datetime(2026, 9, 11, 12, 40, tzinfo=timezone.utc).isoformat()
SHARED_SECRET = b"s" * 32
LAB_SECRET = b"l" * 32
PROVIDER_SECRET = b"p" * 32


def receipt(*, issuer_org: str, key_id: str, secret: bytes):
    return ExternalAttestationService.issue(
        subject_type="external_run",
        subject_id="run-1",
        subject_hash="a" * 64,
        issuer_org=issuer_org,
        verifier_key_id=key_id,
        provenance_type="provider_api_receipt",
        issued_at=NOW,
        verifier_secret=secret,
    )


def verify(value, *, secrets, trust):
    return ExternalAttestationService.verify(
        value,
        expected_subject_type="external_run",
        expected_subject_id="run-1",
        expected_subject_hash="a" * 64,
        verifier_secrets=secrets,
        trusted_issuers=trust,
    )


class ExternalAttestationSecretUniquenessTests(unittest.TestCase):
    def test_same_secret_under_distinct_key_ids_cannot_authorize_distinct_issuers(self):
        value = receipt(
            issuer_org="Independent Lab",
            key_id="lab-key",
            secret=SHARED_SECRET,
        )
        result = verify(
            value,
            secrets={
                "lab-key": SHARED_SECRET,
                "provider-key": SHARED_SECRET,
            },
            trust={
                "Independent Lab": frozenset({"lab-key"}),
                "OpenAI": frozenset({"provider-key"}),
            },
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn(
            "external_attestation_secret_reused_across_issuers",
            result["reasons"],
        )

    def test_same_secret_for_two_key_ids_of_same_issuer_is_not_cross_org_reuse(self):
        value = receipt(
            issuer_org="Independent Lab",
            key_id="lab-key-a",
            secret=SHARED_SECRET,
        )
        result = verify(
            value,
            secrets={
                "lab-key-a": SHARED_SECRET,
                "lab-key-b": SHARED_SECRET,
            },
            trust={
                "Independent Lab": frozenset({"lab-key-a", "lab-key-b"}),
            },
        )
        self.assertEqual(result["status"], "PASS")

    def test_case_aliases_of_same_normalized_issuer_do_not_false_flag_secret_reuse(self):
        value = receipt(
            issuer_org="Independent Lab",
            key_id="lab-key-a",
            secret=SHARED_SECRET,
        )
        result = verify(
            value,
            secrets={
                "lab-key-a": SHARED_SECRET,
                "lab-key-b": SHARED_SECRET,
            },
            trust={
                "Independent Lab": frozenset({"lab-key-a"}),
                "independent lab": frozenset({"lab-key-b"}),
            },
        )
        self.assertEqual(result["status"], "PASS")

    def test_distinct_secret_material_for_distinct_issuers_remains_valid(self):
        value = receipt(
            issuer_org="Independent Lab",
            key_id="lab-key",
            secret=LAB_SECRET,
        )
        result = verify(
            value,
            secrets={
                "lab-key": LAB_SECRET,
                "provider-key": PROVIDER_SECRET,
            },
            trust={
                "Independent Lab": frozenset({"lab-key"}),
                "OpenAI": frozenset({"provider-key"}),
            },
        )
        self.assertEqual(result["status"], "PASS")

    def test_bytearray_alias_of_same_secret_is_detected_without_exposing_secret(self):
        value = receipt(
            issuer_org="Independent Evaluator",
            key_id="evaluator-key",
            secret=SHARED_SECRET,
        )
        result = verify(
            value,
            secrets={
                "evaluator-key": SHARED_SECRET,
                "google-key": bytearray(SHARED_SECRET),
            },
            trust={
                "Independent Evaluator": frozenset({"evaluator-key"}),
                "Google": frozenset({"google-key"}),
            },
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn(
            "external_attestation_secret_reused_across_issuers",
            result["reasons"],
        )
        self.assertNotIn(SHARED_SECRET.hex(), repr(result))


if __name__ == "__main__":
    unittest.main(verbosity=2)
