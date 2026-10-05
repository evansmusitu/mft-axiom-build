from __future__ import annotations

import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry


HASH = "a" * 64


def _registration() -> BaselineRegistration:
    return BaselineRegistration(
        registration_id="reg-1",
        provider_org="Provider A",
        provider_class="general_agent",
        product="Agent",
        exact_version="v1",
        access_mode="api",
        registered_at="2026-09-12T04:00:00+00:00",
        valid_until="2026-09-13T04:00:00+00:00",
        case_set_hash=HASH,
        constraint_hash="b" * 64,
        permissions_hash="c" * 64,
        configuration_hash="d" * 64,
        account_scope_hash="e" * 64,
    )


class BaselineRegistryBindingInputIntegrityTests(unittest.TestCase):
    def test_invalid_execution_timestamp_fails_closed_without_exception(self):
        reg = _registration()
        registry = BaselineRegistry(
            schema="musitu.axiom.baseline-registry.v1",
            version="v1",
            created_at="2026-09-12T04:00:00+00:00",
            registrations=(reg,),
        )
        result = registry.validate_run_binding(
            reg.registration_id,
            reg.fingerprint,
            provider_org=reg.provider_org,
            product=reg.product,
            exact_version=reg.exact_version,
            access_mode=reg.access_mode,
            executed_at="not-a-time",
            case_set_hash=reg.case_set_hash,
            constraint_hash=reg.constraint_hash,
            permissions_hash=reg.permissions_hash,
            configuration_hash=reg.configuration_hash,
            account_scope_hash=reg.account_scope_hash,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("baseline_execution_time_invalid", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
