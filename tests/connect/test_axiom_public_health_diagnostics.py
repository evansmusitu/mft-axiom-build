"""Public read-only MCP v4 health: report missing contracts without raw response data."""
import json
import unittest
from qualification.diagnose_axiom_public_health import assess_response


class AxiomPublicHealthDiagnostics(unittest.TestCase):
    def test_ci_health_probe_is_read_only_and_non_enabling(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[2]
        workflow = root / '.github/workflows/axiom-public-health-diagnostics.yml'
        self.assertTrue(workflow.is_file(), 'read-only GitHub diagnostic workflow missing')
        content = workflow.read_text(encoding='utf-8')
        self.assertIn('pull_request:', content)
        self.assertIn('push:', content)
        self.assertIn('python qualification/diagnose_axiom_public_health.py', content)
        self.assertNotIn('secrets.', content)
        self.assertNotIn('wrangler', content)
        self.assertNotIn('POST ', content)

    def test_exact_healthy_contract(self):
        health = {
            'ok': True,
            'server_version': '4.0.0',
            'submission_safe_commerce_profile': True,
            'oauth_enforced': True,
            'internal': 'not disclosed',
        }
        result = assess_response(200, json.dumps(health).encode())
        self.assertTrue(result['ready'])
        self.assertEqual(result['failed_checks'], [])
        self.assertNotIn('internal', json.dumps(result))

    def test_out_of_contract_fields_are_named_without_values(self):
        body = {'ok': False, 'server_version': '5.1.0',
                'submission_safe_commerce_profile': False, 'oauth_enforced': False,
                'private_service_token': 'NEVER_EXPOSE_RAW_DATA'}
        result = assess_response(200, json.dumps(body).encode())
        self.assertFalse(result['ready'])
        self.assertEqual(result['failed_checks'], [
            'health_ok_mismatch', 'server_version_mismatch',
            'submission_safe_commerce_profile_mismatch', 'oauth_enforced_mismatch'])
        self.assertNotIn('NEVER_EXPOSE_RAW_DATA', json.dumps(result))
        self.assertNotIn('5.1.0', json.dumps(result))

    def test_public_semver_only_is_reported_when_health_version_drifts(self):
        """Permit only a bounded public numeric version; never echo raw data."""
        valid = {
            'ok': True, 'server_version': '4.1.7',
            'submission_safe_commerce_profile': True, 'oauth_enforced': True,
        }
        result = assess_response(200, json.dumps(valid).encode())
        self.assertFalse(result['ready'])
        self.assertEqual(result['failed_checks'], ['server_version_mismatch'])
        self.assertEqual(result.get('observed_server_version'), '4.1.7')
        workflow = (Path(__file__).resolve().parents[2] /
                    '.github/workflows/axiom-public-health-diagnostics.yml')
        self.assertIn('observed_server_version', workflow.read_text(encoding='utf-8'))
        for untrusted in ('v4.1.7', '<script>secret</script>', '9' * 80 + '.1.1',
                          '4.0.0\\nPRIVATE_TOKEN', 4, None):
            with self.subTest(input=repr(untrusted)):
                invalid = dict(valid, server_version=untrusted)
                report = assess_response(200, json.dumps(invalid).encode())
                self.assertNotIn('observed_server_version', report)
                self.assertNotIn(str(untrusted), json.dumps(report))

    def test_http_error_is_not_confused_with_healthy_json(self):
        result = assess_response(503, b'{"ok": true}')
        self.assertFalse(result['ready'])
        self.assertEqual(result['failed_checks'], ['http_status_mismatch'])

    def test_malformed_or_large_response_fails_closed(self):
        for body in (b'', b'not json', b'[]', b'{}', b'{"ok":true}' + b' ' * 8192):
            with self.subTest(body=body[:30]):
                result = assess_response(200, body)
                self.assertFalse(result['ready'])
                self.assertTrue(result['failed_checks'])
                self.assertLess(len(json.dumps(result)), 800)

    def test_boolean_flags_require_boolean_true_not_strings(self):
        data = {'ok': 1, 'server_version': '4.0.0',
                'submission_safe_commerce_profile': 'true', 'oauth_enforced': 1}
        result = assess_response(200, json.dumps(data).encode())
        self.assertFalse(result['ready'])
        self.assertEqual(result['failed_checks'], [
            'health_ok_mismatch', 'submission_safe_commerce_profile_mismatch', 'oauth_enforced_mismatch'])


if __name__ == '__main__':
    unittest.main()
