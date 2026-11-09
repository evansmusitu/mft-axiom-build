"""Synthetic-only tests: staging Worker must not hide a second Hyperdrive route.

No live Cloudflare, Neon, SQL, OAuth, provider, billing, or network operations.
"""
import copy
import unittest

from private_origin_admission import evaluate
from test_private_origin_hostname_guard import candidate


class SingleHyperdriveAdmissionTests(unittest.TestCase):
    def assert_blocked_extra_hyperdrive(self, binding):
        metadata = candidate()
        metadata['worker']['bindings'].append(binding)
        outcome = evaluate(metadata)
        self.assertEqual(outcome['status'], 'METADATA_SECURITY_GATE_BLOCKED')
        self.assertIn('WORKER_BINDING_MISMATCH', outcome['blocking_reasons'])
        self.assertFalse(outcome['network_verified'])
        self.assertFalse(outcome['authorized_to_deploy'])
        self.assertFalse(outcome['production_release_qualified'])
        self.assertEqual(outcome['cloudflare_writes'], 0)
        self.assertEqual(outcome['neon_sql_queries'], 0)

    def test_second_differently_named_hyperdrive_route_is_blocked(self):
        self.assert_blocked_extra_hyperdrive({
            'name': 'SHADOW_HYPERDRIVE', 'type': 'hyperdrive', 'id': 'synthetic-public-route',
        })

    def test_alias_for_same_database_route_is_also_blocked(self):
        self.assert_blocked_extra_hyperdrive({
            'name': 'SHADOW_HYPERDRIVE', 'type': 'hyperdrive', 'id': 'synthetic-hyperdrive',
        })

    def test_non_database_worker_binding_stays_admissible_as_metadata_only(self):
        metadata = candidate()
        metadata['worker']['bindings'].append({
            'name': 'STAGING_LABEL', 'type': 'plain_text', 'text': 'synthetic',
        })
        outcome = evaluate(metadata)
        self.assertEqual(outcome['status'], 'METADATA_CANDIDATE_INDEPENDENT_EVIDENCE_REQUIRED')
        self.assertFalse(outcome['network_verified'])
        self.assertFalse(outcome['authorized_to_deploy'])
        self.assertFalse(outcome['production_release_qualified'])


if __name__ == '__main__':
    unittest.main()
