"""Credential-free, fixed-endpoint OAuth/MCP metadata diagnostics, never release authority.

No client registration, no bearer, no authorization code, no OAuth login,
no POST, no protected tool execution. Only public GET and intentionally
rejected tokenless UserInfo GET are permitted.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request

ISSUER = 'https://auth.mftintelligence.com'
RESOURCE = 'https://mcp.mftintelligence.com'
URLS = {
    'authorization_server': ISSUER + '/.well-known/oauth-authorization-server',
    'protected_resource': RESOURCE + '/.well-known/oauth-protected-resource',
    'userinfo_without_bearer': ISSUER + '/oauth/userinfo',
}
MAX_JSON_BYTES = 8192


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def _reject_duplicate(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError('duplicate public JSON key')
        obj[key] = value
    return obj


def _reject_nonfinite(_token):
    raise ValueError('nonfinite JSON value')


def assess_discovery(name, status, value):
    if not isinstance(value, dict) or status != 200:
        return ['invalid_' + name + '_response']
    if name == 'authorization_server':
        checks = {
            'issuer': value.get('issuer') == ISSUER,
            'userinfo_endpoint': value.get('userinfo_endpoint') == URLS['userinfo_without_bearer'],
            'scopes': (isinstance(value.get('scopes_supported'), list)
                       and {'axiom.execute', 'openid', 'email'}.issubset(
                           set(x for x in value['scopes_supported'] if isinstance(x, str)))),
            'pkce': (isinstance(value.get('code_challenge_methods_supported'), list)
                     and 'S256' in value['code_challenge_methods_supported']),
        }
    elif name == 'protected_resource':
        checks = {
            'resource': value.get('resource') == RESOURCE,
            'authorization_servers': (value.get('authorization_servers') == [ISSUER]),
            'scopes': (isinstance(value.get('scopes_supported'), list)
                       and 'axiom.execute' in value['scopes_supported']),
        }
    else:
        return ['unapproved_metadata_type']
    return [name + '_' + k + '_mismatch' for k, success in checks.items() if not success]


def assess_userinfo(status, value, www_authenticate):
    issues = []
    if status != 401:
        issues.append('userinfo_not_401_without_bearer')
    if not isinstance(value, dict) or value.get('error') != 'invalid_token':
        issues.append('userinfo_invalid_token_missing')
    if (not isinstance(www_authenticate, str)
            or 'Bearer' not in www_authenticate
            or 'invalid_token' not in www_authenticate):
        issues.append('userinfo_bearer_challenge_missing')
    return issues


def _response_document(response):
    raw = response.read(MAX_JSON_BYTES + 1)
    if not isinstance(raw, bytes) or not (0 < len(raw) <= MAX_JSON_BYTES):
        raise ValueError('invalid response size')
    return json.loads(raw.decode('utf-8', errors='strict'),
                      object_pairs_hook=_reject_duplicate,
                      parse_constant=_reject_nonfinite)


def _get_public(name, transport):
    req = urllib.request.Request(
        URLS[name], method='GET',
        headers={'Accept': 'application/json',
                 'User-Agent': 'MUSITU-Axiom-OAuth-Metadata-ReadOnly/1.0'})
    try:
        with transport(req, timeout=15) as response:
            return (response.status, _response_document(response),
                    response.headers.get('WWW-Authenticate', ''))
    except urllib.error.HTTPError as err:
        # 401 is the expected no-token outcome. Never expose raw bodies.
        try:
            return (err.code, _response_document(err),
                    err.headers.get('WWW-Authenticate', ''))
        except (ValueError, UnicodeError, OSError, RecursionError):
            return err.code, None, ''


def probe_all(transport=None):
    if transport is None:
        transport = urllib.request.build_opener(_NoRedirect()).open
    failed = []
    for name in URLS:
        try:
            code, body, challenge = _get_public(name, transport)
            mismatches = (assess_userinfo(code, body, challenge)
                          if name == 'userinfo_without_bearer'
                          else assess_discovery(name, code, body))
            failed.extend(mismatches)
        except (urllib.error.URLError, TimeoutError, OSError,
                UnicodeError, ValueError, RecursionError, TypeError):
            failed.append(name + '_unreachable_or_invalid')
    return {
        'schema': 'musitu.axiom.public_oauth_readonly_diagnostic.v1',
        'method': 'PUBLIC_FIXED_URLS_GET_ONLY_NO_BEARER',
        'metadata_and_unauthenticated_boundary_observed': not failed,
        'failed_checks': failed,
        'oauth_e2e_qualified': False,
        'production_auth_security_qualified': False,
        'commercial_ga_qualified': False,
        'openai_submission_approved': False,
        'customer_admission_enabled': False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description='Public no-token OAuth checks; non-enabling')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args(argv)
    result = probe_all()
    try:
        with args.output.open('x', encoding='utf-8') as out:
            json.dump(result, out, indent=2, sort_keys=True, allow_nan=False)
            out.write('\n')
    except OSError:
        print('PUBLIC_OAUTH=BLOCKED_EVIDENCE_WRITE_UNAVAILABLE')
        return 2
    print('PUBLIC_OAUTH_METADATA_AND_NO_TOKEN_GUARD=' +
          ('OBSERVED_NOT_CERTIFIED' if not result['failed_checks'] else 'DRIFT_OR_UNREACHABLE'))
    print('PUBLIC_OAUTH_FAILED_CHECKS='+','.join(result['failed_checks']))
    print('OPENAI_PUBLICATION_AND_COMMERCIAL_GA=NOT_APPROVED_BY_THIS_CHECK')
    return 1 if args.strict and result['failed_checks'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
