import json
import pathlib
import unittest

import yaml

from ops.g1_aws import discover, guardrails, readonly

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / '.github/workflows'
POLICIES = ROOT / '.github/policies'


def workflow(name):
    return yaml.safe_load((WORKFLOWS / name).read_text())


class WorkflowSecurityTests(unittest.TestCase):
    def test_aws_executor_requires_manual_protected_main_correct_repo_owner_and_environment(self):
        w = workflow('g1-aws-oidc-executor.yml')
        self.assertEqual(list(w.get('on', w.get(True))), ['workflow_call'])
        job = w['jobs']['protected-read']
        self.assertEqual(job['environment'], 'g1-aws-admin')
        for guard in ("github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'",
                      'github.ref_protected == true', "github.repository_id == '1356837528'",
                      "github.actor_id == '285482095'", "github.triggering_actor == 'evansmusitu'"):
            self.assertIn(guard, job['if'])
        self.assertEqual(job['permissions'], {'contents': 'read', 'id-token': 'write'})
        self.assertFalse(w['concurrency']['cancel-in-progress'])

    def test_credentials_pinned_ephemeral_and_never_long_lived_or_artifact_output(self):
        w = workflow('g1-aws-oidc-executor.yml')
        steps = w['jobs']['protected-read']['steps']
        action = [s for s in steps if s.get('uses', '').startswith('aws-actions/')][0]
        self.assertRegex(action['uses'], r'@[0-9a-f]{40}$')
        cfg = action['with']
        self.assertEqual(cfg['role-duration-seconds'], 900)
        self.assertEqual(cfg['aws-region'], 'us-east-2')
        self.assertTrue(cfg['mask-aws-account-id'])
        self.assertFalse(cfg['output-credentials'])
        self.assertIn('inline-session-policy', cfg)
        self.assertIn('allowed-account-ids', cfg)
        text = (WORKFLOWS / 'g1-aws-oidc-executor.yml').read_text()
        for forbidden in ('secrets.', 'aws-access-key-id:', 'aws-secret-access-key:',
                          'upload-artifact', 'pull_request_target', 'secrets: inherit'):
            self.assertNotIn(forbidden, text)
        for s in steps:
            if 'uses' in s: self.assertRegex(s['uses'], r'@[0-9a-f]{40}$')
            if s.get('uses', '').startswith('actions/checkout'):
                self.assertFalse(s['with']['persist-credentials'])

    def test_identity_inventory_and_plan_are_separate_opt_in_dispatches(self):
        for name, confirmation in (
                ('g1-aws-oidc-identity.yml', 'confirm_read_only'),
                ('g1-aws-oidc-inventory.yml', 'confirm_read_only'),
                ('g1-aws-pilot-plan.yml', 'confirm_offline_plan')):
            w = workflow(name)
            event = w.get('on', w.get(True))
            self.assertEqual(list(event), ['workflow_dispatch'])
            self.assertFalse(event['workflow_dispatch']['inputs'][confirmation]['default'])
            self.assertEqual(w['permissions'], {'contents': 'read'})
            job = next(iter(w['jobs'].values()))
            self.assertIn('inputs.' + confirmation + ' == true', job['if'])
            self.assertIn('github.ref_protected == true', job['if'])
        plan = (WORKFLOWS / 'g1-aws-pilot-plan.yml').read_text()
        self.assertNotIn('id-token', plan)
        self.assertNotIn('aws-actions', plan)
        self.assertNotIn('aws cloudformation', plan)

    def test_offline_ci_does_not_get_credentials_and_runs_on_every_main_pr(self):
        w = workflow('g1-aws-source-checks.yml')
        events = w.get('on', w.get(True))
        self.assertEqual(events['pull_request'], {'branches': ['main']})
        self.assertEqual(w['permissions'], {'contents': 'read'})
        source = (WORKFLOWS / 'g1-aws-source-checks.yml').read_text()
        for forbidden in ('secrets.', 'id-token', 'environment:', 'pull_request_target'):
            self.assertNotIn(forbidden, source)

    def test_identity_session_denies_all_aws_actions_except_identity(self):
        p = json.loads((POLICIES / 'g1-aws-identity-session.json').read_text())
        self.assertIn({'Effect': 'Deny', 'NotAction': 'sts:GetCallerIdentity', 'Resource': '*'}, p['Statement'])
        self.assertEqual(p['Statement'][0]['Action'], 'sts:GetCallerIdentity')

    def test_inventory_session_has_only_fixed_read_operations_and_denies_other_regions(self):
        p = json.loads((POLICIES / 'g1-aws-inventory-session.json').read_text())
        allow = set()
        for s in p['Statement']:
            if s['Effect'] == 'Allow': allow.update(s['Action'])
        self.assertEqual(allow, {'sts:GetCallerIdentity', 'billing:GetCredits', 'iam:GetRole',
                                'iam:ListAttachedRolePolicies', 'ec2:DescribeVpcs', 'ec2:DescribeSubnets',
                                'ec2:DescribeVpcEndpoints', 'ec2:DescribeSecurityGroups',
                                'ec2:DescribeRouteTables', 'ec2:DescribeInstances'})
        deny = [s for s in p['Statement'] if 'NotAction' in s][0]
        self.assertEqual(set(deny['NotAction']), allow)
        self.assertEqual(p['Statement'][-1]['Condition'],
                         {'StringNotEquals': {'aws:RequestedRegion': 'us-east-2'}})

    def test_branch_rule_targets_main_with_independent_reviews_and_no_bypass(self):
        r = json.loads((POLICIES / 'g1-main-ruleset.json').read_text())
        self.assertEqual((r['target'], r['enforcement'], r['bypass_actors']), ('branch', 'active', []))
        self.assertEqual(r['conditions']['ref_name'], {'include': ['refs/heads/main'], 'exclude': []})
        rules = {r['type']: r.get('parameters') for r in r['rules']}
        p = rules['pull_request']
        self.assertTrue(p['dismiss_stale_reviews_on_push'])
        self.assertTrue(p['require_code_owner_review'])
        self.assertTrue(p['require_last_push_approval'])
        self.assertGreaterEqual(p['required_approving_review_count'], 1)
        owners = (ROOT / '.github/CODEOWNERS').read_text()
        self.assertIn('/.github/ @evansmusitu', owners)
        self.assertIn('/ops/g1_aws/ @evansmusitu', owners)


