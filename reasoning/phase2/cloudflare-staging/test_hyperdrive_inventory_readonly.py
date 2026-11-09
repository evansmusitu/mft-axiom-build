"""Pure offline negative controls for the credentialed GET-only inspection."""
import json
import unittest

import hyperdrive_inventory_readonly as m


def fake_rows(**updates):
    info = {'page': 1, 'total_pages': 1, 'count': 0}
    rows = {
        'domains': {'http': 200, 'data': [{'hostname': m.STAGE_HOST, 'service': m.STAGE_WORKER}]},
        'stage_worker': {'http': 200, 'data': {'bindings': []}},
        'phase2_worker': {'http': 404, 'data': None},
        'hyperdrive': {'http': 200, 'data': [], 'info': info},
    }
    rows.update(updates)
    return rows


class QualificationTests(unittest.TestCase):
    def test_zero_deployed_bindings_is_not_private_or_database_proof(self):
        row = m.summarize(fake_rows())
        self.assertEqual(row['classification'], 'NO_HYPERDRIVE_BINDING_ON_LIVE_DOMAIN_AND_PHASE2_WORKERS')
        self.assertFalse(row['private_network_verified'])
        self.assertFalse(row['staging_connection_qualified'])
        self.assertEqual(row['hyperdrive_config_count'], 0)

    def test_existing_hyperdrive_binding_is_not_connectivity_proof(self):
        row = m.summarize(fake_rows(stage_worker={'http': 200, 'data': {'bindings': [{'name': 'HYPERDRIVE', 'type': 'hyperdrive', 'id': 'fake-a'}]}},
            hyperdrive={'http': 200, 'data': [{'id': 'fake-a', 'origin': {'host': m.NEON_HOST, 'password': 'SHOULD_NEVER_LEAK'}}],
                        'info': {'page': 1, 'total_pages': 1, 'count': 1}}))
        self.assertEqual(row['classification'], 'HYPERDRIVE_BINDING_PRESENT_BUT_CONNECTIVITY_UNQUALIFIED')
        self.assertEqual(row['configured_neon_host_match_count'], 1)
        self.assertNotIn('SHOULD_NEVER_LEAK', json.dumps(row))
        self.assertNotIn('fake-a', json.dumps(row))
        self.assertFalse(row['staging_connection_qualified'])

    def test_hyperdrive_403_is_unknown_not_zero(self):
        row = m.summarize(fake_rows(hyperdrive={'http': 403, 'data': None, 'info': None}))
        self.assertIsNone(row['hyperdrive_config_count'])
        self.assertFalse(row['hyperdrive_inventory_complete'])
        self.assertEqual(row['provider_http_status']['hyperdrive'], 403)

    def test_unpaginated_hyperdrive_list_is_not_complete(self):
        row = m.summarize(fake_rows(hyperdrive={'http': 200, 'data': [], 'info': None}))
        self.assertFalse(row['hyperdrive_inventory_complete'])
        self.assertIsNone(row['hyperdrive_config_count'])

    def test_wrong_domain_mapping_refuses_no_binding_conclusion(self):
        row = m.summarize(fake_rows(domains={'http': 200, 'data': [{'hostname': m.STAGE_HOST, 'service': 'another-worker'}]}))
        self.assertEqual(row['classification'], 'INSUFFICIENT_METADATA_TO_CLASSIFY_BINDINGS')

    def test_invalid_worker_bindings_are_unknown(self):
        row = m.summarize(fake_rows(stage_worker={'http': 200, 'data': {'bindings': None}}))
        self.assertIsNone(row['stage_worker_binding_count'])
        self.assertEqual(row['classification'], 'INSUFFICIENT_METADATA_TO_CLASSIFY_BINDINGS')

    def test_only_four_fixed_get_paths(self):
        got = []
        rows = fake_rows()
        rev = {p: label for label, p in m.PATHS.items()}
        def fetch(p, token):
            got.append((p, token))
            return rows[rev[p]]
        out = m.run('fake-test-token', fetch=fetch)
        self.assertEqual([p for p, _ in got], list(m.PATHS.values()))
        self.assertEqual(out['methods'], ['GET'])
        self.assertEqual(out['cloudflare_writes'], 0)
        self.assertEqual(out['neon_sql_queries'], 0)

    def test_missing_token_does_not_make_network_request(self):
        def should_not_fetch(*args):
            raise AssertionError('network should never be called')
        with self.assertRaises(RuntimeError):
            m.run('', fetch=should_not_fetch)

    def test_actual_domain_attached_worker_must_be_checked_even_when_legacy_name_drifts(self):
        name = 'observed-stage-service'
        path = f'/accounts/{m.ACCOUNT}/workers/scripts/{name}/settings'
        rows = fake_rows(domains={'http': 200, 'data': [{'hostname': m.STAGE_HOST, 'service': name}]})
        rows[path] = {'http': 200, 'data': {'bindings': []}}
        labels = {p: label for label, p in m.PATHS.items()}
        seen = []
        def fetch(p, token):
            seen.append(p)
            return rows[p] if p == path else rows[labels[p]]
        row = m.run('fake-test-token', fetch=fetch)
        self.assertIn(path, seen)
        self.assertEqual(row['attached_worker_binding_count'], 0)
        self.assertEqual(row['classification'], 'NO_HYPERDRIVE_BINDING_ON_LIVE_DOMAIN_AND_PHASE2_WORKERS')

    def test_malicious_attached_worker_service_is_not_queried(self):
        rows = fake_rows(domains={'http': 200, 'data': [
            {'hostname': m.STAGE_HOST, 'service': '../secrets'}]})
        labels = {p: label for label, p in m.PATHS.items()}
        seen = []
        def fetch(p, token):
            seen.append(p)
            return rows[labels[p]]
        row = m.run('fake-test-token', fetch=fetch)
        self.assertEqual(len(seen), 4)
        self.assertIsNone(row['attached_worker_binding_count'])
        self.assertEqual(row['classification'], 'INSUFFICIENT_METADATA_TO_CLASSIFY_BINDINGS')

    def test_unknown_token_or_network_status_is_not_ok(self):
        row = m.summarize(fake_rows(stage_worker={'http': 'NETWORK_ERROR', 'data': None},
                                    phase2_worker={'http': 'NETWORK_ERROR', 'data': None}))
        self.assertEqual(row['classification'], 'INSUFFICIENT_METADATA_TO_CLASSIFY_BINDINGS')


if __name__ == '__main__':
    unittest.main()
