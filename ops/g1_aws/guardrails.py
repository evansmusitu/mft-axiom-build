"""Offline configuration/plan validation, never cloud authorization or G1 signoff."""
import argparse
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

REPOSITORY = 'evansmusitu/mft-axiom-build'
OWNER_ID = '285482095'
REPOSITORY_ID = '1356837528'
ENVIRONMENT = 'g1-aws-admin'
EXECUTOR = REPOSITORY + '/.github/workflows/g1-aws-oidc-executor.yml@refs/heads/main'
LEGACY_SUB = 'repo:' + REPOSITORY + ':environment:' + ENVIRONMENT
IMMUTABLE_SUB = ('repo:evansmusitu@285482095/mft-axiom-build@1356837528:'
                 'environment:g1-aws-admin')
# Public Neon documentation, read 2026-11-19; refresh against the organization API
# before approval. This snapshot is not proof of this organization's entitlement.
NEON_SERVICES = [
    'com.amazonaws.vpce.us-east-2.vpce-svc-' + suffix for suffix in (
        '0056bdfba63cc6ea1', '010736480bcef5824', '0125f603817b3d7f7',
        '0234a2d750f731a18', '0465c21ce8ba95fb2', '0a59493ecf790eccf',
        '0ce57d490de78526a', '0d421498ff01becac', '0fcb5fccfc8573aa3')
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    require(isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value),
            'Missing evidence digest; native evidence still requires review')


def amount(value):
    require(isinstance(value, str) and len(value) <= 30, 'Cost must be a decimal string')
    try:
        n = Decimal(value)
    except InvalidOperation:
        raise ValueError('Invalid cost') from None
    require(n.is_finite() and n >= 0, 'Cost must be finite and nonnegative')
    return n


def build_trust(account_id, observed_sub):
    require(isinstance(account_id, str) and re.fullmatch('[0-9]{12}', account_id),
            'Authenticated AWS account ID required')
    require(observed_sub in (LEGACY_SUB, IMMUTABLE_SUB), 'Unapproved OIDC subject')
    claims = {'aud': 'sts.amazonaws.com', 'sub': observed_sub,
              'repository_id': REPOSITORY_ID, 'repository_owner_id': OWNER_ID,
              'actor_id': OWNER_ID, 'ref': 'refs/heads/main',
              'environment': ENVIRONMENT, 'job_workflow_ref': EXECUTOR}
    return {'Version': '2012-10-17', 'Statement': [{
        'Effect': 'Allow',
        'Principal': {'Federated': 'arn:aws:iam::' + account_id +
                      ':oidc-provider/token.actions.githubusercontent.com'},
        'Action': 'sts:AssumeRoleWithWebIdentity',
        'Condition': {'StringEquals': {
            'token.actions.githubusercontent.com:' + k: v for k, v in claims.items()}}
    }]}


def environment_configuration(reviewer_id):
    require(type(reviewer_id) is int and reviewer_id > 0 and str(reviewer_id) != OWNER_ID,
            'An authorized independent human reviewer is required')
    # Caller must separately verify this human's repository permission/acceptance.
    return {'wait_timer': 0, 'prevent_self_review': True, 'can_admins_bypass': False,
            'reviewers': [{'type': 'User', 'id': reviewer_id}],
            'deployment_branch_policy': {
                'protected_branches': False, 'custom_branch_policies': True}}


