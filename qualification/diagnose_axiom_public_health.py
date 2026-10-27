"""Read-only public MCP health diagnostic; never logs arbitrary response bodies.

Only GETs the publicly exposed /health endpoint. This is NOT a production
admission gate, a deployment, a credentialed check, or a methane predictor test.
"""
import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path

HEALTH_URL = 'https://mcp.mftintelligence.com/health'
MAX_BYTES = 8192
EXPECTED = (
    ('ok', True),
    ('server_version', '4.0.0'),
    ('submission_safe_commerce_profile', True),
    ('oauth_enforced', True),
)


def assess_response(status, body):
    """Evaluate public contract without returning attacker-controlled values."""
    report = {'schema': 'musitu.axiom.public_health_diagnostic.v1',
              'source': 'PUBLIC_READ_ONLY_HEALTH', 'http_status': status,
              'ready': False, 'failed_checks': []}
    if status != 200:
        report['failed_checks'] = ['http_status_mismatch']
        return report
    if not isinstance(body, bytes) or not body or len(body) > MAX_BYTES:
        report['failed_checks'] = ['body_unreadable_or_oversized']
        return report
    try:
        value = json.loads(body)
    except (ValueError, UnicodeError):
        report['failed_checks'] = ['body_not_json_object']
        return report
    if not isinstance(value, dict):
        report['failed_checks'] = ['body_not_json_object']
        return report
    for field, expected in EXPECTED:
        actual = value.get(field)
        # Python equality allows 1 == True; require type identity for booleans.
        if type(actual) is not type(expected) or actual != expected:
            report['failed_checks'].append(field + '_mismatch' if field != 'ok' else 'health_ok_mismatch')
    report['ready'] = not report['failed_checks']
    return report


def probe():
    req = urllib.request.Request(HEALTH_URL,
                                 headers={'Accept': 'application/json',
                                          'User-Agent': 'MUSITU-ReadOnly-Public-Health-Diagnostic/1.0'},
                                 method='GET')
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            return assess_response(response.status, response.read(MAX_BYTES + 1))
    except urllib.error.HTTPError as exc:
        # Do not read or print response bodies from untrusted error pages.
        return assess_response(exc.code, b'')
    except (urllib.error.URLError, TimeoutError, OSError):
        return {'schema': 'musitu.axiom.public_health_diagnostic.v1',
                'source': 'PUBLIC_READ_ONLY_HEALTH', 'http_status': None,
                'ready': False, 'failed_checks': ['transport_unreachable']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    parser.add_argument('--strict', action='store_true', help='exit nonzero on health drift')
    args = parser.parse_args()
    report = probe()
    serialized = json.dumps(report, sort_keys=True, separators=(',', ':')) + '\n'
    if args.output:
        args.output.write_text(serialized, encoding='utf-8')
    print(serialized, end='')
    return 0 if (report['ready'] or not args.strict) else 1


if __name__ == '__main__':
    raise SystemExit(main())
