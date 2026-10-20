"""Offline-only acceptance for the real Store payment staging preflight.

Never imports credentials or invokes main(); Cloudflare is never contacted.
"""
import importlib.util
import os
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "store_payment_staging_guard", ROOT / "provision_store_payments_staging.py"
)
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)


class StagingSourcePreflight(unittest.TestCase):
    def test_current_real_checkout_module_passes_staging_preflight_without_network(self):
        sql, modules, names = staging.check_source_and_schema()
        self.assertIn("CREATE TABLE", sql)
        self.assertEqual(
            [name for name, _ in modules],
            ["store-axiom-checkout.mjs", "store-axiom-payment-routes.mjs"],
        )
        self.assertEqual(
            names,
            {
                "store_customer_tokens", "store_products",
                "store_checkout_intents", "store_checkout_reviews",
            },
        )

    def test_existing_full_privilege_github_secret_is_preferred_to_limited_token(self):
        # Existing other Store production workflows use the owner-configured
        # Cloudflare email/global API key pair, kept as GitHub Actions secrets.
        # Do not reveal either credential in logs or use an unprotected variable.
        with patch.dict(os.environ, {
            "CF_API_TOKEN": "restricted-fixture-token",
            "CLOUDFLARE_EMAIL": "fixture@example.invalid",
            "CLOUDFLARE_GLOBAL_API_KEY": "global-key-fixture",
        }, clear=True):
            auth = staging.get_credentials()
        self.assertEqual(set(auth), {"X-Auth-Email", "X-Auth-Key"})
        self.assertEqual(auth["X-Auth-Email"], "fixture@example.invalid")
        self.assertEqual(auth["X-Auth-Key"], "global-key-fixture")

    def test_scoped_token_used_when_global_pair_absent(self):
        with patch.dict(os.environ, {"CF_API_TOKEN": "scoped-token"}, clear=True):
            self.assertEqual(staging.get_credentials(), {"Authorization": "Bearer scoped-token"})

    def test_missing_github_credentials_fail_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "no authorized Cloudflare API credentials"):
                staging.get_credentials()

    def test_isolated_store_staging_uses_only_new_v2_scoped_secret(self):
        workflow = (
            ROOT.parent.parent.parent /
            ".github/workflows/musitu-store-v2-payments-staging-provision.yml"
        ).read_text()
        self.assertIn("CF_API_TOKEN: ${{ secrets.CLOUDFLARE_RULESETS_API_TOKEN }}", workflow)
        self.assertNotIn("secrets.CLOUDFLARE_API_TOKENV2", workflow)
        self.assertNotIn("secrets.CLOUDFLARE_API_TOKEN }}", workflow)
        self.assertNotIn("secrets.CLOUDFLARE_GLOBAL_API_KEY", workflow)
        self.assertNotIn("secrets.CLOUDFLARE_EMAIL", workflow)
        self.assertIn("MUSITU_STORE_STAGE_GATE: 'disabled-checkout-no-public-route'", workflow)

    def test_explicit_owner_trigger_is_only_staging_push_path(self):
        workflow = (
            ROOT.parent.parent.parent /
            ".github/workflows/musitu-store-v2-payments-staging-provision.yml"
        ).read_text()
        self.assertIn(
            "- 'store/phase1/payments/PROVISION_STAGING_APPROVAL_TRIGGER.txt'",
            workflow,
        )
        self.assertNotIn(
            "- 'store/phase1/payments/provision_store_payments_staging.py'",
            workflow,
        )
        self.assertNotIn(
            "- '.github/workflows/musitu-store-v2-payments-staging-provision.yml'",
            workflow,
        )
        self.assertIn("github.actor == 'evansmusitu'", workflow)
        self.assertIn("ALLOW_DISABLED_UNROUTED_STORE_ONLY", workflow)

    def test_unapproved_checkout_import_fails_closed_before_any_cloudflare_api(self):
        with tempfile.TemporaryDirectory(prefix="store-staging-guard-") as root:
            temp = Path(root)
            for name in (
                "store-axiom-checkout-schema.sql",
                "store-axiom-checkout.mjs",
                "store-axiom-payment-routes.mjs",
            ):
                (temp / name).write_bytes((ROOT / name).read_bytes())
            checkout = temp / "store-axiom-checkout.mjs"
            checkout.write_text(
                checkout.read_text().replace(
                    "from './store-axiom-payment-routes.mjs'",
                    "from './unreviewed-payment-implementation.mjs'",
                )
            )
            old = staging.ROOT
            staging.ROOT = temp
            try:
                with self.assertRaisesRegex(RuntimeError, "import|dependenc|module"):
                    staging.check_source_and_schema()
            finally:
                staging.ROOT = old


if __name__ == "__main__":
    unittest.main()
