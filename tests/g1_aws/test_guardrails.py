import json
import pathlib
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from ops.g1_aws import guardrails, readonly

NOW = datetime(2026, 11, 19, 7, 0, tzinfo=timezone.utc)
ACCOUNT = '123456789012'
ROLE = f'arn:aws:iam::{ACCOUNT}:role/MusituAxiomG1Admin'


def request():
    return {
        'region': 'us-east-2', 'max_hours': 24, 'gross_cap_usd': '25.00',
        'vpc_id': 'vpc-0123456789abcdef0',
        'subnet_ids': ['subnet-0123456789abcdef0'],
        'endpoint_security_group_id': 'sg-0123456789abcdef0',
        'service_names': guardrails.NEON_SERVICES,
        'neon_public_blocked': True, 'origin_tls': 'verify_full',
        'hyperdrive_cache_disabled': True, 'sql_privilege_plan_sha256': 'c' * 64,
        'estimates': [
            {'provider': p, 'gross_max_usd': '3.00', 'evidence_sha256': 'a' * 64,
             'observed_at': '2026-11-19T06:00:00Z'}
            for p in ('aws', 'cloudflare', 'neon')
        ],
        'teardown': {'operator': 'independent-operator', 'tested': True,
                     'evidence_sha256': 'b' * 64, 'scheduled_before_creation': True},
    }


class TrustTests(unittest.TestCase):
    def test_exact_repository_environment_main_and_reusable_workflow(self):
        p = guardrails.build_trust(ACCOUNT, guardrails.IMMUTABLE_SUB)
        s = p['Statement'][0]
        c = s['Condition']['StringEquals']
        self.assertEqual(s['Action'], 'sts:AssumeRoleWithWebIdentity')
        self.assertEqual(c['token.actions.githubusercontent.com:aud'], 'sts.amazonaws.com')
        self.assertEqual(c['token.actions.githubusercontent.com:repository_id'], '1356837528')
        self.assertEqual(c['token.actions.githubusercontent.com:ref'], 'refs/heads/main')
        self.assertEqual(c['token.actions.githubusercontent.com:environment'], 'g1-aws-admin')
        self.assertEqual(c['token.actions.githubusercontent.com:job_workflow_ref'],
                         'evansmusitu/mft-axiom-build/.github/workflows/g1-aws-oidc-executor.yml@refs/heads/main')
        self.assertNotIn('*', json.dumps(p))

    def test_rejects_other_repos_branches_wildcards_and_account(self):
        for sub in ('repo:evansmusitu/other:environment:g1-aws-admin', '*',
                    'repo:evansmusitu/mft-axiom-build:ref:refs/heads/main'):
            with self.subTest(sub=sub), self.assertRaises(ValueError):
                guardrails.build_trust(ACCOUNT, sub)
        with self.assertRaises(ValueError):
            guardrails.build_trust('not-an-account', guardrails.IMMUTABLE_SUB)

    def test_environment_cannot_approve_itself_or_use_owner_as_independent_reviewer(self):
        for reviewer in (0, True, 285482095):
            with self.subTest(reviewer=reviewer), self.assertRaises(ValueError):
                guardrails.environment_configuration(reviewer)
        env = guardrails.environment_configuration(12345)
        self.assertTrue(env['prevent_self_review'])
        self.assertFalse(env['can_admins_bypass'])
        self.assertEqual(env['reviewers'], [{'type': 'User', 'id': 12345}])
        self.assertEqual(env['deployment_branch_policy'],
                         {'protected_branches': False, 'custom_branch_policies': True})


class PilotTests(unittest.TestCase):
    def test_bounded_plan_does_not_authorize_deployment_or_accept_g1(self):
        result = guardrails.assess_pilot(request(), NOW)
        self.assertEqual(result['gross_estimate_usd'], '9.00')
        self.assertEqual(result['endpoint_az_hours'], 216)
        self.assertFalse(result['deployment_authorized'])
        self.assertFalse(result['g1_accepted'])

    def test_rejects_missing_provider_stale_estimate_and_nonfinite_cost(self):
        cases = []
        p = request(); p['estimates'].pop(); cases.append(p)
        p = request(); p['estimates'][0]['observed_at'] = '2026-11-17T06:00:00Z'; cases.append(p)
        for cost in ('NaN', 'Infinity', '-0.01', '21.00'):
            p = request(); p['estimates'][0]['gross_max_usd'] = cost; cases.append(p)
        for p in cases:
            with self.subTest(p=p), self.assertRaises(ValueError):
                guardrails.assess_pilot(p, NOW)

    def test_rejects_budget_increase_longer_pilot_network_tls_and_unproven_teardown(self):
        for field, bad in (('region', 'us-east-1'), ('max_hours', 25),
                           ('gross_cap_usd', '50'), ('neon_public_blocked', False),
                           ('origin_tls', 'require'), ('sql_privilege_plan_sha256', ''),
                           ('hyperdrive_cache_disabled', False)):
            p = request(); p[field] = bad
            with self.subTest(field=field), self.assertRaises(ValueError):
                guardrails.assess_pilot(p, NOW)
        p = request(); p['teardown']['tested'] = False
        with self.assertRaises(ValueError): guardrails.assess_pilot(p, NOW)

    def test_all_nine_services_required_and_multiple_az_costs_counted(self):
        p = request(); p['service_names'] = p['service_names'][:-1]
        with self.assertRaises(ValueError): guardrails.assess_pilot(p, NOW)
        p = request(); p['subnet_ids'].append('subnet-abcdef01234567890')
        self.assertEqual(guardrails.assess_pilot(p, NOW)['endpoint_az_hours'], 432)

    def test_generated_template_uses_existing_network_and_keeps_private_dns_off(self):
        template = guardrails.endpoint_template(request(), NOW)
        resources = template['Resources']
        self.assertEqual(len(resources), 9)
        for r in resources.values():
            self.assertEqual(r['Type'], 'AWS::EC2::VPCEndpoint')
            self.assertEqual(r['Properties']['VpcEndpointType'], 'Interface')
            self.assertFalse(r['Properties']['PrivateDnsEnabled'])
            self.assertEqual(r['Properties']['SubnetIds'], request()['subnet_ids'])
        self.assertNotIn('AWS::EC2::Instance', json.dumps(template))
        self.assertNotIn('AWS::EC2::NatGateway', json.dumps(template))


