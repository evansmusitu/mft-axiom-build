"""G1 one-time AWS identity verification via approved admin environment secrets.

The principal may be administrator-capable, but this script issues only STS
GetCallerIdentity and intentionally never prints account, ARN or credential
values. A successful identity response is NOT proof of AdministratorAccess.
"""

import json
import subprocess


def verify_identity():
    try:
        completed = subprocess.run(
            ['aws', 'sts', 'get-caller-identity', '--region', 'us-east-2', '--output', 'json'],
            capture_output=True, text=True, check=False, timeout=45,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('G1 AWS identity check unavailable') from None
    if completed.returncode != 0:
        raise RuntimeError('G1 AWS identity check was rejected')
    try:
        response = json.loads(completed.stdout)
    except (TypeError, ValueError):
        raise RuntimeError('G1 AWS identity check returned invalid JSON') from None
    if (not isinstance(response, dict)
            or not isinstance(response.get('Account'), str)
            or not response['Account'].isdigit()
            or len(response['Account']) != 12
            or not isinstance(response.get('Arn'), str)
            or not response['Arn'].startswith('arn:aws:')
            or not response.get('UserId')):
        raise RuntimeError('G1 AWS caller identity is invalid')
    return {
        'schema': 'musitu.g1.aws_admin_identity_preflight.v1',
        'aws_identity_verified': True,
        'aws_region': 'us-east-2',
        'admin_permissions_verified': False,
        'billing_credits_verified': False,
        'writes_performed': False,
        'g1_accepted': False,
    }


if __name__ == '__main__':
    print(json.dumps(verify_identity(), sort_keys=True, separators=(',', ':')))