def assess_pilot(p, now=None):
    now = now or datetime.now(timezone.utc)
    require(p.get('region') == 'us-east-2', 'G1 region must be Ohio')
    require(type(p.get('max_hours')) is int and 0 < p['max_hours'] <= 24,
            'Pilot lifetime must be at most 24 hours')
    require(amount(p.get('gross_cap_usd')) == Decimal('25'), 'Original combined USD25 cap required')
    require(p.get('neon_public_blocked') is True, 'Neon public access must remain blocked')
    require(p.get('origin_tls') == 'verify_full', 'Origin must verify CA and hostname')
    require(p.get('hyperdrive_cache_disabled') is True, 'Hyperdrive cache must be disabled')
    digest(p.get('sql_privilege_plan_sha256'))
    require(isinstance(p.get('service_names'), list) and
            len(p['service_names']) == len(NEON_SERVICES) and
            set(p['service_names']) == set(NEON_SERVICES), 'Refresh and include all Ohio Neon services')
    for key, pattern in (('vpc_id', r'vpc-[0-9a-f]{8,17}'),
                         ('endpoint_security_group_id', r'sg-[0-9a-f]{8,17}')):
        require(isinstance(p.get(key), str) and re.fullmatch(pattern, p[key]), 'Invalid existing network ID')
    subnets = p.get('subnet_ids')
    require(isinstance(subnets, list) and 1 <= len(subnets) <= 2 and
            all(isinstance(s, str) and re.fullmatch(r'subnet-[0-9a-f]{8,17}', s) for s in subnets)
            and len(set(subnets)) == len(subnets), 'One or two distinct reviewed AZ subnets required')
    estimates = p.get('estimates')
    require(isinstance(estimates, list) and len(estimates) == 3 and
            {e.get('provider') for e in estimates} == {'aws', 'cloudflare', 'neon'},
            'All three provider estimates required')
    total = Decimal(0)
    for e in estimates:
        digest(e.get('evidence_sha256'))
        try:
            at = datetime.fromisoformat(e['observed_at'].replace('Z', '+00:00'))
            require(at.tzinfo is not None and timedelta(0) <= now - at <= timedelta(hours=24),
                    'Estimate expired or future-dated')
        except (KeyError, TypeError, AttributeError):
            raise ValueError('Dated provider estimate required') from None
        total += amount(e.get('gross_max_usd'))
    require(total <= Decimal('20'), 'Gross estimate exceeds USD20 planning ceiling')
    teardown = p.get('teardown', {})
    require(teardown.get('tested') is True and teardown.get('scheduled_before_creation') is True and
            isinstance(teardown.get('operator'), str) and bool(teardown['operator'].strip()),
            'Tested independently operated teardown must be scheduled before creation')
    digest(teardown.get('evidence_sha256'))
    return {'schema': 'musitu.g1.aws_pilot_plan.v1', 'region': 'us-east-2',
            'gross_estimate_usd': str(total.quantize(Decimal('0.01'))),
            'gross_cap_usd': '25.00', 'contingency_usd': '5.00', 'max_hours': p['max_hours'],
            'endpoint_count': len(NEON_SERVICES),
            'endpoint_az_hours': len(NEON_SERVICES) * len(subnets) * p['max_hours'],
            'native_estimates_independently_verified': False,
            'teardown_independently_verified': False,
            'deployment_authorized': False, 'g1_accepted': False}


def endpoint_template(p, now=None):
    assess_pilot(p, now)
    # Phase A only. Organization registration/acceptance must precede a separately
    # reviewed private-DNS update. Do not replace existing endpoint identities.
    return {'AWSTemplateFormatVersion': '2010-09-09',
            'Description': 'G1 Ohio PrivateLink proposal only; no apply workflow supplied',
            'Resources': {
                'NeonEndpoint' + str(i + 1): {'Type': 'AWS::EC2::VPCEndpoint', 'Properties': {
                    'VpcEndpointType': 'Interface', 'VpcId': p['vpc_id'],
                    'SubnetIds': p['subnet_ids'],
                    'SecurityGroupIds': [p['endpoint_security_group_id']],
                    'ServiceName': service, 'PrivateDnsEnabled': False,
                    'Tags': [{'Key': 'Project', 'Value': 'MUSITU-AXIOM-G1'},
                             {'Key': 'MaxPilotHours', 'Value': str(p['max_hours'])}]
                }} for i, service in enumerate(p['service_names'])}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['trust', 'environment', 'plan'])
    parser.add_argument('--account-id')
    parser.add_argument('--observed-sub')
    parser.add_argument('--reviewer-id', type=int)
    args = parser.parse_args()
    if args.command == 'trust':
        result = build_trust(args.account_id, args.observed_sub)
    elif args.command == 'environment':
        result = environment_configuration(args.reviewer_id)
    else:
        import os
        p = json.loads(os.environ.get('G1_PILOT_REQUEST_JSON', '{}'))
        result = assess_pilot(p)
        data = json.dumps(endpoint_template(p), sort_keys=True).encode()
        result['proposed_template_sha256'] = hashlib.sha256(data).hexdigest()
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, TypeError, KeyError):
        raise SystemExit('G1 configuration/plan denied: missing or invalid prerequisites') from None
