"""Fixed AWS read operations; ephemeral credentials stay in runner memory/env only.

Evolves #239's STS/EC2 redaction seam. Successful identity never proves effective
administrator permissions, billing eligibility, private connectivity or G1 acceptance.
"""
import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from .guardrails import build_trust, IMMUTABLE_SUB, LEGACY_SUB

EC2_READS = ('describe-vpcs', 'describe-subnets', 'describe-vpc-endpoints',
             'describe-security-groups', 'describe-route-tables', 'describe-instances')
ALLOWED = {('sts', 'get-caller-identity'), ('billing', 'get-credits'),
           ('iam', 'get-role'), ('iam', 'list-attached-role-policies')}
ALLOWED.update(('ec2', a) for a in EC2_READS)


def aws_json(service, action, *, account_id=None, role_name=None, now=None):
    if (service, action) not in ALLOWED:
        raise ValueError('Unapproved AWS operation')
    region = 'us-east-2' if service in ('ec2', 'sts') else 'us-east-1'
    cmd = ['aws', service, action, '--region', region, '--output', 'json', '--no-cli-pager']
    if service == 'billing':
        if not isinstance(account_id, str) or not re.fullmatch('[0-9]{12}', account_id):
            raise ValueError('Account required for credit inspection')
        start = (now or datetime.now(timezone.utc)) - timedelta(days=364)
        cmd += ['--account-id', account_id, '--start-date', start.isoformat(), '--no-payer-account-flag']
    elif service == 'iam':
        if not isinstance(role_name, str) or not re.fullmatch(r'[A-Za-z0-9_+=,.@-]{1,64}', role_name):
            raise ValueError('Reviewed role name required')
        cmd += ['--role-name', role_name]
    env = {k: v for k, v in os.environ.items() if not k.startswith('AWS_') or
           k in {'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'}}
    env.update(AWS_EC2_METADATA_DISABLED='true', AWS_CONFIG_FILE='/dev/null',
               AWS_SHARED_CREDENTIALS_FILE='/dev/null', AWS_PAGER='', AWS_MAX_ATTEMPTS='2')
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=45, check=False, env=env)
        if r.returncode:
            raise RuntimeError('AWS read unavailable or denied')
        payload = json.loads(r.stdout)
        if not isinstance(payload, dict):
            raise ValueError()
        return payload
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raise RuntimeError('AWS read unavailable or invalid') from None


def expected_role(role_arn):
    if not isinstance(role_arn, str):
        raise ValueError('Protected role configuration required')
    match = re.fullmatch(r'arn:aws:iam::([0-9]{12}):role/([A-Za-z0-9_+=,.@/-]+)', role_arn)
    if not match:
        raise ValueError('Non-root IAM role required')
    return match.group(1), match.group(2).split('/')[-1]


def verify_identity(identity, role_arn):
    account, role = expected_role(role_arn)
    arn = identity.get('Arn', '')
    prefix = f'arn:aws:sts::{account}:assumed-role/{role}/'
    if (identity.get('Account') != account or not isinstance(arn, str) or
            not arn.startswith(prefix) or not re.fullmatch(r'g1-[0-9]+-[0-9]+', arn[len(prefix):])
            or not isinstance(identity.get('UserId'), str) or not identity['UserId']):
        raise ValueError('Caller is not the expected non-root assumed role')
    return {'schema': 'musitu.g1.aws_oidc_readonly.v1', 'aws_identity_verified': True,
            'assumed_role_verified': True, 'region': 'us-east-2',
            'admin_permissions_verified': False, 'billing_credits_verified': False,
            'private_network_verified': False, 'writes_performed': False, 'g1_accepted': False}


