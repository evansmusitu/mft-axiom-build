"""Fail-closed test: legacy production-writing verifier may never be run.

This is a direct code-path safety control, separate from the GitHub workflow's
own fail-closed release veto. No real credentials or network connections.
"""
from __future__ import annotations
import os
from unittest import TestCase, main
from unittest.mock import patch

class LegacyLiveVeto(TestCase):
    def test_privileged_environment_cannot_enter_legacy_network_or_db_mutation(self):
        # Import after dependencies are installed; source has no import-time IO.
        from frontier_v5.scripts import frontier_live_verify as live
        fake={"CLOUDFLARE_API_TOKEN":"SYNTHETIC_SHOULD_NEVER_USE",
              "CLOUDFLARE_EMAIL":"synthetic@example.invalid",
              "CLOUDFLARE_GLOBAL_API_KEY":"SYNTHETIC_SHOULD_NEVER_USE"}
        with patch.dict(os.environ,fake), patch.object(live,"raw") as network:
            with self.assertRaisesRegex(SystemExit,
                "MUSITU_AXIOM_FRONTIER_LEGACY_PRODUCTION_WRITE_ADAPTER_DISABLED_NOT_RELEASE"):
                live.main()
            network.assert_not_called()

if __name__ == "__main__":
    main()