class ReadOnlyTests(unittest.TestCase):
    def identity(self, arn=None):
        return {'Account': ACCOUNT, 'Arn': arn or
                f'arn:aws:sts::{ACCOUNT}:assumed-role/MusituAxiomG1Admin/g1-123-1',
                'UserId': 'DO_NOT_PRINT'}

    def test_identity_is_assumed_role_only_and_redacted(self):
        result = readonly.verify_identity(self.identity(), ROLE)
        for text in (ACCOUNT, 'arn:', 'DO_NOT_PRINT', 'MusituAxiomG1Admin'):
            self.assertNotIn(text, json.dumps(result))
        self.assertTrue(result['aws_identity_verified'])
        self.assertFalse(result['admin_permissions_verified'])
        self.assertFalse(result['g1_accepted'])

    def test_root_user_wrong_account_and_wrong_role_are_rejected(self):
        for arn in (f'arn:aws:iam::{ACCOUNT}:root', f'arn:aws:iam::{ACCOUNT}:user/admin',
                    'arn:aws:sts::999999999999:assumed-role/MusituAxiomG1Admin/session',
                    f'arn:aws:sts::{ACCOUNT}:assumed-role/other/session'):
            with self.subTest(arn=arn), self.assertRaises(ValueError):
                readonly.verify_identity(self.identity(arn), ROLE)

    def test_cli_has_no_arbitrary_commands_or_endpoint_overrides(self):
        for operation in (('ec2', 'create-vpc'), ('sts', 'assume-role'), ('iam', 'create-user')):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                readonly.aws_json(*operation)
        class Result:
            returncode = 0
            stdout = '{}'
        with patch.dict(readonly.os.environ, {'AWS_ENDPOINT_URL': 'https://evil.invalid'}):
            with patch.object(readonly.subprocess, 'run', return_value=Result()) as run:
                readonly.aws_json('ec2', 'describe-vpcs')
        args, kwargs = run.call_args
        self.assertIn('us-east-2', args[0])
        self.assertNotIn('AWS_ENDPOINT_URL', kwargs['env'])
        self.assertNotIn('--no-verify-ssl', args[0])

    def test_provider_errors_never_escape(self):
        class Result:
            returncode = 1
            stdout = 'SECRET'; stderr = 'SECRET'
        with patch.object(readonly.subprocess, 'run', return_value=Result()):
            with self.assertRaises(RuntimeError) as ctx:
                readonly.aws_json('sts', 'get-caller-identity')
        self.assertNotIn('SECRET', str(ctx.exception))

    def test_credit_balance_expiry_eligibility_are_redacted_without_credit_id(self):
        payload = {'credits': [{
            'accountId': ACCOUNT, 'creditId': 'PRIVATE-CREDIT-ID', 'description': 'PRIVATE',
            'remainingAmount': {'currencyAmount': '50.00', 'currencyCode': 'USD'},
            'estimatedAmount': {'currencyAmount': '47.00', 'currencyCode': 'USD'},
            'startDate': NOW.timestamp() - 10, 'endDate': NOW.timestamp() + 864000,
            'creditStatus': 'ENABLED', 'applicableProductNames': ['Amazon VPC'],
            'purchaseTypeApplications': ['ON_DEMAND'],
        }]}
        result = readonly.credit_summary(payload, ACCOUNT, NOW)
        self.assertEqual(result[0]['remaining_amount'], '50.00')
        self.assertEqual(result[0]['estimated_remaining_amount'], '47.00')
        self.assertTrue(result[0]['active'])
        self.assertEqual(result[0]['applicable_product_names'], ['Amazon VPC'])
        for private in ('PRIVATE', ACCOUNT): self.assertNotIn(private, json.dumps(result))
        payload['credits'][0]['endDate'] = NOW.timestamp() - 1
        self.assertFalse(readonly.credit_summary(payload, ACCOUNT, NOW)[0]['active'])

    def test_missing_expiry_or_enabled_state_never_treated_as_available_credit(self):
        base = {'accountId': ACCOUNT, 'remainingAmount': {'currencyAmount': '50', 'currencyCode': 'USD'},
                'startDate': NOW.timestamp() - 10, 'applicableProductNames': []}
        self.assertFalse(readonly.credit_summary({'credits': [base]}, ACCOUNT, NOW)[0]['active'])
        with self.assertRaises(ValueError): readonly.credit_summary({}, ACCOUNT, NOW)


if __name__ == '__main__': unittest.main()
