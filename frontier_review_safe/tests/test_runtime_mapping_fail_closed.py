from __future__ import annotations

from collections.abc import Iterator, Mapping
import unittest

from frontier_review_safe.external_validation import ExternalEvidenceGate


class ExplodingMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise KeyError(key)

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("mapping iteration failed")

    def __len__(self) -> int:
        return 1


class RuntimeMappingFailClosedTests(unittest.TestCase):
    def test_level6_exploding_secret_mapping_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level6(
            {},
            [],
            verifier_secrets=ExplodingMapping(),
            trusted_issuers={},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])

    def test_level7_exploding_trust_mapping_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level7(
            {},
            [],
            verifier_secrets={},
            trusted_issuers=ExplodingMapping(),
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
