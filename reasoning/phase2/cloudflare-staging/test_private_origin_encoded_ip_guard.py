"""Regression for encoded IPv4 literals in untrusted private-origin metadata.

All evidence is synthetic. This never connects to a provider or a database.
"""
import unittest
from private_origin_admission import evaluate
from test_private_origin_hostname_guard import candidate


class EncodedIpHostnameTests(unittest.TestCase):
    def test_encoded_ipv4_aliases_fail_closed_before_private_origin_admission(self):
        # These labels look DNS-like but WHATWG URL parsers reinterpret them as IPs.
        # In particular 0x7f.1 normalizes to loopback 127.0.0.1.
        for alias in (
            '0x7f.1',
            '0x7f.0.0.1',
            '0X7F.000.00.1',
            '0x0a.10.0.1',
            '0177.0x0.0.01',
            '0x7f.00000001',
        ):
            with self.subTest(alias=alias):
                data = candidate()
                data['service']['host']['hostname'] = alias
                outcome = evaluate(data)
                self.assertEqual(outcome['status'], 'METADATA_SECURITY_GATE_BLOCKED')
                self.assertIn('VPC_SERVICE_NOT_APPROVED', outcome['blocking_reasons'])
                self.assertFalse(outcome['network_verified'])
                self.assertFalse(outcome['authorized_to_deploy'])
                self.assertFalse(outcome['production_release_qualified'])

    def test_real_dns_labels_containing_digits_and_hex_text_are_not_addresses(self):
        for hostname in (
            'db12.aws2.internal',
            'db.0x7f.internal',
            '0x7f.internal.example',
        ):
            with self.subTest(hostname=hostname):
                data = candidate()
                data['service']['host']['hostname'] = hostname
                outcome = evaluate(data)
                self.assertEqual(outcome['status'], 'METADATA_CANDIDATE_INDEPENDENT_EVIDENCE_REQUIRED')
                self.assertFalse(outcome['authorized_to_deploy'])

    def test_arbitrary_attestation_flags_cannot_promote_a_blocked_ip_alias(self):
        data = candidate()
        data['service']['host']['hostname'] = '0x7f.1'
        data['authorized_to_deploy'] = True
        data['network_verified'] = True
        data['production_release_qualified'] = True
        outcome = evaluate(data)
        self.assertEqual(outcome['status'], 'METADATA_SECURITY_GATE_BLOCKED')
        self.assertFalse(outcome['authorized_to_deploy'])
        self.assertFalse(outcome['network_verified'])
        self.assertFalse(outcome['production_release_qualified'])


if __name__ == '__main__':
    unittest.main()
