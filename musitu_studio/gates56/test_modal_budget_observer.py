"""Offline interface tests only; NO Modal API contact and NO hard-cap claim."""
from decimal import Decimal
from types import SimpleNamespace
import unittest

from musitu_studio.gates56.modal_budget_observer import (
    ModalBudgetObserver, ModalUsageReadback
)
from musitu_studio.gates56.ledger import GateClosed


class ModalBudgetObserverTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.env = {
            "MODAL_TOKEN_ID": "ak-offline-test-only",
            "MODAL_TOKEN_SECRET": "as-offline-test-only",
        }
        self.usage = SimpleNamespace(
            metered_cost=Decimal("2.11001"),
            billed_cost=Decimal("1.985"),
        )
        def summary(*, cycle):
            self.calls.append(("summary", cycle))
            return self.usage
        ws = SimpleNamespace(name=lambda: "expected-studio-workspace",
                             billing=SimpleNamespace(summary=summary))
        self.sdk = SimpleNamespace(
            Workspace=SimpleNamespace(from_context=lambda: ws)
        )

    def make_observer(self, **kwargs):
        return ModalBudgetObserver(
            expected_workspace="expected-studio-workspace",
            sdk=self.sdk, credentials=self.env, now=lambda: 1795510000,
            **kwargs
        )

    def test_authenticated_sdk_billing_observation_is_not_a_budget_certificate(self):
        o = self.make_observer().read_usage()
        self.assertIsInstance(o, ModalUsageReadback)
        self.assertEqual(o.metered_cents, 212)
        self.assertEqual(o.billed_cents, 199)
        self.assertEqual(o.local_observation_unix, 1795510000)
        self.assertFalse(o.hard_cap_verified)
        self.assertIsNone(o.provider_remaining_cents)
        self.assertFalse(o.rendering_authorized)
        self.assertEqual(self.calls, [("summary", "this month")])

    def test_even_authenticated_billing_cannot_arm_ledger(self):
        observer = self.make_observer()
        observer.read_usage()
        with self.assertRaisesRegex(GateClosed, "MODAL_HARD_CAP_NOT_ATTESTED"):
            observer()
        self.assertEqual(self.calls, [("summary", "this month")])

    def test_missing_explicit_credentials_fails_without_calling_sdk(self):
        self.env.pop("MODAL_TOKEN_SECRET")
        with self.assertRaisesRegex(GateClosed, "MODAL_EXPLICIT_AUTH_REQUIRED"):
            self.make_observer().read_usage()
        self.assertEqual(self.calls, [])

    def test_workspace_mismatch_is_a_hard_denial(self):
        self.sdk.Workspace.from_context = lambda: SimpleNamespace(
            name=lambda: "unrelated-workspace",
            billing=SimpleNamespace(summary=lambda **kw: self.usage))
        with self.assertRaisesRegex(GateClosed, "MODAL_WORKSPACE_IDENTITY_MISMATCH"):
            self.make_observer().read_usage()
        self.assertEqual(self.calls, [])

    def test_missing_invalid_or_nonfinite_usage_fails_closed(self):
        for bad in (
            SimpleNamespace(metered_cost="1.23", billed_cost=Decimal("1")),
            SimpleNamespace(metered_cost=Decimal("NaN"), billed_cost=Decimal("1")),
            SimpleNamespace(metered_cost=Decimal("-0.01"), billed_cost=Decimal("0")),
            SimpleNamespace(metered_cost=None, billed_cost=Decimal("0")),
        ):
            with self.subTest(bad=repr(bad)):
                self.usage=bad
                with self.assertRaisesRegex(GateClosed, "MODAL_USAGE_UNVERIFIABLE"):
                    self.make_observer().read_usage()

    def test_sdk_failure_does_not_leak_credentials_or_backend_exception(self):
        def dangerous_failure():
            raise RuntimeError("secret=as-offline-test-only")
        self.sdk.Workspace.from_context = dangerous_failure
        with self.assertRaises(GateClosed) as cm:
            self.make_observer().read_usage()
        self.assertEqual(str(cm.exception), "MODAL_AUTHENTICATED_READBACK_UNAVAILABLE")
        self.assertNotIn("secret", str(cm.exception))

    def test_wrong_token_prefix_fails_without_provider_request(self):
        self.env["MODAL_TOKEN_ID"]="wk-not-a-modal-api-token"
        with self.assertRaisesRegex(GateClosed,"MODAL_EXPLICIT_AUTH_REQUIRED"):
            self.make_observer().read_usage()
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
