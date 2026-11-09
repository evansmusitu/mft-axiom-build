"""Synthetic metadata only: tests for a non-promoting private origin gate."""
import json
import unittest
from private_origin_admission import evaluate


def evidence():
    return {
        'neon': {
            'id': 'royal-grass-27046609', 'region_id': 'aws-us-east-2',
            'settings': {'block_public_connections': True, 'block_vpc_connections': False},
            'branch_protected': True,
            'databases': ['axiom_phase2_stage'],
            'roles': ['neondb_owner', 'axiom_phase2_stage_runtime'],
        },
        'tunnel': {'id': 'tunnel-synthetic-123', 'status': 'healthy', 'tun_type': 'cfd_tunnel'},
        'service': {
            'service_id': 'service-synthetic-123', 'type': 'tcp', 'app_protocol': 'postgresql',
            'tcp_port': 5432,
            'host': {'hostname': 'db.aws.internal', 'resolver_network': {'tunnel_id': 'tunnel-synthetic-123'}},
            'tls_settings': {'cert_verification_mode': 'verify_full'},
        },
        'hyperdrive': {
            'id': 'hd-synthetic-123', 'caching': {'disabled': True},
            'origin': {'service_id': 'service-synthetic-123', 'database': 'axiom_phase2_stage',
                       'user': 'axiom_phase2_stage_runtime', 'scheme': 'postgres'},
            'origin_connection_limit': 10,
        },
        'worker': {'name': 'axiom-phase2-staging-db-preflight',
                   'bindings': [{'name': 'HYPERDRIVE', 'type': 'hyperdrive', 'id': 'hd-synthetic-123'}]},
    }


