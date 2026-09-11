from __future__ import annotations

from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService


NOW = datetime(2026, 9, 11, 12, 50, tzinfo=timezone.utc).isoformat()
SECRET = b"g" * 32
KEY_ID = "lab-key"
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


def verify(trust, secrets=None):
    return ExternalAttestationService.verify(
        receipt(),
        expected_subject_type="external_run",
        expected_subject_id="run-1",
        expected_subject_hash="a" * 64,
        verifier_secrets=secrets or {KEY_ID: SECRET},
        trusted_issuers=trust,
    )


class ExternalAttestationGlobalTrustRootIntegrityTests(unittest.TestCase):
    def test_malformed_unrelated_key_set_invalidates_whole_trust_root(self):
        result = verify({
            ISSUER: frozenset({KEY_ID}),
            "OpenAI": {"provider-key"},
        })
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_malformed_unrelated_issuer_identity_invalidates_whole_trust_root(self):
        result = verify({
            ISSUER: frozenset({KEY_ID}),
            " OpenAI ": frozenset({"provider-key"}),
        })
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_malformed_unrelated_key_identity_invalidates_whole_trust_root(self):
        result = verify({
            ISSUER: frozenset({KEY_ID}),
            "OpenAI": frozenset({" provider-key"}),
        })
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_malformed_conflicting_entry_cannot_hide_cross_issuer_key_ownership(self):
        result = verify({
            ISSUER: frozenset({KEY_ID}),
            "OpenAI": [KEY_ID],
        })
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_fully_valid_multi_issuer_trust_root_remains_valid(self):
        result = verify(
            {
                ISSUER: frozenset({KEY_ID}),
                "OpenAI": frozenset({"provider-key"}),
            },
            secrets={KEY_ID: SECRET, "provider-key": b"p" * 32},
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["reasons"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
