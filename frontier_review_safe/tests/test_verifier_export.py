from __future__ import annotations

import unittest

from frontier_review_safe import orchestration, verification

H = "a" * 64


class VerifierExportIntegrityTests(unittest.TestCase):
    def test_orchestration_exports_canonical_hardened_verifier(self):
        self.assertIs(orchestration.VerificationPath, verification.VerificationPath)
        self.assertIs(orchestration.IndependentVerifier, verification.IndependentVerifier)

    def test_direct_orchestration_import_cannot_launder_local_checks_as_independent(self):
        paths = [
            orchestration.VerificationPath("local-a", "invariant", None, lambda r: True),
            orchestration.VerificationPath("local-b", "alternate", None, lambda r: True),
        ]
        result = orchestration.IndependentVerifier.verify(
            {"value": 1}, paths, require_separate_origin=True
        )
        self.assertEqual(result["status"], "ESCALATE")
        self.assertIn("separate_external_origin_required", result["reasons"])
        self.assertIn("insufficient_independent_origins", result["reasons"])

    def test_external_label_without_provenance_cannot_pass(self):
        paths = [
            orchestration.VerificationPath("local", "invariant", None, lambda r: True),
            orchestration.VerificationPath(
                "fake-provider", "alternate", "provider-x", lambda r: True,
                origin="provider:provider-x", provenance_hash=None,
                requires_external_origin=True,
            ),
        ]
        result = orchestration.IndependentVerifier.verify(
            {"value": 1}, paths, require_separate_origin=True
        )
        self.assertEqual(result["status"], "ESCALATE")
        self.assertIn("verification_path_failed", result["reasons"])

    def test_provenanced_separate_origin_can_pass(self):
        paths = [
            orchestration.VerificationPath("local", "invariant", None, lambda r: r["value"] == 1),
            orchestration.VerificationPath(
                "provider", "alternate", "provider-x", lambda r: r["value"] == 1,
                origin="provider:provider-x", provenance_hash=H,
                requires_external_origin=True,
            ),
        ]
        result = orchestration.IndependentVerifier.verify(
            {"value": 1}, paths, require_separate_origin=True
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["independent_providers"], ["provider-x"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
