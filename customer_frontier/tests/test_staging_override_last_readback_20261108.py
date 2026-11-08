"""TDD regressions: fail closed when exact staging ingress drifts after dry-run.

Every Cloudflare interaction is a local Fake. No secrets or network I/O.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qualification"))
import staging_override_newtoken as stage
from test_staging_override_newtoken import Fake, http


class WorkerBindingChangesAfterDryRun(Fake):
    def get(self, path):
        if path == f"/accounts/{stage.ACCOUNT}/workers/scripts/{stage.WORKER}/settings" and self.dry_count:
            return {"bindings": [{"type": "d1", "name": "UNREVIEWED_DB"}]}
        return super().get(path)


class CustomDomainChangesAfterDryRun(Fake):
    def get(self, path):
        if path == f"/accounts/{stage.ACCOUNT}/workers/domains" and self.dry_count:
            return [{"hostname": stage.HOST, "service": "different-service", "enabled": True}]
        return super().get(path)


class LastReadbackMustMatch(unittest.TestCase):
    def check(self, candidate, reason):
        with patch.object(stage, "FULL_HASHES", tuple(stage.h(r["expression"]) for r in candidate.current["rules"])):
            with self.assertRaisesRegex(stage.Stop, reason):
                stage.run(candidate, http, lambda _: None)
        self.assertEqual(candidate.dry_count, 1)
        self.assertEqual(candidate.live_count, 0, "Drift must prevent the live Cloudflare PUT")

    def test_new_worker_database_binding_after_dry_run_denies_live_rule_put(self):
        self.check(WorkerBindingChangesAfterDryRun(), "STAGING_INGRESS_CHANGED_DURING_PREFLIGHT")

    def test_staging_custom_domain_target_changes_after_dry_run_denies_live_rule_put(self):
        self.check(CustomDomainChangesAfterDryRun(), "STAGING_INGRESS_CHANGED_DURING_PREFLIGHT")


if __name__ == "__main__":
    unittest.main()
