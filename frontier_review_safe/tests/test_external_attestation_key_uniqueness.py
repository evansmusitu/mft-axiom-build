from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService


NOW = datetime(2026, 9, 11, 11, 50, tzinfo=timezone.utc).isoformat()
SECRET = b"k" * 32


def receipt(*, issuer_org: str, key_id: str = "shared-key"):
    return ExternalAttestationService.issue(
        subject_type="external_run",
        subject_id="run-1",
        subject_hash="a" * 64,
        issuer_org=issuer_org,
        verifier_key_id=key_id,
        provenance_type="provider_api_receipt",
        issued_at=NOW,
        verifier_secret=SECRET,
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


class ExternalAttestationKeyUniquenessTests(unittest.TestCase):
    def test_same_verifier_key_cannot_authorize_two_distinct_issuer_orgs(self):
        value = receipt(issuer_org="Independent Lab")
        result = verify(
            value,
            secrets={"shared-key": SECRET},
            trust={
                "Independent Lab": frozenset({"shared-key"}),
                "OpenAI": frozenset({"shared-key"}),
            },
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_key_reused_across_issuers", result["reasons"])

    def test_shared_key_cannot_masquerade_provider_as_independent_evaluator(self):
        value = receipt(issuer_org="Independent Evaluator")
        result = verify(
            value,
            secrets={"shared-key": SECRET},
            trust={
                "OpenAI": frozenset({"shared-key"}),
                "Independent Evaluator": frozenset({"shared-key"}),
            },
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_key_reused_across_issuers", result["reasons"])

    def test_distinct_key_ids_for_distinct_issuers_remain_valid(self):
        value = receipt(issuer_org="Independent Lab", key_id="lab-key")
        result = verify(
            value,
            secrets={"lab-key": SECRET, "provider-key": b"p" * 32},
            trust={
                "Independent Lab": frozenset({"lab-key"}),
                "OpenAI": frozenset({"provider-key"}),
            },
        )
        self.assertEqual(result["status"], "PASS")

    def test_case_aliases_of_same_issuer_do_not_create_false_cross_org_ambiguity(self):
        value = receipt(issuer_org="Independent Lab")
        result = verify(
            value,
            secrets={"shared-key": SECRET},
            trust={
                "Independent Lab": frozenset({"shared-key"}),
                "independent lab": frozenset({"shared-key"}),
            },
        )
        self.assertEqual(result["status"], "PASS")

    def test_ambiguity_is_detected_even_when_receipt_itself_is_otherwise_authentic(self):
        value = receipt(issuer_org="Independent Lab")
        result = verify(
            value,
            secrets={"shared-key": SECRET},
            trust={
                "Independent Lab": frozenset({"shared-key"}),
                "Google": frozenset({"shared-key"}),
                "Anthropic": frozenset({"anthropic-key"}),
            },
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["issuer_org"], "Independent Lab")
        self.assertEqual(result["verifier_key_id"], "shared-key")
        self.assertIn("external_attestation_key_reused_across_issuers", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
