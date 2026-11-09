"""Focused negative controls for a one-use, owner-scoped, GET-only VPC audit."""
import json
import unittest
import vpc_service_filter_triage as m


def ok(rows, info=None):
    return {'http': 200, 'data': rows, 'info': info}


def page(rows, total=None):
    return ok(rows, {'page': 1, 'count': len(rows),
                     'per_page': 100, 'total_count': len(rows) if total is None else total,
                     'total_pages': 1 if total is None else (total + 99)//100})


def triple(all_, tcp, http):
    return {'all': all_, 'tcp': tcp, 'http': http}


class FilteredInventoryTests(unittest.TestCase):
    def test_empty_without_pagination_remains_unqualified(self):
        result=m.classify(triple(ok([]),ok([]),ok([])))
        self.assertEqual(result['classification'],'EMPTY_PAGES_PAGINATION_UNVERIFIED')
        self.assertIsNone(result['account_service_count'])
        self.assertFalse(result['private_path_verified'])

    def test_all_complete_empty_is_account_scoped_absence_not_private_proof(self):
        result=m.classify(triple(page([]),page([]),page([])))
        self.assertEqual(result['classification'],'EMPTY_SERVICE_CATALOG_OBSERVED')
        self.assertEqual(result['account_service_count'],0)
        self.assertFalse(result['private_path_verified'])

    def test_tcp_permission_denied_is_unknown_not_zero(self):
        result=m.classify(triple(page([]),{'http':403,'data':None,'info':None},page([])))
        self.assertEqual(result['classification'],'CATALOG_QUERY_UNAVAILABLE')
        self.assertEqual(result['http_statuses']['tcp'],403)
        self.assertIsNone(result['account_service_count'])

    def test_wrong_type_in_filtered_response_denied(self):
        row={'type':'http','name':'PRIVATE-NAME-DO-NOT-LOG','host':{'hostname':'private.example'}}
        result=m.classify(triple(ok([row]),ok([row]),ok([])))
        self.assertEqual(result['classification'],'FILTER_QUERY_MISMATCH')
        self.assertFalse(result['private_path_verified'])
        self.assertNotIn('PRIVATE-NAME-DO-NOT-LOG',json.dumps(result))

    def test_disjoint_paginated_type_lists_vs_unfiltered_are_conflict(self):
        tcp={'type':'tcp','tcp_port':5432,'app_protocol':'postgresql'}
        result=m.classify(triple(page([]),page([tcp]),page([])))
        self.assertEqual(result['classification'],'CATALOG_QUERY_CONFLICT')
        self.assertIsNone(result['account_service_count'])

    def test_present_service_is_not_network_validation_and_redacted(self):
        private={'type':'tcp','tcp_port':5432,'app_protocol':'postgresql',
                 'name':'DO-NOT-LOG-NAME','host':{'hostname':'private.aws.internal'},
                 'service_id':'SECRET-SERVICE-ID'}
        result=m.classify(triple(page([private]),page([private]),page([])))
        self.assertEqual(result['classification'],'CATALOG_ENTRIES_OBSERVED_NOT_CONNECTED')
        self.assertEqual(result['account_service_count'],1)
        self.assertEqual(result['observed_tcp_count'],1)
        self.assertFalse(result['private_path_verified'])
        blob=json.dumps(result)
        for secret in ('DO-NOT-LOG-NAME','private.aws.internal','SECRET-SERVICE-ID'):
            self.assertNotIn(secret,blob)

    def test_additional_pages_never_prove_account_total(self):
        tcp={'type':'tcp','tcp_port':5432}
        result=m.classify(triple(page([tcp],total=105),page([tcp]),page([])))
        self.assertEqual(result['classification'],'PAGINATION_UNVERIFIED')
        self.assertIsNone(result['account_service_count'])

    def test_incomplete_response_shapes_are_not_success(self):
        result=m.classify(triple({'http':200,'data':{'result':[]},'info':None},
                                 ok([]),ok([])))
        self.assertEqual(result['classification'],'CATALOG_QUERY_UNAVAILABLE')
        self.assertIsNone(result['account_service_count'])

    def test_run_uses_only_three_fixed_gets(self):
        calls=[]
        observations=triple(ok([]),ok([]),ok([]))
        names={path:name for name,path in m.PATHS.items()}
        def fixed_fetch(path,token):
            calls.append((path,token))
            return observations[names[path]]
        result=m.run('synthetic-test-token',fixed_fetch)
        self.assertEqual(calls,[(path,'synthetic-test-token') for path in m.PATHS.values()])
        self.assertEqual(result['requests'],3)
        self.assertEqual(result['cloudflare_writes'],0)
        self.assertEqual(result['neon_sql'],0)

    def test_missing_token_avoids_all_requests(self):
        with self.assertRaises(ValueError):
            m.run('',lambda *args: self.fail('unexpected request'))


if __name__=='__main__':
    unittest.main()