class AdmissionTests(unittest.TestCase):
    def result(self, inp):
        return evaluate(inp)

    def test_complete_synthetic_metadata_never_grants_connectivity_or_release(self):
        out = self.result(evidence())
        self.assertEqual(out['status'], 'METADATA_CANDIDATE_INDEPENDENT_EVIDENCE_REQUIRED')
        self.assertEqual(out['blocking_reasons'], ['LIVE_PRIVATE_TLS_HANDSHAKE_UNVERIFIED',
                                                   'RUNTIME_SQL_PRIVILEGES_UNVERIFIED',
                                                   'LEDGER_SPEND_SECURITY_UNVERIFIED'])
        self.assertFalse(out['network_verified'])
        self.assertFalse(out['authorized_to_deploy'])
        self.assertFalse(out['production_release_qualified'])

    def test_current_actual_missing_resources_are_no_go(self):
        data=evidence()
        data['tunnel']=None
        data['service']=None
        data['hyperdrive']=None
        data['worker']['bindings']=[]
        data['neon']['roles']=['neondb_owner']
        out=self.result(data)
        self.assertEqual(out['status'], 'METADATA_SECURITY_GATE_BLOCKED')
        self.assertIn('TUNNEL_NOT_HEALTHY_OR_MISSING', out['blocking_reasons'])
        self.assertIn('VPC_SERVICE_NOT_APPROVED', out['blocking_reasons'])
        self.assertIn('HYPERDRIVE_NOT_PRIVATE_OR_CACHE_ENABLED', out['blocking_reasons'])
        self.assertIn('RUNTIME_ROLE_NOT_PROVISIONED', out['blocking_reasons'])

    def test_public_neon_access_never_accepted(self):
        data=evidence(); data['neon']['settings']['block_public_connections']=False
        self.assertIn('NEON_NETWORK_SECURITY_INVALID', self.result(data)['blocking_reasons'])

    def test_project_or_branch_mismatch_denied(self):
        data=evidence();data['neon']['id']='different-project';data['neon']['branch_protected']=False
        out=self.result(data)
        self.assertIn('NEON_IDENTITY_OR_BRANCH_MISMATCH', out['blocking_reasons'])

    def test_runtime_role_owner_never_accepted(self):
        data=evidence(); data['hyperdrive']['origin']['user']='neondb_owner'
        self.assertIn('HYPERDRIVE_NOT_PRIVATE_OR_CACHE_ENABLED', self.result(data)['blocking_reasons'])

    def test_cached_billing_reads_denied_even_if_ttl_zero(self):
        data=evidence();data['hyperdrive']['caching']={'disabled': False, 'max_age':0}
        self.assertIn('HYPERDRIVE_NOT_PRIVATE_OR_CACHE_ENABLED', self.result(data)['blocking_reasons'])

    def test_public_origin_host_denied(self):
        data=evidence();data['hyperdrive']['origin']={'host':'db.example.com','database':'axiom_phase2_stage',
                                                        'user':'axiom_phase2_stage_runtime','scheme':'postgres'}
        self.assertIn('HYPERDRIVE_NOT_PRIVATE_OR_CACHE_ENABLED', self.result(data)['blocking_reasons'])

    def test_vpc_service_weak_tls_denied(self):
        data=evidence();data['service']['tls_settings']={'cert_verification_mode':'disabled'}
        self.assertIn('VPC_SERVICE_TLS_NOT_STRICT', self.result(data)['blocking_reasons'])

    def test_service_missing_tls_settings_uses_documented_verify_full_default(self):
        data=evidence();del data['service']['tls_settings']
        self.assertNotIn('VPC_SERVICE_TLS_NOT_STRICT', self.result(data)['blocking_reasons'])

    def test_service_tunnel_id_mismatch_denied(self):
        data=evidence();data['service']['host']['resolver_network']['tunnel_id']='different-tunnel'
        self.assertIn('VPC_TUNNEL_LINK_MISMATCH', self.result(data)['blocking_reasons'])

    def test_service_invalid_port_or_protocol_denied(self):
        data=evidence();data['service']['tcp_port']=443;data['service']['app_protocol']='http'
        self.assertIn('VPC_SERVICE_NOT_APPROVED', self.result(data)['blocking_reasons'])

    def test_multiple_bindings_or_wrong_id_denied(self):
        data=evidence();data['worker']['bindings']=[
            {'name':'HYPERDRIVE','type':'hyperdrive','id':'wrong'},
            {'name':'HYPERDRIVE','type':'hyperdrive','id':'hd-synthetic-123'}]
        self.assertIn('WORKER_BINDING_MISMATCH', self.result(data)['blocking_reasons'])

    def test_connection_limit_out_of_conservative_range_denied(self):
        data=evidence();data['hyperdrive']['origin_connection_limit']=200
        self.assertIn('HYPERDRIVE_NOT_PRIVATE_OR_CACHE_ENABLED', self.result(data)['blocking_reasons'])

    def test_missing_fields_unknowns_do_not_pass(self):
        out=self.result({'neon': {'settings': {'block_public_connections': True}}})
        self.assertEqual(out['status'], 'METADATA_SECURITY_GATE_BLOCKED')
        self.assertFalse(out['authorized_to_deploy'])

    def test_untrusted_inputs_and_secrets_never_reflected(self):
        data=evidence()
        data['tunnel']['token']='TOP_SECRET_TOKEN'
        data['hyperdrive']['password']='TOP_SECRET_PASSWORD'
        data['service']['host']['hostname']='private-secret.internal'
        data['worker']['bindings'][0]['api_key']='TOP_SECRET_API_KEY'
        result=json.dumps(self.result(data))
        for sensitive in ('TOP_SECRET_TOKEN','TOP_SECRET_PASSWORD','TOP_SECRET_API_KEY','private-secret.internal'):
            self.assertNotIn(sensitive,result)

    def test_no_live_data_is_never_accepted(self):
        out=self.result({})
        self.assertEqual(out['status'], 'METADATA_SECURITY_GATE_BLOCKED')
        self.assertFalse(out['network_verified'])


if __name__ == '__main__':
    unittest.main()
