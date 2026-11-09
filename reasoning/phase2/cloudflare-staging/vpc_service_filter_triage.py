"""Cloudflare Workers VPC service list cross-check: initially deny-only TDD baseline.

This module cannot perform network access or qualify any service until tested.
"""
ACCOUNT = '93f395f5121954671f92fffa453d6b61'
PATHS = {
    'all': f'/accounts/{ACCOUNT}/connectivity/directory/services?page=1&per_page=100',
    'tcp': f'/accounts/{ACCOUNT}/connectivity/directory/services?page=1&per_page=100&type=tcp',
    'http': f'/accounts/{ACCOUNT}/connectivity/directory/services?page=1&per_page=100&type=http',
}

def classify(results):
    return {'classification': 'INDETERMINATE_NO_GO', 'private_path_verified': False}

def run(token, fetch):
    if not token:
        raise ValueError('SCOPED_SECRET_MISSING')
    return classify({})
