"""Fail-closed local-only authentication/readiness preflight for OpenHands.

This S2 probe is not a real agent task or evidence of S3 qualification.
"""
import http.client
import json
import os
import re
import sys
from urllib.parse import urlsplit


class ProbeError(RuntimeError):
    pass


def _port(base_url: str) -> int:
    if not isinstance(base_url, str) or not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}', base_url):
        raise ProbeError('agent server must be an exact IPv4-loopback HTTP endpoint with explicit port')
    parsed = urlsplit(base_url)
    try:
        port = parsed.port
    except ValueError as error:
        raise ProbeError('invalid local agent server port') from error
    if port is None or not 1 <= port <= 65535:
        raise ProbeError('agent server port invalid')
    return port


def _get(port: int, path: str, session_key: str | None = None) -> tuple[int, bytes]:
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    headers = {'Accept': 'application/json', 'User-Agent': 'MUSITU-Axiom-Isolated-OpenHands-Preflight/1.0'}
    if session_key is not None:
        headers['X-Session-API-Key'] = session_key
    try:
        connection.request('GET', path, headers=headers)
        response = connection.getresponse()
        body = response.read(16385)
        if len(body) > 16384:
            raise ProbeError('agent server response exceeds probe limit')
        return response.status, body
    except (OSError, TimeoutError, http.client.HTTPException) as error:
        raise ProbeError('local agent server HTTP request failed') from error
    finally:
        connection.close()


def run_probe(base_url: str, key: str) -> dict:
    """Require readiness, unauthenticated rejection, and valid authenticated response."""
    port = _port(base_url)
    if not isinstance(key, str) or len(key.encode('utf-8')) < 32 or '\r' in key or '\n' in key:
        raise ProbeError('local agent server session credential unavailable or invalid')
    for path in ('/health', '/ready'):
        status, _ = _get(port, path)
        if status != 200:
            raise ProbeError(path + ' did not report HTTP 200')
    unauthenticated_status, _ = _get(port, '/api/conversations/count')
    if unauthenticated_status not in (401, 403):
        raise ProbeError('agent server did not deny unauthenticated API access')
    status, body = _get(port, '/api/conversations/count', key)
    if status != 200:
        raise ProbeError('agent server authenticated read failed')
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeError) as error:
        raise ProbeError('agent server authentication result is not JSON') from error
    if not isinstance(payload, (dict, int)) or isinstance(payload, bool):
        raise ProbeError('agent server authentication result has an invalid shape')
    return {
        'schema': 'musitu.axiom.openhands-selfhost-local-preflight.v1',
        'status': 'PASS',
        'evidence_level': 'LOCAL_AUTHENTICATED_READINESS_ONLY',
        'endpoint_scope': 'IPV4_LOOPBACK_ONLY',
        'api_authentication_enforced': True,
        'runtime_activation_authorized': False,
        'external_action_executed': False,
        'live_runtime_qualification': 'NOT_PROVEN',
        'release_authority': False,
        'production_authority': False,
        'certification_authority': False,
    }


def main() -> int:
    if os.environ.get('AXIOM_ISOLATED_QUALIFICATION') != 'TRUE':
        print('MUSITU_AXIOM_OPENHANDS_ISOLATION_GATE_BLOCKED', file=sys.stderr)
        return 42
    key = os.environ.get('OH_SESSION_API_KEYS_0', '')
    try:
        result = run_probe(os.environ.get('AXIOM_OPENHANDS_LOOPBACK_URL', ''), key)
    except ProbeError as error:
        print('MUSITU_AXIOM_OPENHANDS_SELFHOST_PREFLIGHT_FAIL: ' + str(error), file=sys.stderr)
        return 43
    print(json.dumps(result, sort_keys=True))
    print('MUSITU_AXIOM_OPENHANDS_SELFHOST_AUTH_PREFLIGHT_PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
