from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry


NOW = datetime(2026, 9, 11, 10, 45, tzinfo=timezone.utc)
H = "a" * 64


def registration(registration_id: str, provider_org: str) -> BaselineRegistration:
    return BaselineRegistration(
        registration_id=registration_id,
        provider_org=provider_org,
        provider_class="general_agent",
        product="agent",
        exact_version="v1",
        access_mode="api",
        registered_at=NOW.isoformat(),
        valid_until=(NOW + timedelta(days=1)).isoformat(),
        case_set_hash=H,
        constraint_hash="b" * 64,
        permissions_hash="c" * 64,
        configuration_hash="d" * 64,
        account_scope_hash="e" * 64,
        capabilities=("sealed_eval",),
    )


class ProviderIdentityCanonicalizationTests(unittest.TestCase):
    def test_provider_org_rejects_leading_or_trailing_whitespace(self):
        for provider in (" OpenAI", "OpenAI ", "\tOpenAI", "OpenAI\n"):
            with self.subTest(provider=repr(provider)):
                with self.assertRaises(ValueError):
                    registration("reg-1", provider)

    def test_provider_org_rejects_noncanonical_internal_whitespace(self):
        for provider in ("Open  AI", "Open\tAI", "Open\nAI"):
            with self.subTest(provider=repr(provider)):
                with self.assertRaises(ValueError):
                    registration("reg-1", provider)

    def test_provider_org_case_variants_collapse_in_coverage(self):
        registry = BaselineRegistry(
            "musitu.axiom.baseline-registry.v1",
            "v1",
            NOW.isoformat(),
            (registration("reg-1", "OpenAI"), registration("reg-2", "OPENAI")),
        )
        coverage = registry.coverage()
        self.assertEqual(coverage["status"], "PASS")
        self.assertEqual(coverage["provider_orgs"], ["openai"])

    def test_required_provider_scope_rejects_non_string_or_noncanonical_names(self):
        registry = BaselineRegistry(
            "musitu.axiom.baseline-registry.v1",
            "v1",
            NOW.isoformat(),
            (registration("reg-1", "OpenAI"),),
        )
        for required in ((1,), (True,), (" OpenAI",), ("OpenAI ",), ("Open  AI",), ("",)):
            with self.subTest(required=required):
                report = registry.coverage(required_provider_orgs=required)
                self.assertEqual(report["status"], "FAIL")
                self.assertIn("invalid_required_provider_orgs", report["reasons"])

    def test_canonical_provider_scope_remains_case_insensitive(self):
        registry = BaselineRegistry(
            "musitu.axiom.baseline-registry.v1",
            "v1",
            NOW.isoformat(),
            (registration("reg-1", "OpenAI"),),
        )
        report = registry.coverage(required_provider_orgs=("openai",))
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["missing_provider_orgs"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
