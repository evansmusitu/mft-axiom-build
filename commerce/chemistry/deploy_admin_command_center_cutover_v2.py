#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import urllib.parse


def load_cutover():
    path = Path(__file__).with_name('deploy_admin_command_center.py')
    spec = importlib.util.spec_from_file_location('musitu_admin_cutover_v1', path)
    if spec is None or spec.loader is None:
        raise RuntimeError('cannot load Admin production cutover module')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


m = load_cutover()


def corrected_admin_readonly_certification():
    # The Admin router intentionally serves the credential form directly at
    # /chemistry/admin. /chemistry/admin/login is POST-only.
    code, headers, body = m.public_request('/chemistry/admin', no_redirect=True)
    ctype = str(headers.get('content-type', '')).lower()
    cache = str(headers.get('cache-control', '')).lower()
    csp = str(headers.get('content-security-policy', '')).lower()
    xfo = str(headers.get('x-frame-options', '')).upper()
    unauth_cookie = str(headers.get('set-cookie', ''))
    if code != 200 or b'Admin Command Center' not in body:
        raise RuntimeError(f'unauthenticated Admin login surface mismatch: HTTP {code}')
    if 'text/html' not in ctype:
        raise RuntimeError('unauthenticated Admin content type mismatch')
    if 'no-store' not in cache:
        raise RuntimeError('unauthenticated Admin cache policy mismatch')
    if "frame-ancestors 'none'" not in csp or "form-action 'self'" not in csp:
        raise RuntimeError('unauthenticated Admin CSP mismatch')
    if xfo != 'DENY':
        raise RuntimeError('unauthenticated Admin frame policy mismatch')
    if 'mchem_admin=' in unauth_cookie.lower():
        raise RuntimeError('unauthenticated Admin unexpectedly issued a session cookie')

    # The credential endpoint is deliberately POST-only. A direct GET must not
    # expose a second login surface.
    login_get_code, _, _ = m.public_request('/chemistry/admin/login', no_redirect=True)
    if login_get_code != 404:
        raise RuntimeError(f'Admin login GET should be not-found, got HTTP {login_get_code}')

    bad = urllib.parse.urlencode({'token': 'INVALID-ADMIN-CREDENTIAL-DO-NOT-USE'}).encode()
    bad_code, bad_headers, _ = m.public_request(
        '/chemistry/admin/login',
        'POST',
        bad,
        {'Content-Type': 'application/x-www-form-urlencoded'},
        no_redirect=True,
    )
    if bad_code != 401:
        raise RuntimeError(f'Admin invalid credential gate changed: HTTP {bad_code}')
    if 'mchem_admin=' in str(bad_headers.get('set-cookie', '')).lower():
        raise RuntimeError('invalid Admin credential unexpectedly issued a session cookie')

    good = urllib.parse.urlencode({'token': m.OWNER_TOKEN}).encode()
    good_code, good_headers, _ = m.public_request(
        '/chemistry/admin/login',
        'POST',
        good,
        {'Content-Type': 'application/x-www-form-urlencoded'},
        no_redirect=True,
    )
    if good_code != 303:
        raise RuntimeError(f'Admin owner login failed: HTTP {good_code}')
    location = good_headers.get('location') or ''
    if location not in ('/chemistry/admin', '/chemistry/admin/'):
        raise RuntimeError('Admin owner login redirect mismatch: ' + location)
    set_cookie = good_headers.get('set-cookie') or ''
    lower_cookie = set_cookie.lower()
    if not set_cookie.startswith('mchem_admin='):
        raise RuntimeError('Admin session cookie missing')
    for required in ('httponly', 'secure', 'samesite=strict'):
        if required not in lower_cookie:
            raise RuntimeError('Admin secure session cookie contract failed: ' + required)
    cookie = set_cookie.split(';', 1)[0]

    dash_code, dash_headers, dash_body = m.public_request(
        '/chemistry/admin/', headers={'Cookie': cookie}, no_redirect=True
    )
    if dash_code != 200:
        raise RuntimeError(f'authenticated Admin dashboard failed: HTTP {dash_code}')
    if b'Command Center' not in dash_body or b'Customer 360' not in dash_body:
        raise RuntimeError('Admin dashboard UI markers missing')
    if 'text/html' not in str(dash_headers.get('content-type', '')).lower():
        raise RuntimeError('Admin dashboard content type mismatch')
    if 'no-store' not in str(dash_headers.get('cache-control', '')).lower():
        raise RuntimeError('authenticated Admin dashboard cache policy mismatch')

    return {
        'unauthenticated_http': code,
        'unauthenticated_login_surface': True,
        'unauthenticated_session_cookie': False,
        'login_get_http': login_get_code,
        'invalid_credential_http': bad_code,
        'invalid_credential_session_cookie': False,
        'owner_login_http': good_code,
        'owner_login_location': location,
        'secure_cookie': True,
        'dashboard_http': dash_code,
        'dashboard_markers': True,
        'login_body_sha256': m.sha(body),
        'dashboard_body_sha256': m.sha(dash_body),
    }


m.admin_readonly_certification = corrected_admin_readonly_certification

if __name__ == '__main__':
    m.main()
