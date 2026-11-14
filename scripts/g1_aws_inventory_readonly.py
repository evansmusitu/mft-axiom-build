"""G1 AWS inventory: explicitly allowed read-only AWS calls; never print identifiers.
Run only from the manually gated GitHub Actions environment g1-aws-readonly.
This is not a private-network acceptance or AWS credit/billing verification.
"""
import json
import subprocess

REGION = 'us-east-2'
ALLOWED_CALLS = frozenset({
    ('sts', 'get-caller-identity'),
    ('ec2', 'describe-vpcs'),
    ('ec2', 'describe-subnets'),
    ('ec2', 'describe-vpc-endpoints'),
})


def aws_json(service, action):
    if (service, action) not in ALLOWED_CALLS:
        raise ValueError('Unapproved G1 AWS operation')
    try:
        run = subprocess.run(
            ['aws', service, action, '--region', REGION, '--output', 'json'],
            capture_output=True, text=True, timeout=75, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('G1 AWS read-only CLI unavailable or timed out') from None
    if run.returncode != 0:
        raise RuntimeError('G1 AWS read-only call rejected: ' + service + '/' + action)
    try:
        payload = json.loads(run.stdout)
    except (ValueError, TypeError):
        raise RuntimeError('G1 AWS returned invalid JSON') from None
    if not isinstance(payload, dict):
        raise RuntimeError('G1 AWS returned unexpected response type')
    return payload


def collect_inventory(aws=aws_json):
    identity = aws('sts', 'get-caller-identity')
    if not isinstance(identity.get('Account'), str) or not identity.get('Arn'):
        raise RuntimeError('G1 AWS identity verification failed')
    vpcs = aws('ec2', 'describe-vpcs').get('Vpcs')
    subnets = aws('ec2', 'describe-subnets').get('Subnets')
    endpoints = aws('ec2', 'describe-vpc-endpoints').get('VpcEndpoints')
    if not all(isinstance(x, list) for x in (vpcs, subnets, endpoints)):
        raise RuntimeError('G1 AWS inventory incomplete; no acceptance claim')
    interface = [e for e in endpoints if e.get('VpcEndpointType') == 'Interface']
    states = {}
    for endpoint in interface:
        state = endpoint.get('State')
        if state not in {'available', 'pending', 'deleting', 'deleted', 'failed', 'rejected', 'expired', 'pendingAcceptance', 'pending-acceptance'}:
            state = 'other'
        states[state] = states.get(state, 0) + 1
    return {
        'schema': 'musitu.g1.aws_inventory_readonly.v1',
        'region': REGION,
        'aws_identity_verified': True,
        'vpc_count': len(vpcs),
        'subnet_count': len(subnets),
        'interface_endpoint_count': len(interface),
        'interface_endpoint_states': dict(sorted(states.items())),
        'writes_performed': False,
        'billing_credits_verified': False,
        'neon_privatelink_verified': False,
    }


if __name__ == '__main__':
    print(json.dumps(collect_inventory(), sort_keys=True, separators=(',', ':')))
