"""Offline attacks on the two-request schema reader; never opens a socket."""
import contextlib
import copy
import importlib.util
import io
import json
import os
import sqlite3
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error


SOURCE = Path(__file__).resolve().parents[1] / 'qualification/cloudflare_customer_schema_readonly.py'


class SchemaReadOnly(unittest.TestCase):
    def run_subject(self, mutate=lambda data: None, exception=None, token='SYNTHETIC-TOKEN-ONLY'):
        spec = importlib.util.spec_from_file_location('schema_readonly', SOURCE)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        data = [
            {'success': True, 'result': {'uuid': module.DATABASE, 'name': module.DATABASE_NAME}},
            {'success': True, 'result': [{'success': True, 'meta': {'changes': 0, 'rows_written': 0},
                'results': [{'type': 'table', 'name': name, 'tbl_name': name,
                             'sql': "CREATE TABLE " + name + "(id TEXT DEFAULT 'PRIVATE-DDL-LITERAL')"}
                            for name in module.PARENTS]}]},
        ]
        mutate(data); calls, files = [], {}

        class Response:
            status = 200
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size): return json.dumps(self.payload).encode()[:size]

        class Opener:
            def open(self, request, timeout):
                calls.append(request)
                if exception and len(calls) == 2: raise exception
                return Response(data[len(calls)-1])

        class Sink:
            def __init__(self, name): self.name = name
            def __str__(self): return self.name
            def write_bytes(self, raw): files[self.name] = raw
            def write_text(self, text): files[self.name] = text

        output = io.StringIO()
        with patch.object(module.urllib.request, 'build_opener', return_value=Opener()), \
             patch.object(module, 'Path', Sink), patch.dict(os.environ, {'CLOUDFLARE_API_TOKEN': token}), \
             contextlib.redirect_stdout(output):
            rc = module.observe()
        self.assertNotIn('SYNTHETIC-TOKEN-ONLY', output.getvalue())
        self.assertNotIn('PRIVATE-DDL-LITERAL', output.getvalue())
        self.assertNotIn('PROVIDER-DETAIL-PRIVATE', output.getvalue())
        self.assertIn('customer-schema-readonly.json.sha256', files)
        for call in calls:
            self.assertTrue(call.full_url.startswith(module.API + module.DB_PATH))
        if len(calls) == 2:
            self.assertEqual(calls[1].get_method(), 'POST')
            self.assertEqual(calls[1].full_url, module.API + module.DB_PATH + '/query')
            self.assertEqual(json.loads(calls[1].data), {'sql': module.SQL, 'params': []})
        return rc, json.loads(files['customer-schema-readonly.json']), calls

    def assert_incomplete(self, mutate=lambda data: None, **kwargs):
        rc, result, calls = self.run_subject(mutate, **kwargs)
        self.assertEqual(rc, 1); self.assertEqual(result['status'], 'INCOMPLETE')
        self.assertFalse(result['hosted_migration_qualified']); self.assertFalse(result['release_authority'])
        self.assertEqual(result['objects'], [])
        return result, calls

    def test_exact_catalog_request_and_hashes_without_ddl_or_customer_rows(self):
        rc, result, calls = self.run_subject()
        self.assertEqual(rc, 0); self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].get_method(), 'GET')
        self.assertTrue(all(result['oauth_parent_presence'].values()))
        self.assertEqual(result['mutations'], 0); self.assertEqual(result['customer_records_read'], 0)
        self.assertFalse(result['backup_restore_qualified']); self.assertFalse(result['raw_ddl_disclosed'])

    def test_wrong_database_stops_before_sql(self):
        result, calls = self.assert_incomplete(lambda p: p[0]['result'].update(uuid='other'))
        self.assertEqual(len(calls), 1); self.assertEqual(result['query_count'], 0)

    def test_missing_token_stops_before_network(self):
        _, calls = self.assert_incomplete(token=''); self.assertEqual(calls, [])

    def test_write_metadata_cannot_qualify_read_only(self):
        result, _ = self.assert_incomplete(lambda p: p[1]['result'][0]['meta'].update(rows_written=1))
        self.assertIsNone(result['mutations']); self.assertEqual(result['query_rows_written'], 1)

    def test_missing_write_metadata_is_unknown(self):
        self.assert_incomplete(lambda p: p[1]['result'][0]['meta'].pop('rows_written'))

    def test_boolean_write_count_is_not_integer_zero(self):
        self.assert_incomplete(lambda p: p[1]['result'][0]['meta'].update(changes=False))

    def test_unsuccessful_query_is_preserved_as_incomplete(self):
        self.assert_incomplete(lambda p: p[1]['result'][0].update(success=False))

    def test_multiple_query_results_rejected(self):
        self.assert_incomplete(lambda p: p[1]['result'].append(copy.deepcopy(p[1]['result'][0])))

    def test_duplicate_object_rejected_without_partial_catalog(self):
        self.assert_incomplete(lambda p: p[1]['result'][0]['results'].append(copy.deepcopy(p[1]['result'][0]['results'][0])))

    def test_invalid_identifier_rejected(self):
        self.assert_incomplete(lambda p: p[1]['result'][0]['results'][0].update(name='https://foreign.example'))

    def test_extra_provider_field_rejected(self):
        self.assert_incomplete(lambda p: p[1]['result'][0]['results'][0].update(customer_record='PROVIDER-DETAIL-PRIVATE'))

    def test_redirect_refused_without_provider_body(self):
        error = urllib.error.HTTPError('https://foreign.example', 302, 'PROVIDER-DETAIL-PRIVATE', {}, None)
        result, calls = self.assert_incomplete(exception=error)
        self.assertEqual(result['transport'][-1]['http_status'], 302); self.assertEqual(len(calls), 2)

    def test_transport_detail_is_not_printed(self):
        self.assert_incomplete(exception=OSError('PROVIDER-DETAIL-PRIVATE'))

    def test_no_redirect_handler_never_follows_target(self):
        spec = importlib.util.spec_from_file_location('schema_redirect', SOURCE)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, None, None, 'https://foreign.example'))

    def test_real_sqlite_authorizer_allows_only_catalog_reads(self):
        spec = importlib.util.spec_from_file_location('schema_catalog_sql', SOURCE)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        db = sqlite3.connect(':memory:')
        try:
            db.executescript("CREATE TABLE customers(id TEXT); INSERT INTO customers VALUES('PRIVATE-ROW'); CREATE TABLE sqlitex_visible(id TEXT);")
            before = db.total_changes
            reads = []
            def authorize(action, a, b, *_):
                if action == sqlite3.SQLITE_SELECT: return sqlite3.SQLITE_OK
                if action == sqlite3.SQLITE_FUNCTION and b == 'glob': return sqlite3.SQLITE_OK
                if action == sqlite3.SQLITE_READ and a == 'sqlite_master':
                    reads.append((a,b)); return sqlite3.SQLITE_OK
                return sqlite3.SQLITE_DENY
            db.set_authorizer(authorize)
            rows = db.execute(module.SQL).fetchall()
            self.assertTrue(reads); self.assertEqual(db.total_changes, before)
            self.assertEqual({row[1] for row in rows}, {'customers', 'sqlitex_visible'})
            self.assertNotIn('PRIVATE-ROW', str(rows))
            with self.assertRaises(sqlite3.DatabaseError): db.execute('SELECT * FROM customers').fetchall()
        finally: db.close()


if __name__ == '__main__': unittest.main()
