from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import json
import tempfile
import unittest

from frontier_review_safe.adaptation import PersistentContinualAdaptationRegistry
from frontier_review_safe.core import FrontierSafetyError, canonical, sha256
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
            path = Path(td) / "adaptations.jsonl"
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
            header = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(header["schema"], PersistentContinualAdaptationRegistry.SCHEMA)

    def test_regression_failed_release_is_not_persisted(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.jsonl"
            registry = PersistentContinualAdaptationRegistry(path)
            release = self.release("v1", None, "a")
            with self.assertRaises(FrontierSafetyError):
                registry.promote(release, regression_pass=False)
            self.assertFalse(path.exists())
            self.assertEqual(registry.releases, {})
            self.assertIsNone(registry.active_version)

    def test_wrong_parent_and_version_collision_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.jsonl"
            registry = PersistentContinualAdaptationRegistry(path)
            v1 = self.release("v1", None, "a")
            registry.promote(v1, regression_pass=True)
            with self.assertRaises(FrontierSafetyError):
                registry.promote(self.release("v2", "missing", "1"), regression_pass=True)
            with self.assertRaises(FrontierSafetyError):
                registry.promote(self.release("v1", None, "1"), regression_pass=True)
            with self.assertRaises(ValueError):
                registry.promote(self.release("self", "self", "1"), regression_pass=True)

    def test_tampered_journal_record_or_truncated_tail_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.jsonl"
            registry = PersistentContinualAdaptationRegistry(path)
            registry.promote(self.release("v1", None, "a"), regression_pass=True)

            lines = path.read_text(encoding="utf-8").splitlines()
            record = json.loads(lines[1])
            record["to_version"] = "forged"
            lines[1] = canonical(record)
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                PersistentContinualAdaptationRegistry(path)

            path.unlink()
            registry = PersistentContinualAdaptationRegistry(path)
            registry.promote(self.release("v1", None, "a"), regression_pass=True)
            raw = path.read_text(encoding="utf-8")
            path.write_text(raw[:-1], encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                PersistentContinualAdaptationRegistry(path)

    def test_unsupported_schema_and_malformed_evidence_hashes_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.jsonl"
            path.write_text(json.dumps({"schema": "future.v99"}), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                PersistentContinualAdaptationRegistry(path)

            path.unlink()
            registry = PersistentContinualAdaptationRegistry(path)
            malformed = AdaptationRelease("v1", None, "short", "b" * 64, "c" * 64, "d" * 64, None)
            with self.assertRaises(ValueError):
                registry.promote(malformed, regression_pass=True)

    def test_stale_instances_refresh_under_file_lock(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.jsonl"
            first = PersistentContinualAdaptationRegistry(path)
            stale = PersistentContinualAdaptationRegistry(path)
            first.promote(self.release("v1", None, "a"), regression_pass=True)
            stale.promote(self.release("v2", "v1", "1"), regression_pass=True)
            first.promote(self.release("v3", "v2", "5"), regression_pass=True)
            restarted = PersistentContinualAdaptationRegistry(path)
            self.assertEqual(restarted.active_version, "v3")
            self.assertEqual(set(restarted.releases), {"v1", "v2", "v3"})
            self.assertTrue(restarted.verify())

    def test_v1_snapshot_migrates_before_next_durable_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "adaptations.json"
            v1 = self.release("v1", None, "a")
            body = {
                "sequence": 0,
                "kind": "PROMOTE",
                "version": "v1",
                "from_version": None,
                "to_version": "v1",
                "previous_sha256": None,
            }
            legacy = {
                "schema": PersistentContinualAdaptationRegistry.LEGACY_SCHEMA,
                "releases": [asdict(v1)],
                "active_version": "v1",
                "transitions": [{**body, "transition_sha256": sha256(body)}],
            }
            path.write_text(json.dumps(legacy, indent=2), encoding="utf-8")

            registry = PersistentContinualAdaptationRegistry(path)
            self.assertEqual(registry.active_version, "v1")
            registry.promote(self.release("v2", "v1", "1", rollback_to="v1"), regression_pass=True)
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(json.loads(lines[0])["schema"], PersistentContinualAdaptationRegistry.SCHEMA)
            self.assertEqual(len(lines), 3)
            restarted = PersistentContinualAdaptationRegistry(path)
            self.assertEqual(restarted.active_version, "v2")
            self.assertTrue(restarted.verify())


if __name__ == "__main__":
    unittest.main(verbosity=2)
