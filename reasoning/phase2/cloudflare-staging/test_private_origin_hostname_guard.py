"""Synthetic-only hostname admission regressions. No network, credentials or provider calls."""
import copy
import unittest
from private_origin_admission import evaluate


def candidate():
    return {
        'neon': {
            'id': 'royal-grass-27046609', 'region_id': 'aws-us-east-2',
            'settings': {'block_public_connections': True, 'block_vpc_connections': False},
            'branch_protected': True, 'databases': ['axiom_phase2_stage'],
            'roles': ['neondb_owner', 'axiom_phase2_stage_runtime'],
        },
        'tunnel': {'id': 'synthetic-tunnel', 'status': 'healthy', 'tun_type': 'cfd_tunnel'},
        'service': {
            'service_id': 'synthetic-vpc-service', 'type': 'tcp', 'app_protocol': 'postgresql',
            'tcp_port': 5432, 'host': {
                'hostname': 'db.aws.internal', 'resolver_network': {'tunnel_id': 'synthetic-tunnel'}
            }, 'tls_settings': {'cert_verification_mode': 'verify_full'},
        },
        'hyperdrive': {
            'id': 'synthetic-hyperdrive', 'caching': {'disabled': True},
            'origin': {'service_id': 'synthetic-vpc-service', 'database': 'axiom_phase2_stage',
                       'user': 'axiom_phase2_stage_runtime', 'scheme': 'postgres'},
            'origin_connection_limit': 10,
        },
        'worker': {
            'name': 'axiom-phase2-staging-db-preflight',
            'bindings': [{'name': 'HYPERDRIVE', 'type': 'hyperdrive', 'id': 'synthetic-hyperdrive'}]
        },
    }


class VpcHostnameAdmissionTests(unittest.TestCase):
    def test_valid_dns_hostname_remains_metadata_only(self):
        for valid in ('db.aws.internal', 'DB.AWS.INTERNAL', 'a-b.example.internal', 'db.xn--bcher-kva.internal'):
            with self.subTest(host=valid):
                data = candidate()
                data['service']['host']['hostname'] = valid
                out = evaluate(data)
                self.assertEqual(out['status'], 'METADATA_CANDIDATE_INDEPENDENT_EVIDENCE_REQUIRED')
                self.assertFalse(out['network_verified'])
                self.assertFalse(out['authorized_to_deploy'])
                self.assertFalse(out['production_release_qualified'])

    def test_uri_credentials_address_literals_and_wildcards_are_rejected(self):
        for invalid in (
            'https://db.aws.internal', 'db.aws.internal:5432', 'user:password@db.aws.internal',
            '127.0.0.1', '10.0.0.5', '2001:db8::1', '[::1]', '*.aws.internal',
        ):
            with self.subTest(host=invalid):
                data = candidate()
                data['service']['host']['hostname'] = invalid
                out = evaluate(data)
                self.assertEqual(out['status'], 'METADATA_SECURITY_GATE_BLOCKED')
                self.assertIn('VPC_SERVICE_NOT_APPROVED', out['blocking_reasons'])
                self.assertFalse(out['authorized_to_deploy'])

    def test_malformed_control_overlength_or_whitespace_dns_names_are_rejected(self):
        for invalid in (
            'db', 'db..internal', '.db.internal', 'db.internal.', '-db.internal',
            'db-.internal', 'db_.internal', 'db .internal', 'db\x00.internal',
            'db\t.internal', 'a'*64+'.internal', 'a'*249+'.internal',
        ):
            with self.subTest(host=repr(invalid)):
                data = candidate()
                data['service']['host']['hostname'] = invalid
                out = evaluate(data)
                self.assertEqual(out['status'], 'METADATA_SECURITY_GATE_BLOCKED')
                self.assertIn('VPC_SERVICE_NOT_APPROVED', out['blocking_reasons'])


if __name__ == '__main__':
    unittest.main()
