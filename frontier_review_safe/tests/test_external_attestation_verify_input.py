from __future__ import annotations

from collections.abc import Iterator, Mapping
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService


HASH = "a" * 64
SECRET = b"v" * 32
KEY_ID = "verifier-key"
ISSUER = "Independent Verifier"
ISSUED_AT = "2026-09-12T05:45:00+00:00"


class ExplodingMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise KeyError(key)

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("mapping iteration failed")

    def __len__(self) -> int:
        return 1


def _receipt():
    return ExternalAttestationService.issue(
        subject_type="external_run",
        subject_id="run-1",
        subject_hash=HASH,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type="provider_api_receipt",
        issued_at=ISSUED_AT,
        verifier_secret=SECRET,
    )


class ExternalAttestationVerifyInputTests(unittest.TestCase):
    def test_non_receipt_input_fails_closed_without_attribute_error(self):
        result = ExternalAttestationService.verify(
            None,
            expected_subject_type="external_run",
            expected_subject_id="run-1",
            expected_subject_hash=HASH,
            verifier_secrets={KEY_ID: SECRET},
            trusted_issuers={ISSUER: frozenset({KEY_ID})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_external_attestation_receipt", result["reasons"])

    def test_exploding_trust_root_fails_closed_without_exception(self):
        result = ExternalAttestationService.verify(
            _receipt(),
            expected_subject_type="external_run",
            expected_subject_id="run-1",
            expected_subject_hash=HASH,
            verifier_secrets={KEY_ID: SECRET},
            trusted_issuers=ExplodingMapping(),
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_exploding_secret_store_fails_closed_without_exception(self):
        result = ExternalAttestationService.verify(
            _receipt(),
            expected_subject_type="external_run",
            expected_subject_id="run-1",
            expected_subject_hash=HASH,
            verifier_secrets=ExplodingMapping(),
            trusted_issuers={ISSUER: frozenset({KEY_ID})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
