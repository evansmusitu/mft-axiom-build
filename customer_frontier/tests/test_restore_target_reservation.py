"""Synthetic provider only; all requests intercepted, no account changes."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

SOURCE = Path(__file__).resolve().parents[1] / 'qualification/reserve_customer_restore_target.py'


class RestoreTarget(unittest.TestCase):
    def run_subject(self, mutate=lambda data: None, create_exception=None, token='SYNTHETIC-ONLY', run_id='12345678901'):
        spec = importlib.util.spec_from_file_location('reserve_target', SOURCE)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        target = 'axiom-customer-restore-20261106-' + run_id
        new_id = '77777777-7777-4777-8777-777777777777'
        rows = [{'uuid': key, 'name': name} for key, name in module.KNOWN.items()]
        data = {module.LIST: {'success': True, 'result': rows, 'result_info': {'page': 1, 'count': 2, 'per_page': 100, 'total_count': 2}},
                'CREATE': {'success': True, 'result': {'uuid': new_id, 'name': target}},
                module.BASE + '/' + new_id: {'success': True, 'result': {'uuid': new_id, 'name': target, 'file_size': 16384, 'num_tables': 0}}}
        for row in rows:
            data[module.BASE + '/' + row['uuid']] = {'success': True, 'result': {**row, 'file_size': 1024, 'num_tables': 1}}
        mutate(data); calls, files = [], {}

        class Response:
            status = 200
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size): return json.dumps(self.payload).encode()[:size]

        class Opener:
            def open(self, req, timeout):
                calls.append(req)
                key = 'CREATE' if req.get_method() == 'POST' else req.full_url[len(module.API):]
                if key == 'CREATE' and create_exception: raise create_exception
                return Response(data[key])

        class Sink:
            def __init__(self, name): self.name = name
            def __str__(self): return self.name
            def write_bytes(self, raw): files[self.name] = raw
            def write_text(self, raw): files[self.name] = raw

        output = io.StringIO()
        with patch.object(module.urllib.request, 'build_opener', return_value=Opener()), \
             patch.object(module, 'Path', Sink), patch.dict(os.environ, {'CLOUDFLARE_API_TOKEN': token, 'GITHUB_RUN_ID': run_id}), \
             contextlib.redirect_stdout(output):
            rc = module.reserve()
        self.assertNotIn('SYNTHETIC-ONLY', output.getvalue())
        self.assertNotIn('PRIVATE-PROVIDER-DETAIL', output.getvalue())
        posts = [r for r in calls if r.get_method() == 'POST']
        self.assertLessEqual(len(posts), 1)
        self.assertTrue(all(r.get_method() in ['GET', 'POST'] and r.full_url.startswith(module.API + '/d1/database') for r in calls))
        if posts:
            self.assertEqual(posts[0].full_url, module.API + module.BASE)
            self.assertEqual(json.loads(posts[0].data), {'name': target})
        result = json.loads(files['customer-restore-target-reservation.json'])
        self.assertFalse(result['hosted_migration_qualified']); self.assertFalse(result['release_authority'])
        self.assertEqual(result['sql_queries'], 0); self.assertEqual(result['existing_resource_mutations'], 0)
        return rc, result, calls

    def assert_stopped(self, mutate=lambda data: None, **kwargs):
        rc, result, calls = self.run_subject(mutate, **kwargs)
        self.assertEqual(rc, 1); self.assertFalse(result['empty_target_verified'])
        return result, calls

    def test_one_empty_target_created_after_complete_identity_storage_preflight(self):
        rc, result, calls = self.run_subject()
        self.assertEqual(rc, 0); self.assertEqual(result['status'], 'EMPTY_RESTORE_TARGET_RESERVED')
        self.assertEqual(result['initial_total_storage_bytes'], 2048)
        self.assertEqual(result['resource_creations'], 1); self.assertEqual(result['creation_attempts'], 1)
        self.assertFalse(result['backup_restore_qualified']); self.assertEqual(len(calls), 5)

    def test_provider_capacity_rejection_retained_and_never_retried(self):
        body = io.BytesIO(json.dumps({'success': False, 'errors': [{'code': 7406, 'message': 'PRIVATE-PROVIDER-DETAIL'}]}).encode())
        error = urllib.error.HTTPError('https://api.cloudflare.com', 400, 'PRIVATE-PROVIDER-DETAIL', {}, body)
        result, calls = self.assert_stopped(create_exception=error)
        self.assertEqual(result['status'], 'RESTORE_TARGET_RESERVATION_REJECTED')
        self.assertEqual(result['resource_creations'], 0)
        self.assertEqual(result['transport'][-1]['provider_error_codes'], [7406])
        self.assertEqual(len(calls), 4)

    def test_ambiguous_timeout_is_unknown_and_never_retried(self):
        result, calls = self.assert_stopped(create_exception=OSError('PRIVATE-PROVIDER-DETAIL'))
        self.assertIsNone(result['resource_creations']); self.assertEqual(result['creation_state'], 'UNKNOWN')
        self.assertEqual(len(calls), 4)

    def test_missing_token_has_no_network(self):
        _, calls = self.assert_stopped(token=''); self.assertEqual(calls, [])

    def test_untrusted_run_marker_has_no_network(self):
        _, calls = self.assert_stopped(run_id='../other'); self.assertEqual(calls, [])

    def test_incomplete_inventory_stops_before_creation(self):
        result, calls = self.assert_stopped(lambda d: d['/d1/database?per_page=100&page=1']['result_info'].update(total_count=3))
        self.assertEqual(result['creation_attempts'], 0); self.assertEqual(len(calls), 1)

    def test_boolean_pagination_is_not_a_count(self):
        result, _ = self.assert_stopped(lambda d: d['/d1/database?per_page=100&page=1']['result_info'].update(page=True))
        self.assertEqual(result['creation_attempts'], 0)

    def test_duplicate_database_identity_is_rejected(self):
        def mutate(d):
            d['/d1/database?per_page=100&page=1']['result'][1] = copy.deepcopy(d['/d1/database?per_page=100&page=1']['result'][0])
        result, _ = self.assert_stopped(mutate); self.assertEqual(result['creation_attempts'], 0)

    def test_preexisting_target_never_adopted(self):
        result, _ = self.assert_stopped(lambda d: d['/d1/database?per_page=100&page=1']['result'][0].update(name='axiom-customer-restore-20261106-12345678901'))
        self.assertEqual(result['creation_attempts'], 0)

    def test_known_database_name_drift_stops(self):
        result, _ = self.assert_stopped(lambda d: d['/d1/database?per_page=100&page=1']['result'][0].update(name='other'))
        self.assertEqual(result['creation_attempts'], 0)

    def test_unknown_storage_stops_before_creation(self):
        result, _ = self.assert_stopped(lambda d: d['/d1/database/a7384b8a-0751-4705-ac77-0616b0885e7c']['result'].pop('file_size'))
        self.assertEqual(result['creation_attempts'], 0)

    def test_excess_storage_stops_before_creation(self):
        result, _ = self.assert_stopped(lambda d: d['/d1/database/a7384b8a-0751-4705-ac77-0616b0885e7c']['result'].update(file_size=64*1024*1024+1))
        self.assertEqual(result['creation_attempts'], 0)

    def test_nonempty_new_target_not_admitted_or_deleted(self):
        result, _ = self.assert_stopped(lambda d: d['/d1/database/77777777-7777-4777-8777-777777777777']['result'].update(num_tables=1))
        self.assertEqual(result['resource_creations'], 1); self.assertEqual(result['creation_state'], 'CREATED')

    def test_existing_uuid_returned_from_create_is_unknown(self):
        result, _ = self.assert_stopped(lambda d: d['CREATE']['result'].update(uuid='a7384b8a-0751-4705-ac77-0616b0885e7c'))
        self.assertIsNone(result['resource_creations']); self.assertEqual(result['creation_state'], 'UNKNOWN')


if __name__ == '__main__': unittest.main()
