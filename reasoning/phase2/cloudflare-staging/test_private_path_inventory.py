import json
import unittest
import private_path_inventory as m


def response(rows, *, code=200, page=1, pages=1, count=None):
    return {'http':code,'data':rows if code==200 else None,
            'info': {'page':page,'total_pages':pages,'count':len(rows) if count is None else count,
                     'total_count':len(rows)} if code==200 else None}

class TestReadOnlyPath(unittest.TestCase):
    def test_complete_empty_account_is_absence_only_in_checked_account(self):
        x=m.summarize({'services':response([]), 'tunnels':response([])})
        self.assertEqual(x['classification'],'NO_PRIVATE_CONNECTIVITY_RESOURCES_IN_CHECKED_ACCOUNT')
        self.assertTrue(x['services_complete'])
        self.assertTrue(x['tunnels_complete'])
        self.assertEqual(x['service_count'],0)
        self.assertFalse(x['private_path_verified'])
    def test_missing_token_never_attempts_network(self):
        with self.assertRaises(ValueError):
            m.run('', lambda *args: self.fail('must not fetch'))
    def test_403_is_unknown_not_empty(self):
        x=m.summarize({'services':response([],code=403), 'tunnels':response([])})
        self.assertEqual(x['classification'],'PRIVATE_NETWORK_INVENTORY_INCOMPLETE')
        self.assertIsNone(x['service_count'])
        self.assertEqual(x['http_statuses']['services'],403)
    def test_multipage_is_unknown_not_complete(self):
        x=m.summarize({'services':response([{'type':'tcp','app_protocol':'postgresql'}],pages=2), 'tunnels':response([])})
        self.assertFalse(x['services_complete'])
        self.assertEqual(x['services_incomplete_reason'],'MULTIPAGE_OR_TOTAL_MISMATCH')
        self.assertIsNone(x['service_count'])
        self.assertEqual(x['classification'],'PRIVATE_NETWORK_INVENTORY_INCOMPLETE')
    def test_present_tunnel_and_postgres_service_not_proof(self):
        x=m.summarize({'services':response([{'type':'tcp','tcp_port':5432,'app_protocol':'postgresql','host':{'hostname':'private.internal','network':{'tunnel_id':'SECRET-TUNNEL'}},'name':'secret-service'}]),
            'tunnels':response([{'id':'SECRET-TUNNEL','name':'private-account-tunnel','status':'healthy','tun_type':'cfd_tunnel'}])})
        self.assertEqual(x['classification'],'PRIVATE_CONNECTIVITY_CANDIDATES_EXIST_UNVERIFIED')
        self.assertEqual(x['postgres_vpc_service_count'],1)
        self.assertEqual(x['healthy_tunnel_count'],1)
        self.assertFalse(x['private_path_verified'])
        self.assertNotIn('SECRET-TUNNEL',json.dumps(x))
        self.assertNotIn('private.internal',json.dumps(x))
        self.assertNotIn('secret-service',json.dumps(x))
    def test_incomplete_or_invalid_entry_never_leaks_raw(self):
        x=m.summarize({'services':response([{'type':'secret','name':'DO_NOT_LEAK'}]),'tunnels':response([])})
        self.assertEqual(x['classification'],'PRIVATE_NETWORK_INVENTORY_INCOMPLETE')
        self.assertNotIn('DO_NOT_LEAK',json.dumps(x))
    def test_exact_two_allowlisted_gets(self):
        calls=[]
        data={'services':response([]),'tunnels':response([])}
        paths={v:k for k,v in m.PATHS.items()}
        def mock(path,token):
            calls.append((path,token));return data[paths[path]]
        m.run('fake-credentials',mock)
        self.assertEqual(calls,[(p,'fake-credentials') for p in m.PATHS.values()])
        self.assertEqual(len(calls),2)
    def test_tls_weakened_postgres_service_not_accepted(self):
        services=[{'type':'tcp','tcp_port':5432,'app_protocol':'postgresql','tls_settings':{'cert_verification_mode':'disabled'},'host':{'network':{'tunnel_id':'x'}}}]
        x=m.summarize({'services':response(services),'tunnels':response([])})
        self.assertEqual(x['insecure_tls_postgres_service_count'],1)
        self.assertFalse(x['private_path_verified'])
    def test_missing_pagination_never_proves_zero(self):
        x=m.summarize({'services':{'http':200,'data':[],'info':None},'tunnels':response([])})
        self.assertIsNone(x['service_count'])
        self.assertEqual(x['classification'],'PRIVATE_NETWORK_INVENTORY_INCOMPLETE')
        self.assertEqual(x['services_incomplete_reason'],'PAGINATION_MISSING')


    def test_no_healthy_tunnel_with_incomplete_service_catalog_denies_qualification(self):
        tunnels = [{'tun_type':'cfd_tunnel','status':'inactive'},
                   {'tun_type':'cfd_tunnel','status':'down'}]
        summary = m.summarize({'services':{'http':200,'data':[],'info':None},
                               'tunnels':response(tunnels)})
        self.assertEqual(summary.get('blocking_reasons'), [
            'VPC_SERVICE_INVENTORY_UNVERIFIED',
            'NO_HEALTHY_TUNNEL_REPORTED',
            'PRIVATE_ORIGIN_REACHABILITY_UNVERIFIED'])
        self.assertFalse(summary['private_path_verified'])

    def test_weak_and_unknown_tls_modes_are_denied_not_accepted_as_safe(self):
        services = [{'type':'tcp','tcp_port':5432,'app_protocol':'postgresql',
                     'tls_settings':{'cert_verification_mode':'disabled'}},
                    {'type':'tcp','tcp_port':5432,'app_protocol':'postgresql',
                     'tls_settings':{'cert_verification_mode':'unrecognized'}}]
        summary=m.summarize({'services':response(services),'tunnels':response([
            {'tun_type':'cfd_tunnel','status':'healthy'}])})
        self.assertEqual(summary.get('postgres_vpc_service_non_strict_tls_count'), 2)
        self.assertIn('POSTGRES_VPC_TLS_NOT_STRICT',summary.get('blocking_reasons',[]))
        self.assertFalse(summary['private_path_verified'])

    def test_documented_omitted_tls_defaults_to_verify_full_but_requires_live_evidence(self):
        services=[{'type':'tcp','tcp_port':5432,'app_protocol':'postgresql'}]
        summary=m.summarize({'services':response(services),'tunnels':response([
            {'tun_type':'cfd_tunnel','status':'healthy'}])})
        self.assertEqual(summary.get('postgres_vpc_service_non_strict_tls_count'), 0)
        self.assertIn('PRIVATE_ORIGIN_REACHABILITY_UNVERIFIED',summary.get('blocking_reasons',[]))
        self.assertFalse(summary['private_path_verified'])

    def test_missing_postgres_service_and_tunnel_inventory_get_explicit_blockers(self):
        services=[{'type':'http','http_port':443}]
        summary=m.summarize({'services':response(services),
                             'tunnels':{'http':403,'data':None,'info':None}})
        self.assertEqual(summary.get('blocking_reasons'), [
            'TUNNEL_INVENTORY_UNVERIFIED',
            'NO_POSTGRES_VPC_SERVICE_IN_CHECKED_ACCOUNT',
            'PRIVATE_ORIGIN_REACHABILITY_UNVERIFIED'])
        self.assertFalse(summary['private_path_verified'])

if __name__=='__main__': unittest.main()
