"""Reject direct invocation of legacy Cloudflare D1 production-writing adapter.

This tests an executable escape path independent of the disabled live verifier.
Never make outbound calls or provide real credentials.
"""
from __future__ import annotations
import unittest
from unittest.mock import patch
from frontier_v5.runtime.fabric import AuthorizationError
from frontier_v5.runtime.fullstack import CloudflareD1ProductionStore

class LegacyD1AdapterVeto(unittest.TestCase):
    def test_nonsealed_target_with_synthetic_credentials_fails_before_any_network(self):
        synthetic_db="11111111-1111-4111-8111-111111111111"
        with patch("urllib.request.urlopen") as outbound:
            with self.assertRaisesRegex(AuthorizationError,
                "MUSITU_AXIOM_FRONTIER_LEGACY_D1_WRITES_DISABLED_NOT_RELEASE"):
                adapter=CloudflareD1ProductionStore(
                    "93f395f5121954671f92fffa453d6b61",synthetic_db,
                    api_token="SYNTHETIC_DO_NOT_USE")
                adapter.migrate()
            outbound.assert_not_called()

    def test_global_key_does_not_bypass_staging_veto(self):
        with patch("urllib.request.urlopen") as outbound:
            with self.assertRaisesRegex(AuthorizationError,
                "MUSITU_AXIOM_FRONTIER_LEGACY_D1_WRITES_DISABLED_NOT_RELEASE"):
                CloudflareD1ProductionStore(
                    "93f395f5121954671f92fffa453d6b61",
                    "22222222-2222-4222-8222-222222222222",
                    email="synthetic@example.invalid",global_api_key="SYNTHETIC_KEY")
            outbound.assert_not_called()

    def test_sealed_d1_still_forbidden(self):
        with patch("urllib.request.urlopen") as outbound:
            with self.assertRaises(AuthorizationError):
                CloudflareD1ProductionStore(
                    "93f395f5121954671f92fffa453d6b61",
                    "504029cc-f9a5-495e-818f-63c6144b4ea4",
                    api_token="SYNTHETIC_DO_NOT_USE")
            outbound.assert_not_called()

if __name__=="__main__":
    unittest.main()
