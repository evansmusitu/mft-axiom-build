"""Synthetic transport tests for manual-only hosted D1 read-only staging probe."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from qualification import probe_connect_hosted_d1 as probe


class FakeResponse:
    def __init__(self, payload, status=200):
        self.status = status
        self.data = json.dumps(payload).encode('utf-8')

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, size=-1):
        return self.data[:size]


def config():
    return {
        'MUSITU_CF_STAGING_ACCOUNT_ID': 'a' * 32,
        'MUSITU_CF_PRODUCTION_ACCOUNT_ID': 'b' * 32,
        'MUSITU_CF_STAGING_DATABASE_ID': 'a4e76671-c955-4b4c-bc48-4bf27aee3204',
        'MUSITU_CF_STAGING_DATABASE_NAME': 'musitu-connect-stage-operator-probe',
        'MUSITU_CF_STAGING_READ_TOKEN': 'SYNTHETIC_TOKEN_ONLY_0123456789',
    }


class HostedD1ReadOnlyTests(unittest.TestCase):
    def test_only_separately_scoped_staging_target_is_accepted(self):
        for edit in (
            {'MUSITU_CF_PRODUCTION_ACCOUNT_ID': 'a' * 32},
            {'MUSITU_CF_PRODUCTION_ACCOUNT_ID': ''},
            {'MUSITU_CF_STAGING_ACCOUNT_ID': 'INVALID'},
            {'MUSITU_CF_STAGING_DATABASE_NAME': 'musitu-connect-production'},
            {'MUSITU_CF_STAGING_DATABASE_NAME': 'musitu-connect-stage-PROD'},
            {'MUSITU_CF_STAGING_DATABASE_ID': 'not-uuid'},
            {'MUSITU_CF_STAGING_READ_TOKEN': ''},
        ):
            with self.subTest(edit=edit):
                values = config()
                values.update(edit)
                with self.assertRaises(probe.ProbeError):
                    probe.load_config(values)
        self.assertEqual(probe.load_config(config())['database_name'],
                         config()['MUSITU_CF_STAGING_DATABASE_NAME'])

    def test_provider_metadata_and_schema_bounded_and_no_customer_admission(self):
        cfg = probe.load_config(config())
        source_objects = probe.local_schema_objects()
        calls = []

        def transport(req, timeout):
            calls.append((req.get_method(), req.full_url, req.data))
            if req.get_method() == 'GET':
                return FakeResponse({'success': True, 'result': {
                    'name': cfg['database_name'], 'uuid': cfg['database_id'],
                    'version': 'production'}})
            query = json.loads(req.data)['sql']
            if 'sqlite_schema' in query:
                results = [{'type': kind, 'name': name, 'sql': sql}
                           for (kind, name), sql in source_objects.items()]
            else:
                results = [{'tenants': 0, 'credentials': 0, 'usage_events': 0,
                            'daily_usage': 0, 'minute_usage': 0}]
            return FakeResponse({'success': True, 'result': [{
                'success': True, 'meta': {'rows_written': 0, 'changes': 0,
                                         'changed_db': False},
                'results': results
            }]})

        evidence = probe.run_probe(cfg, transport=transport)
        self.assertEqual([v[0] for v in calls], ['GET', 'POST', 'POST'])
        self.assertEqual(len(calls), 3)
        self.assertTrue(all('api.cloudflare.com/client/v4/accounts/' in v[1] for v in calls))
        request_json = json.loads(calls[1][2])
        self.assertEqual(set(request_json), {'sql', 'params'})
        self.assertEqual(request_json['params'], [])
        self.assertTrue(json.loads(calls[2][2])['sql'].startswith('SELECT '))
        self.assertNotIn('sqlite_schema', json.loads(calls[2][2])['sql'])
        self.assertTrue(request_json['sql'].startswith('SELECT '))
        self.assertNotIn('INSERT', request_json['sql'])
        self.assertTrue(evidence['staging_database_identity_verified'])
        self.assertFalse(evidence['staging_account_isolation_independently_verified'])
        self.assertFalse(evidence['staging_read_token_scope_independently_verified'])
        self.assertFalse(evidence['hosted_transactional_qualification'])
        self.assertFalse(evidence['production_customer_admission'])
        self.assertTrue(evidence['hosted_schema_matches_source'])
        self.assertTrue(evidence['staging_customer_tables_empty_at_read_time'])
        self.assertFalse(evidence['cross_region_customer_data_absence_verified'])
        self.assertEqual(evidence['schema_objects_checked'], 9)
        self.assertFalse(evidence['hosted_concurrency_qualified'])
        self.assertFalse(evidence['commercial_ga_enabled'])
        self.assertFalse(evidence['customer_admission_enabled'])
        for private in (cfg['account_id'], cfg['database_id'], cfg['token']):
            self.assertNotIn(private, json.dumps(evidence))

    def test_schema_drift_or_provider_write_metadata_denied(self):
        cfg = probe.load_config(config())
        for mutation in ('missing_trigger', 'changed_trigger', 'write_detected'):
            with self.subTest(mutation=mutation):
                objects = probe.local_schema_objects()
                rows = [{'type': k[0], 'name': k[1], 'sql': v}
                        for k, v in objects.items()]
                if mutation == 'missing_trigger':
                    rows.pop()
                if mutation == 'changed_trigger':
                    rows[-1]['sql'] = rows[-1]['sql'].replace(
                        'CUSTOMER_USAGE_EVENT_IMMUTABLE', 'ALLOW_DELETION')
                meta = {'changes': 1 if mutation == 'write_detected' else 0,
                        'rows_written': 0}

                def transport(req, timeout):
                    if req.get_method() == 'GET':
                        return FakeResponse({'success': True, 'result': {
                            'name': cfg['database_name'], 'uuid': cfg['database_id']}})
                    return FakeResponse({'success': True, 'result': [{
                        'success': True, 'meta': meta, 'results': rows}]})

                with self.assertRaises(probe.ProbeError):
                    probe.run_probe(cfg, transport=transport)

    def test_provider_changed_db_signal_must_not_be_ignored(self):
        """No green evidence if Cloudflare reports any database alteration."""
        cfg = probe.load_config(config())
        objects = probe.local_schema_objects()
        rows = [{'type': kind, 'name': name, 'sql': ddl}
                for (kind, name), ddl in objects.items()]
        for flag in (True, 1, 'false', None, 'MISSING'):
            with self.subTest(changed_db=repr(flag)):
                def transport(req, timeout):
                    if req.get_method() == 'GET':
                        return FakeResponse({'success': True, 'result': {
                            'uuid': cfg['database_id'], 'name': cfg['database_name']}})
                    return FakeResponse({'success': True, 'result': [{
                        'success': True,
                        'meta': ({'changes': 0, 'rows_written': 0}
                                 if flag == 'MISSING' else
                                 {'changes': 0, 'rows_written': 0, 'changed_db': flag}),
                        'results': rows,
                    }]})
                with self.assertRaises(probe.ProbeError):
                    probe.run_probe(cfg, transport=transport)

    def test_nonempty_staging_customer_registry_refuses_observation(self):
        """Schema equality alone must not qualify a DB holding customer rows."""
        cfg = probe.load_config(config())
        objects = probe.local_schema_objects()
        schema_rows = [{'type': k[0], 'name': k[1], 'sql': v}
                       for k, v in objects.items()]
        count_keys = ('tenants', 'credentials', 'usage_events', 'daily_usage',
                      'minute_usage')
        for nonempty in count_keys:
            with self.subTest(nonempty=nonempty):
                calls = []
                counts = {k: 0 for k in count_keys}
                counts[nonempty] = 1
                def transport(req, timeout):
                    calls.append(req.get_method())
                    if req.get_method() == 'GET':
                        return FakeResponse({'success': True, 'result': {
                            'name': cfg['database_name'], 'uuid': cfg['database_id']}})
                    query = json.loads(req.data)['sql']
                    if 'sqlite_schema' in query:
                        rows = schema_rows
                    else:
                        rows = [counts]
                    return FakeResponse({'success': True, 'result': [{
                        'success': True,
                        'meta': {'changes': 0, 'rows_written': 0,
                                 'changed_db': False},
                        'results': rows,
                    }]})
                with self.assertRaises(probe.ProbeError):
                    probe.run_probe(cfg, transport=transport)

    def test_wrong_remote_identity_is_rejected_before_sql(self):
        cfg = probe.load_config(config())
        calls = []

        def transport(req, timeout):
            calls.append(req.get_method())
            return FakeResponse({'success': True, 'result': {
                'name': 'musitu-connect-prod', 'uuid': cfg['database_id']}})

        with self.assertRaises(probe.ProbeError):
            probe.run_probe(cfg, transport=transport)
        self.assertEqual(calls, ['GET'])

    def test_untrusted_provider_float_overflow_is_not_accepted_as_metadata(self):
        """1e999 may not silently parse to infinity in a provider response."""
        import urllib.request

        class OverflowResponse:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, size=-1):
                return b'{"success":true,"result":{},"ignored":1e999}'

        request = urllib.request.Request('https://api.cloudflare.com/client/v4/test', method='GET')
        with self.assertRaisesRegex(probe.ProbeError, 'PROVIDER_RESPONSE_UNTRUSTED'):
            probe._request_json(request, transport=lambda *_args, **_kwargs: OverflowResponse())

    def test_reports_exclusively_without_identifier_disclosure(self):
        with TemporaryDirectory() as td:
            output = Path(td) / 'proof.json'
            proof = {'schema': 'musitu.connect.hosted_d1_readonly_probe.v1',
                     'hosted_concurrency_qualified': False,
                     'commercial_ga_enabled': False}
            probe.write_report(output, proof)
            with self.assertRaises(FileExistsError):
                probe.write_report(output, proof)
            self.assertEqual(json.loads(output.read_text()), proof)

    def test_github_workflow_is_manual_only_and_never_deploys(self):
        wf = (Path(__file__).resolve().parents[2] /
              '.github/workflows/musitu-connect-hosted-d1-readonly.yml').read_text()
        trigger = wf.split('\non:\n', 1)[1].split('\npermissions:', 1)[0]
        self.assertIn('workflow_dispatch:', trigger)
        self.assertIn("if: github.ref == 'refs/heads/main'", wf)
        self.assertNotIn('push:', trigger)
        self.assertNotIn('pull_request:', trigger)
        self.assertIn('python qualification/probe_connect_hosted_d1.py', wf)
        self.assertNotIn('wrangler', wf)
        self.assertNotIn('CLOUDFLARE_API_TOKEN', wf)
        self.assertNotIn('deploy', wf.lower())
        ci = (Path(__file__).resolve().parents[2] /
              '.github/workflows/connect-d1-readonly-regression.yml').read_text()
        for protected_path in (
            '.github/workflows/musitu-connect-hosted-d1-readonly.yml',
            'docs/operations/musitu-connect-hosted-d1-readonly.md',
        ):
            self.assertEqual(ci.count("'"+protected_path+"'"), 2,
                             'CI must cover changes to this staging safety-critical path')


if __name__ == '__main__':
    unittest.main()
