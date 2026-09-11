from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.core import FrontierSafetyError


NOW = datetime(2026, 9, 11, 5, 30, tzinfo=timezone.utc)
H = "a" * 64


def registration(reg_id="r1", provider="OpenAI", provider_class="general_agent"):
    return BaselineRegistration(
        registration_id=reg_id,
        provider_org=provider,
        provider_class=provider_class,
        product="product",
        exact_version="2026-09",
        access_mode="api",
        registered_at=(NOW - timedelta(minutes=5)).isoformat(),
        valid_until=(NOW + timedelta(hours=1)).isoformat(),
        case_set_hash=H,
        constraint_hash="b"*64,
        permissions_hash="c"*64,
        configuration_hash="d"*64,
        account_scope_hash="e"*64,
        capabilities=("research","tools"),
    )


class BaselineRegistryTests(unittest.TestCase):
    def test_exact_run_binding_passes_and_version_drift_fails(self):
        reg = registration()
        registry = BaselineRegistry("musitu.axiom.baseline-registry.v1", "v1", NOW.isoformat(), (reg,))
        kwargs = dict(
            provider_org=reg.provider_org, product=reg.product, exact_version=reg.exact_version,
            access_mode=reg.access_mode, executed_at=NOW.isoformat(), case_set_hash=reg.case_set_hash,
            constraint_hash=reg.constraint_hash, permissions_hash=reg.permissions_hash,
            configuration_hash=reg.configuration_hash, account_scope_hash=reg.account_scope_hash,
        )
        self.assertEqual(registry.validate_run_binding(reg.registration_id, reg.fingerprint, **kwargs)["status"], "PASS")
        kwargs["exact_version"] = "different"
        failed = registry.validate_run_binding(reg.registration_id, reg.fingerprint, **kwargs)
        self.assertEqual(failed["status"], "FAIL")
        self.assertIn("baseline_exact_version_mismatch", failed["reasons"])

    def test_expired_registration_and_wrong_fingerprint_fail_closed(self):
        reg = registration()
        registry = BaselineRegistry("musitu.axiom.baseline-registry.v1", "v1", NOW.isoformat(), (reg,))
        failed = registry.validate_run_binding(
            reg.registration_id, "f"*64, provider_org=reg.provider_org, product=reg.product,
            exact_version=reg.exact_version, access_mode=reg.access_mode,
            executed_at=(NOW + timedelta(hours=2)).isoformat(), case_set_hash=reg.case_set_hash,
            constraint_hash=reg.constraint_hash, permissions_hash=reg.permissions_hash,
            configuration_hash=reg.configuration_hash, account_scope_hash=reg.account_scope_hash,
        )
        self.assertEqual(failed["status"], "FAIL")
        self.assertIn("baseline_registration_hash_mismatch", failed["reasons"])
        self.assertIn("baseline_registration_expired", failed["reasons"])

    def test_registry_coverage_requires_declared_provider_scope(self):
        regs = (
            registration("r1","OpenAI","general_agent"),
            registration("r2","Anthropic","coding_agent"),
            registration("r3","Google","multimodal_agent"),
        )
        registry = BaselineRegistry("musitu.axiom.baseline-registry.v1", "v1", NOW.isoformat(), regs)
        ok = registry.coverage(required_provider_orgs=("OpenAI","Anthropic"), required_provider_classes=("general_agent","coding_agent"))
        self.assertEqual(ok["status"], "PASS")
        bad = registry.coverage(required_provider_orgs=("Microsoft",), required_provider_classes=("financial_data_stack",))
        self.assertEqual(bad["status"], "FAIL")
        self.assertEqual(bad["missing_provider_orgs"], ["microsoft"])
        self.assertEqual(bad["missing_provider_classes"], ["financial_data_stack"])

    def test_duplicate_registration_identity_is_rejected(self):
        reg = registration()
        with self.assertRaises(FrontierSafetyError):
            BaselineRegistry("musitu.axiom.baseline-registry.v1", "v1", NOW.isoformat(), (reg, reg))

    def test_registration_rejects_nonhex_hashes_and_blank_identity(self):
        reg = registration()
        with self.assertRaises(ValueError):
            replace(reg, case_set_hash="z" * 64)
        with self.assertRaises(ValueError):
            replace(reg, provider_org="   ")
        with self.assertRaises(ValueError):
            replace(reg, capabilities=("research", " "))

    def test_registry_rejects_blank_version(self):
        reg = registration()
        with self.assertRaises(ValueError):
            BaselineRegistry("musitu.axiom.baseline-registry.v1", "   ", NOW.isoformat(), (reg,))


if __name__ == "__main__":
    unittest.main(verbosity=2)