class ClaimsTests(unittest.TestCase):
    def claims(self):
        return {'iss': 'https://token.actions.githubusercontent.com', 'aud': 'sts.amazonaws.com',
                'repository': guardrails.REPOSITORY, 'repository_id': guardrails.REPOSITORY_ID,
                'repository_owner_id': guardrails.OWNER_ID, 'actor_id': guardrails.OWNER_ID,
                'ref': 'refs/heads/main', 'environment': 'g1-aws-admin',
                'job_workflow_ref': guardrails.EXECUTOR, 'event_name': 'workflow_dispatch',
                'sub': guardrails.IMMUTABLE_SUB, 'iat': 1000, 'exp': 1400,
                'jti': 'PRIVATE-TOKEN-ID', 'extra': 'DO_NOT_PRINT'}

    def test_discovery_returns_only_public_context_and_explicitly_not_signature_verification(self):
        result = discover.summarize_claims(self.claims(), 1100)
        self.assertEqual(result['subject'], guardrails.IMMUTABLE_SUB)
        self.assertFalse(result['signature_verified_by_diagnostic'])
        self.assertFalse(result['aws_identity_verified'])
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('DO_NOT_PRINT', json.dumps(result))

    def test_wrong_issuer_branch_environment_reusable_workflow_or_expiry_fails(self):
        for field, value in (('iss', 'https://evil.invalid'), ('ref', 'refs/pull/1/merge'),
                             ('environment', 'other'), ('job_workflow_ref', 'other'),
                             ('repository_id', '123'), ('exp', 1099), ('iat', 1500)):
            c = self.claims(); c[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                discover.summarize_claims(c, 1100)


class InventoryBehaviorTests(unittest.TestCase):
    def fake(self, *, broad_trust=False):
        role = 'arn:aws:iam::123456789012:role/MusituAxiomG1Admin'
        calls = []
        def aws(service, action, **kwargs):
            calls.append((service, action, kwargs))
            if service == 'sts': return {'Account': '123456789012',
                'Arn': 'arn:aws:sts::123456789012:assumed-role/MusituAxiomG1Admin/g1-1-1', 'UserId': 'PRIVATE'}
            if service == 'ec2':
                key = {'describe-vpcs': 'Vpcs', 'describe-subnets': 'Subnets',
                       'describe-vpc-endpoints': 'VpcEndpoints', 'describe-security-groups': 'SecurityGroups',
                       'describe-route-tables': 'RouteTables', 'describe-instances': 'Reservations'}[action]
                return {key: []}
            if action == 'get-role': return {'Role': {'Arn': role,
                'AssumeRolePolicyDocument': {} if broad_trust else guardrails.build_trust('123456789012', guardrails.IMMUTABLE_SUB)}}
            if action == 'list-attached-role-policies': return {'AttachedPolicies': [
                {'PolicyArn': 'arn:aws:iam::aws:policy/AdministratorAccess'}]}
            if action == 'get-credits': return {'credits': []}
            raise AssertionError('unexpected operation')
        return role, aws, calls

    def test_identity_first_performs_only_sts(self):
        role, aws, calls = self.fake()
        result = readonly.collect('identity', role, aws)
        self.assertEqual(len(calls), 1)
        self.assertFalse(result['admin_permissions_verified'])

    def test_full_read_follows_fixed_calls_without_promoting_capability_or_g1(self):
        role, aws, calls = self.fake()
        result = readonly.collect('inventory', role, aws)
        self.assertEqual({(s, a) for s, a, _ in calls}, readonly.ALLOWED)
        self.assertTrue(result['oidc_trust_scope_verified'])
        self.assertTrue(result['administrator_policy_attached'])
        self.assertTrue(result['credit_ledger_observed'])
        self.assertFalse(result['admin_permissions_verified'])
        self.assertFalse(result['billing_credits_verified'])
        self.assertFalse(result['g1_accepted'])
        self.assertNotIn('123456789012', json.dumps(result))

    def test_native_trust_mismatch_fails_before_credit_inspection(self):
        role, aws, calls = self.fake(broad_trust=True)
        with self.assertRaises(ValueError): readonly.collect('inventory', role, aws)
        self.assertNotIn(('billing', 'get-credits'), [(s, a) for s, a, _ in calls])


if __name__ == '__main__': unittest.main()