def credit_summary(payload, account_id, now=None):
    now = now or datetime.now(timezone.utc)
    credits = payload.get('credits')
    if not isinstance(credits, list):
        raise ValueError('Missing credit data')
    out = []
    for credit in credits:
        if not isinstance(credit, dict) or credit.get('accountId') != account_id:
            raise ValueError('Credit ownership unverified')
        def money(field, required=False):
            m = credit.get(field)
            if m is None and not required: return None
            if not isinstance(m, dict) or m.get('currencyCode') != 'USD':
                raise ValueError('USD credit amount required')
            try: n = Decimal(m['currencyAmount'])
            except (KeyError, TypeError, InvalidOperation): raise ValueError('Invalid credit amount') from None
            if not n.is_finite() or n < 0: raise ValueError('Credit amount requires native billing review')
            return str(n)
        remaining = money('remainingAmount', True)
        products = credit.get('applicableProductNames')
        if not isinstance(products, list) or not all(isinstance(p, str) and
                re.fullmatch(r'[A-Za-z][A-Za-z0-9 ()/&.,:+_-]{0,127}', p) for p in products):
            raise ValueError('Credit service eligibility unverified')
        end, start = credit_timestamp(credit.get('endDate')), credit_timestamp(credit.get('startDate'))
        # Absent expiry/enabled status never establishes usable credit.
        dated = start is not None and end is not None and start < end
        active = (dated and start <= now.timestamp() < end and
                  credit.get('creditStatus') == 'ENABLED' and Decimal(remaining) > 0)
        purchases = credit.get('purchaseTypeApplications')
        if purchases is not None and (not isinstance(purchases, list) or not all(
                isinstance(p, str) and re.fullmatch(r'[A-Z_]{1,64}', p) for p in purchases)):
            raise ValueError('Credit purchase restrictions unverified')
        out.append({'remaining_amount': remaining,
                    'estimated_remaining_amount': money('estimatedAmount'), 'currency': 'USD',
                    'expires_at': datetime.fromtimestamp(end, timezone.utc).isoformat() if dated else None,
                    'active': bool(active), 'applicable_product_names': products,
                    'purchase_type_restrictions': purchases,
                    'pilot_service_eligibility_independently_verified': False})
    return out


def credit_timestamp(value):
    """Normalize CLI-v2 ISO timestamps and wire epochs; reject ambiguous dates."""
    try:
        if type(value) in (int, float):
            # Round-trip through datetime to reject nonfinite or out-of-range epochs.
            return datetime.fromtimestamp(value, timezone.utc).timestamp()
        if isinstance(value, str) and len(value) <= 64:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is not None:
                return parsed.timestamp()
    except (ValueError, OverflowError, OSError):
        pass
    return None


def collect(mode, role_arn, aws=aws_json):
    result = verify_identity(aws('sts', 'get-caller-identity'), role_arn)
    result['observed_at'] = datetime.now(timezone.utc).isoformat()
    if mode == 'identity': return result
    if mode != 'inventory': raise ValueError('Unsupported read operation')
    collections = {'describe-vpcs': 'Vpcs', 'describe-subnets': 'Subnets',
                   'describe-vpc-endpoints': 'VpcEndpoints', 'describe-security-groups': 'SecurityGroups',
                   'describe-route-tables': 'RouteTables', 'describe-instances': 'Reservations'}
    counts = {}
    for action, key in collections.items():
        rows = aws('ec2', action).get(key)
        if not isinstance(rows, list): raise ValueError('Incomplete Ohio inventory')
        counts[key] = sum(len(r.get('Instances', [])) for r in rows) if key == 'Reservations' else len(rows)
    result['inventory_counts'] = counts
    account, role = expected_role(role_arn)
    iam_role = aws('iam', 'get-role', role_name=role).get('Role', {})
    attached = aws('iam', 'list-attached-role-policies', role_name=role).get('AttachedPolicies')
    if iam_role.get('Arn') != role_arn or not isinstance(attached, list):
        raise ValueError('Role capability inspection incomplete')
    actual_trust = iam_role.get('AssumeRolePolicyDocument')
    if actual_trust not in (build_trust(account, IMMUTABLE_SUB), build_trust(account, LEGACY_SUB)):
        raise ValueError('Native role trust differs from the reviewed exact scope')
    result['oidc_trust_scope_verified'] = True
    result['administrator_policy_attached'] = any(
        p.get('PolicyArn') == 'arn:aws:iam::aws:policy/AdministratorAccess' for p in attached)
    result['permissions_boundary_present'] = bool(iam_role.get('PermissionsBoundary'))
    result['credits'] = credit_summary(aws('billing', 'get-credits', account_id=account), account)
    result['credit_ledger_observed'] = True
    # IAM attachments/credit ledger alone cannot qualify effective permissions,
    # the pilot's precise eligibility, SCPs or unbilled cross-vendor charges.
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument('mode', choices=['validate-config', 'identity', 'inventory'])
    args = p.parse_args()
    role = os.environ.get('G1_AWS_ROLE_ARN')
    account, _ = expected_role(role)
    if account != os.environ.get('G1_AWS_ACCOUNT_ID'):
        raise ValueError('Expected account mismatch')
    if args.mode == 'validate-config':
        print('{"protected_role_configuration_valid":true}')
    else:
        print(json.dumps(collect(args.mode, role), sort_keys=True))


if __name__ == '__main__':
    try: main()
    except (ValueError, TypeError, KeyError, RuntimeError, OverflowError):
        raise SystemExit('G1 AWS read denied/unverified; no raw provider error published') from None
