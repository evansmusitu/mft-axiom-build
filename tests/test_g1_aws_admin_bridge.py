import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILE = ROOT / 'scripts' / 'g1_aws_admin_identity_preflight.py'
WF = ROOT / '.github' / 'workflows' / 'g1-aws-admin-identity-preflight.yml'


class AdminBridgeTests(unittest.TestCase):
    @staticmethod
    def module():
        spec = importlib.util.spec_from_file_location('g1_admin', FILE)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_only_identity_is_requested_and_no_private_fields_printed(self):
        m = self.module()
        class Result:
            returncode = 0
            stdout = json.dumps({'Account': '123456789012', 'Arn': 'arn:aws:iam::123456789012:user/secret', 'UserId': 'PRIVATE'})
            stderr = ''
        with patch.object(m.subprocess, 'run', return_value=Result()) as s:
            output = m.verify_identity()
        cmd = s.call_args.args[0]
        self.assertEqual(cmd[:3], ['aws', 'sts', 'get-caller-identity'])
        self.assertTrue(output['aws_identity_verified'])
        self.assertFalse(output['admin_permissions_verified'])
        self.assertFalse(output['billing_credits_verified'])
        self.assertFalse(output['writes_performed'])
        self.assertFalse(output['g1_accepted'])
        blob = json.dumps(output)
        for secret in ('123456789012', 'secret', 'PRIVATE', 'arn:'):
            self.assertNotIn(secret, blob)

    def test_failed_identity_fails_closed_and_never_logs_provider_stderr(self):
        m = self.module()
        class Result:
            returncode = 7
            stdout = ''
            stderr = 'PRIVATE_AWS_SECRET_DO_NOT_LOG'
        with patch.object(m.subprocess, 'run', return_value=Result()):
            with self.assertRaises(RuntimeError) as ctx:
                m.verify_identity()
        self.assertNotIn('PRIVATE_AWS_SECRET', str(ctx.exception))

    def test_absent_required_account_identity_fails(self):
        m = self.module()
        class Result:
            returncode = 0
            stdout = json.dumps({'Account': '', 'Arn': '', 'UserId': ''})
            stderr = ''
        with patch.object(m.subprocess, 'run', return_value=Result()):
            with self.assertRaises(RuntimeError):
                m.verify_identity()

    def test_workflow_manual_owner_main_environment_no_untrusted_executables(self):
        source = WF.read_text()
        parsed = yaml.safe_load(source)
        self.assertEqual(list(parsed.get('on', parsed.get(True))), ['workflow_dispatch'])
        self.assertEqual(parsed['permissions'], {'contents': 'read'})
        self.assertNotIn('pull_request:', source)
        self.assertNotIn('push:', source)
        self.assertNotIn('id-token: write', source)
        job = parsed['jobs']['admin-identity-preflight']
        self.assertEqual(job['environment'], 'g1-aws-admin')
        self.assertIn("github.ref == 'refs/heads/main'", job['if'])
        self.assertIn("github.actor == 'evansmusitu'", job['if'])
        self.assertIn('inputs.confirm_identity_read_only', job['if'])
        self.assertIn('secrets.AWS_ADMIN_ACCESS_KEY_ID', source)
        self.assertIn('secrets.AWS_ADMIN_SECRET_ACCESS_KEY', source)
        self.assertIn('scripts/g1_aws_admin_identity_preflight.py', source)
        self.assertNotIn('aws ec2 create', source)
        self.assertNotIn('aws ec2 delete', source)
        self.assertNotIn('eval ', source)
        self.assertNotIn('curl ', source)
        self.assertNotIn('aws_command', source)


if __name__ == '__main__':
    unittest.main()
