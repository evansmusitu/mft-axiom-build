from __future__ import annotations

from pathlib import Path
import json
import tempfile
import unittest

from frontier_review_safe.adaptation import PersistentContinualAdaptationRegistry
from frontier_review_safe.core import FrontierSafetyError
from frontier_review_safe.evaluation import AdaptationRelease


class PersistentAdaptationTests(unittest.TestCase):
    @staticmethod
    def release(version: str, parent: str | None, marker: str, rollback_to: str | None = None) -> AdaptationRelease:
        return AdaptationRelease(
            version,
            parent,
            marker * 64,
            chr(ord(marker) + 1) * 64,
            chr(ord(marker) + 2) * 64,
            chr(ord(marker) + 3) * 64,
            rollback_to,
        )

    def test_promotion_survives_restart_and_rollback_is_durable(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.json"
            registry = PersistentContinualAdaptationRegistry(path)
            v1 = self.release("v1", None, "a")
            v2 = self.release("v2", "v1", "1", rollback_to="v1")
            self.assertEqual(registry.promote(v1, regression_pass=True), "v1")
            self.assertEqual(registry.promote(v2, regression_pass=True), "v2")

            restarted = PersistentContinualAdaptationRegistry(path)
            self.assertEqual(restarted.active_version, "v2")
            self.assertEqual(set(restarted.releases), {"v1", "v2"})
            before = restarted.fingerprint
            self.assertEqual(restarted.rollback(), "v1")
            self.assertNotEqual(restarted.fingerprint, before)

            restarted_again = PersistentContinualAdaptationRegistry(path)
            self.assertEqual(restarted_again.active_version, "v1")
            self.assertTrue(restarted_again.verify())

    def test_regression_failed_release_is_not_persisted(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.json"
            registry = PersistentContinualAdaptationRegistry(path)
            release = self.release("v1", None, "a")
            with self.assertRaises(FrontierSafetyError):
                registry.promote(release, regression_pass=False)
            self.assertFalse(path.exists())
            self.assertEqual(registry.releases, {})
            self.assertIsNone(registry.active_version)

    def test_wrong_parent_and_version_collision_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.json"
            registry = PersistentContinualAdaptationRegistry(path)
            v1 = self.release("v1", None, "a")
            registry.promote(v1, regression_pass=True)
            with self.assertRaises(FrontierSafetyError):
                registry.promote(self.release("v2", "missing", "1"), regression_pass=True)
            # Same version with a valid parent shape but different evidence must
            # reach the version-collision guard rather than self-parent validation.
            with self.assertRaises(FrontierSafetyError):
                registry.promote(self.release("v1", None, "1"), regression_pass=True)
            with self.assertRaises(ValueError):
                registry.promote(self.release("self", "self", "1"), regression_pass=True)

    def test_tampered_active_state_or_transition_chain_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.json"
            registry = PersistentContinualAdaptationRegistry(path)
            registry.promote(self.release("v1", None, "a"), regression_pass=True)

            raw = json.loads(path.read_text(encoding="utf-8"))
            raw["active_version"] = None
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                PersistentContinualAdaptationRegistry(path)

            # Restore a valid file, then break the transition contents.
            path.unlink()
            registry = PersistentContinualAdaptationRegistry(path)
            registry.promote(self.release("v1", None, "a"), regression_pass=True)
            raw = json.loads(path.read_text(encoding="utf-8"))
            raw["transitions"][0]["to_version"] = "forged"
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                PersistentContinualAdaptationRegistry(path)

    def test_unsupported_schema_and_malformed_evidence_hashes_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.json"
            path.write_text(json.dumps({"schema": "future.v99"}), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                PersistentContinualAdaptationRegistry(path)

            path.unlink()
            registry = PersistentContinualAdaptationRegistry(path)
            malformed = AdaptationRelease("v1", None, "short", "b" * 64, "c" * 64, "d" * 64, None)
            with self.assertRaises(ValueError):
                registry.promote(malformed, regression_pass=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
