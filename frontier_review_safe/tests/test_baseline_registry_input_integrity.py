from __future__ import annotations

import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry


HASH = "a" * 64


def _registry() -> BaselineRegistry:
    registration = BaselineRegistration(
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
        capabilities=("sealed_eval",),
    )
    return BaselineRegistry(
        schema="musitu.axiom.baseline-registry.v1",
        version="v1",
        created_at="2026-09-12T04:00:00+00:00",
        registrations=(registration,),
    )


class BaselineRegistryMalformedCoverageInputTests(unittest.TestCase):
    def test_non_iterable_required_provider_orgs_fails_closed_without_exception(self):
        result = _registry().coverage(required_provider_orgs=None)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_required_provider_orgs", result["reasons"])

    def test_non_iterable_required_provider_classes_fails_closed_without_exception(self):
        result = _registry().coverage(required_provider_classes=None)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_required_provider_classes", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
