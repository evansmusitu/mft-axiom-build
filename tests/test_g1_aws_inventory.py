import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'scripts' / 'g1_aws_inventory_readonly.py'


def load_inventory():
    spec = importlib.util.spec_from_file_location('g1_inventory', SRC)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class G1AwsInventoryTests(unittest.TestCase):
    def setUp(self):
        self.inventory = load_inventory()

    def test_restricts_calls_and_redacts_provider_identifiers(self):
        calls = []
        results = {
            ('sts', 'get-caller-identity'): {'Account': '123456789123', 'Arn': 'arn:aws:iam::123456789123:user/private', 'UserId': 'private'},
            ('ec2', 'describe-vpcs'): {'Vpcs': [{'VpcId': 'vpc-private', 'CidrBlock': '10.0.0.0/16'}]},
            ('ec2', 'describe-subnets'): {'Subnets': [{'SubnetId': 'subnet-private'}]},
            ('ec2', 'describe-vpc-endpoints'): {'VpcEndpoints': [{'VpcEndpointId': 'vpce-private', 'VpcEndpointType': 'Interface', 'State': 'available', 'ServiceName': 'com.amazonaws.vpce.us-east-2.vpce-svc-private'}]},
        }

        def fake_aws(service, action):
            calls.append((service, action))
            return results[(service, action)]

        output = self.inventory.collect_inventory(fake_aws)
        self.assertEqual(calls, list(results))
        self.assertEqual(output, {'schema': 'musitu.g1.aws_inventory_readonly.v1', 'region': 'us-east-2', 'aws_identity_verified': True, 'vpc_count': 1, 'subnet_count': 1, 'interface_endpoint_count': 1, 'interface_endpoint_states': {'available': 1}, 'writes_performed': False, 'billing_credits_verified': False, 'neon_privatelink_verified': False})
        s = json.dumps(output)
        for secret in ('123456789123', 'user/private', '10.0.0.0/16', 'vpc-', 'subnet-', 'vpce-', 'arn:'):
            self.assertNotIn(secret, s)

    def test_fails_closed_on_missing_identity(self):
        def fake_aws(service, action):
            if service == 'sts':
                return {}
            raise AssertionError('must not continue after failed identity')
        with self.assertRaises(RuntimeError):
            self.inventory.collect_inventory(fake_aws)

    def test_denied_provider_call_never_logs_raw_stderr(self):
        class Result:
            returncode = 3
            stdout = ''
            stderr = 'SECRET_ACCESS_KEY_DO_NOT_LOG'
        with patch.object(self.inventory.subprocess, 'run', return_value=Result()):
            with self.assertRaises(RuntimeError) as ctx:
                self.inventory.aws_json('ec2', 'describe-vpcs')
        self.assertNotIn('SECRET_ACCESS_KEY', str(ctx.exception))

    def test_rejects_unapproved_operation(self):
        with self.assertRaises(ValueError):
            self.inventory.aws_json('ec2', 'create-vpc')


class G1WorkflowStaticTests(unittest.TestCase):
    def test_guardrails_and_no_automatic_secret_access(self):
        import yaml
        path = ROOT / '.github' / 'workflows' / 'g1-aws-readonly-inventory.yml'
        content = path.read_text()
        parsed = yaml.safe_load(content)
        events = parsed.get('on', parsed.get(True))
        self.assertEqual(list(events), ['workflow_dispatch'])
        self.assertNotIn('pull_request:', content)
        self.assertNotIn('push:', content)
        job = parsed['jobs']['aws-inventory']
        self.assertIn("github.ref == 'refs/heads/main'", job['if'])
        self.assertIn("github.actor == 'evansmusitu'", job['if'])
        self.assertIn('inputs.confirm_read_only', job['if'])
        self.assertEqual(job['environment'], 'g1-aws-readonly')
        self.assertEqual(parsed['permissions'], {'contents': 'read'})
        self.assertIn('secrets.AWS_G1_ACCESS_KEY_ID', content)
        self.assertIn('secrets.AWS_G1_SECRET_ACCESS_KEY', content)
        self.assertNotIn('id-token: write', content)
        self.assertNotIn('aws ec2 create', content)
        self.assertNotIn('aws ec2 delete', content)
        policy = json.loads((ROOT / '.github/policies/g1-aws-readonly-iam-policy.json').read_text())
        allowed = set(policy['Statement'][0]['Action'])
        self.assertEqual(allowed, {'ec2:DescribeVpcs', 'ec2:DescribeVpcEndpoints', 'ec2:DescribeSubnets'})
        self.assertEqual(policy['Statement'][0]['Condition'], {'StringEquals': {'aws:RequestedRegion': 'us-east-2'}})


if __name__ == '__main__':
    unittest.main()
