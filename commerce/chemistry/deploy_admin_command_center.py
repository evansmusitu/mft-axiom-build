#!/usr/bin/env python3
from __future__ import annotations

import email
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get('CF_API', 'https://api.cloudflare.com/client/v4')
ACCOUNT_ID = os.environ['ACCOUNT_ID']
WORKER = os.environ.get('COMMERCE_WORKER', 'musitu-chemistry-commerce')
DB_ID = os.environ['DB_ID']
BASE_URL = os.environ.get('BASE_URL', 'https://payments.mftintelligence.com').rstrip('/')
BASELINE_SHA = os.environ['BASELINE_SHA']
TARGET_SHA = os.environ['TARGET_SHA']
OWNER_TOKEN = os.environ.get('CHEMISTRY_ADMIN_OWNER_TOKEN', '')
CF_EMAIL = os.environ['CLOUDFLARE_EMAIL']
CF_KEY = os.environ['CLOUDFLARE_GLOBAL_API_KEY']
EVIDENCE_DIR = Path(os.environ.get('EVIDENCE_DIR', 'evidence-out'))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

REQUIRED_BINDINGS = {
    'CHEMISTRY_DB',
    'CHEMISTRY_LICENSE_KEY_ID',
    'CHEMISTRY_LICENSE_PKCS8_B64',
    'CHEMISTRY_AUTHORITY_BRIDGE_TOKEN',
    'CHEMISTRY_TRANSPORT_BRIDGE_TOKEN',
    'PAYMENT_AUTHORITY',
    'PAYNOW_TRANSPORT',
}
ADMIN_TABLES = [
    'chemistry_admin_users',
    'chemistry_customers',
    'chemistry_customer_orders',
    'chemistry_cash_sessions',
    'chemistry_payments',
    'chemistry_receipts',
    'chemistry_support_notes',
    'chemistry_device_events',
    'chemistry_adjustments',
    'chemistry_access_controls',
    'chemistry_admin_audit',
]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http(url: str, method: str = 'GET', headers: dict | None = None, body: bytes | None = None, *, no_redirect: bool = False):
    req = urllib.request.Request(url, method=method, headers=dict(headers or {}), data=body)
    opener = urllib.request.build_opener(NoRedirect()) if no_redirect else urllib.request.build_opener()
    try:
        with opener.open(req, timeout=45) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def cf_headers(json_body: bool = False) -> dict:
    h = {
        'X-Auth-Email': CF_EMAIL,
        'X-Auth-Key': CF_KEY,
        'Accept': 'application/json',
        'User-Agent': 'MUSITU-Chemistry-Admin-Cutover/1.0',
    }
    if json_body:
        h['Content-Type'] = 'application/json'
    return h


def cf_json(path: str, method: str = 'GET', obj=None):
    body = None if obj is None else json.dumps(obj, separators=(',', ':')).encode()
    code, headers, raw = http(API + path, method, cf_headers(obj is not None), body)
    if not 200 <= code < 300:
        raise RuntimeError(f'Cloudflare HTTP {code} {path}: {raw[:400]!r}')
    data = json.loads(raw or b'{}')
    if isinstance(data, dict) and data.get('success') is False:
        raise RuntimeError(f'Cloudflare success=false {path}: {data.get("errors")}')
    return data.get('result') if isinstance(data, dict) else data


def worker_read():
    path = f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe="")}'
    code, headers, raw = http(API + path, headers=cf_headers())
    if code != 200:
        raise RuntimeError(f'Worker source read HTTP {code}')
    ctype = headers.get('content-type', '')
    module_name = None
    source = raw
    if 'multipart/' in ctype.lower():
        msg = email.message_from_bytes((f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n').encode() + raw)
        matches = []
        for part in msg.walk():
            if part.is_multipart():
                continue
            data = part.get_payload(decode=True) or b''
            if b'MUSITU Chemistry Commerce' in data:
                pname = part.get_param('name', header='content-disposition') or part.get_filename()
                matches.append((pname, data))
        if len(matches) != 1:
            raise RuntimeError(f'Commerce module extraction mismatch: {len(matches)}')
        module_name, source = matches[0]
    return source, module_name


def worker_settings():
    path = f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe="")}/settings'
    result = cf_json(path)
    return result if isinstance(result, dict) else {}


def binding_names(settings: dict) -> set[str]:
    return {str(x.get('name')) for x in (settings.get('bindings') or []) if x.get('name')}


def require_bindings(settings: dict, *, owner: bool):
    names = binding_names(settings)
    missing = REQUIRED_BINDINGS - names
    if missing:
        raise RuntimeError('required Commerce bindings missing: ' + repr(sorted(missing)))
    if owner and 'CHEMISTRY_ADMIN_OWNER_TOKEN' not in names:
        raise RuntimeError('owner Worker secret binding missing after installation')
    return names


def d1(sql: str):
    result = cf_json(f'/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query', 'POST', {'sql': sql})
    chunks = result or []
    if not isinstance(chunks, list) or not chunks or not all(x.get('success') is True for x in chunks):
        raise RuntimeError('D1 statement failed')
    rows = []
    for chunk in chunks:
        rows.extend(chunk.get('results') or [])
    return rows


def admin_counts() -> dict[str, int]:
    out = {}
    for table in ADMIN_TABLES:
        row = (d1(f'SELECT count(*) AS n FROM {table}') or [{}])[0]
        out[table] = int(row.get('n') or 0)
    return out


def require_schema():
    version = d1('SELECT version FROM chemistry_admin_schema WHERE version=1')
    if len(version) != 1 or int(version[0].get('version') or 0) != 1:
        raise RuntimeError('Admin schema v1 not sealed')
    idx = d1("SELECT name,sql FROM sqlite_master WHERE type='index' AND name='idx_chem_admin_audit_prev_hash'")
    if len(idx) != 1 or 'UNIQUE INDEX' not in str(idx[0].get('sql') or '').upper():
        raise RuntimeError('Admin audit fork guard missing')


def load_patcher():
    path = Path('commerce/chemistry/patch_admin_command_center.py')
    spec = importlib.util.spec_from_file_location('admin_patcher', path)
    if spec is None or spec.loader is None:
        raise RuntimeError('cannot load Admin patcher')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_sources(live: bytes):
    live_sha = sha(live)
    patcher = load_patcher()
    if live_sha == BASELINE_SHA:
        baseline = live
        tmp = Path('/tmp/mchem-admin-cutover')
        tmp.mkdir(parents=True, exist_ok=True)
        inp = tmp / 'baseline.mjs'
        out = tmp / 'target.mjs'
        inp.write_bytes(baseline)
        subprocess.run([
            sys.executable,
            'commerce/chemistry/patch_admin_command_center.py',
            '--input', str(inp),
            '--output', str(out),
        ], check=True)
        target = out.read_bytes()
    elif live_sha == TARGET_SHA:
        target = live
        text = live.decode('utf-8')
        modules = patcher.combined_modules()
        if text.count(patcher.ROUTE_INSERT) != 1 or text.count(modules) != 1:
            raise RuntimeError('cannot reconstruct exact baseline from live target')
        baseline = text.replace(patcher.ROUTE_INSERT, '', 1).replace(modules, '', 1).encode()
    else:
        raise RuntimeError('unexpected live Commerce source drift: ' + live_sha)
    if sha(baseline) != BASELINE_SHA:
        raise RuntimeError('baseline reconstruction SHA mismatch: ' + sha(baseline))
    if sha(target) != TARGET_SHA:
        raise RuntimeError('target reconstruction SHA mismatch: ' + sha(target))
    tmp = Path('/tmp/mchem-admin-cutover')
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / 'baseline-exact.mjs').write_bytes(baseline)
    (tmp / 'target-exact.mjs').write_bytes(target)
    subprocess.run(['node', '--check', str(tmp / 'target-exact.mjs')], check=True, stdout=subprocess.DEVNULL)
    return baseline, target, live_sha


def add_owner_worker_secret():
    if len(OWNER_TOKEN) < 32:
        raise RuntimeError('CHEMISTRY_ADMIN_OWNER_TOKEN must be at least 32 characters')
    path = f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe="")}/secrets'
    cf_json(path, 'PUT', {'name': 'CHEMISTRY_ADMIN_OWNER_TOKEN', 'text': OWNER_TOKEN, 'type': 'secret_text'})


def upload_source(source: bytes, module_name: str):
    boundary = '----MUSITUAdmin' + secrets.token_hex(16)
    metadata = json.dumps({'main_module': module_name}, separators=(',', ':'))
    chunks: list[bytes] = []
    def add(x):
        chunks.append(x.encode() if isinstance(x, str) else x)
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{metadata}\r\n')
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="{module_name}"; filename="{module_name}"\r\nContent-Type: application/javascript+module\r\n\r\n')
    add(source)
    add('\r\n')
    add(f'--{boundary}--\r\n')
    headers = cf_headers()
    headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    path = f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER, safe="")}/content'
    code, _, raw = http(API + path, 'PUT', headers, b''.join(chunks))
    if not 200 <= code < 300:
        raise RuntimeError(f'Worker upload HTTP {code}: {raw[:500]!r}')
    try:
        result = json.loads(raw or b'{}')
        if isinstance(result, dict) and result.get('success') is False:
            raise RuntimeError('Worker upload Cloudflare success=false: ' + repr(result.get('errors')))
    except json.JSONDecodeError:
        pass


def require_live_sha(expected: str):
    source, _ = worker_read()
    got = sha(source)
    if got != expected:
        raise RuntimeError(f'live Worker SHA mismatch: {got} != {expected}')
    return got


def public_request(path: str, method: str = 'GET', body: bytes | None = None, headers: dict | None = None, *, no_redirect: bool = False):
    h = {'User-Agent': 'MUSITU-Admin-Production-Certification/1.0', 'Accept': '*/*'}
    h.update(headers or {})
    return http(BASE_URL + path, method, h, body, no_redirect=no_redirect)


def public_regression():
    health_code, _, health_body = public_request('/chemistry/healthz')
    if health_code != 200:
        raise RuntimeError(f'Commerce healthz failed HTTP {health_code}')
    plans_code, plans_headers, plans_body = public_request('/chemistry/plans')
    if plans_code != 200:
        raise RuntimeError(f'Commerce plans failed HTTP {plans_code}')
    ctype = str(plans_headers.get('content-type', '')).lower()
    if 'text/html' not in ctype or b'MUSITU' not in plans_body:
        raise RuntimeError('Commerce plans response contract changed')
    return {
        'healthz_http': health_code,
        'plans_http': plans_code,
        'plans_html': True,
        'healthz_body_sha256': sha(health_body),
        'plans_body_sha256': sha(plans_body),
    }


def admin_readonly_certification():
    code, headers, _ = public_request('/chemistry/admin', no_redirect=True)
    if code != 303 or headers.get('location') not in ('/chemistry/admin/login', '/chemistry/admin/login/'):
        raise RuntimeError(f'unauthenticated Admin gate mismatch: HTTP {code} location={headers.get("location")}')
    login_code, login_headers, login_body = public_request('/chemistry/admin/login', no_redirect=True)
    if login_code != 200 or b'Admin Command Center' not in login_body:
        raise RuntimeError('Admin login page contract failed')
    if 'text/html' not in str(login_headers.get('content-type', '')).lower():
        raise RuntimeError('Admin login content type mismatch')
    bad = urllib.parse.urlencode({'token': 'INVALID-ADMIN-CREDENTIAL-DO-NOT-USE'}).encode()
    bad_code, _, _ = public_request('/chemistry/admin/login', 'POST', bad, {'Content-Type': 'application/x-www-form-urlencoded'}, no_redirect=True)
    if bad_code != 401:
        raise RuntimeError(f'Admin invalid credential gate changed: HTTP {bad_code}')
    good = urllib.parse.urlencode({'token': OWNER_TOKEN}).encode()
    good_code, good_headers, _ = public_request('/chemistry/admin/login', 'POST', good, {'Content-Type': 'application/x-www-form-urlencoded'}, no_redirect=True)
    if good_code != 303:
        raise RuntimeError(f'Admin owner login failed: HTTP {good_code}')
    location = good_headers.get('location') or ''
    if location not in ('/chemistry/admin', '/chemistry/admin/'):
        raise RuntimeError('Admin owner login redirect mismatch: ' + location)
    set_cookie = good_headers.get('set-cookie') or ''
    lower_cookie = set_cookie.lower()
    if not set_cookie.startswith('mchem_admin=') or 'httponly' not in lower_cookie or 'secure' not in lower_cookie or 'samesite=strict' not in lower_cookie:
        raise RuntimeError('Admin secure session cookie contract failed')
    cookie = set_cookie.split(';', 1)[0]
    dash_code, dash_headers, dash_body = public_request('/chemistry/admin/', headers={'Cookie': cookie}, no_redirect=True)
    if dash_code != 200:
        raise RuntimeError(f'authenticated Admin dashboard failed: HTTP {dash_code}')
    if b'Command Center' not in dash_body or b'Customer 360' not in dash_body:
        raise RuntimeError('Admin dashboard UI markers missing')
    if 'text/html' not in str(dash_headers.get('content-type', '')).lower():
        raise RuntimeError('Admin dashboard content type mismatch')
    return {
        'unauthenticated_http': code,
        'unauthenticated_location': headers.get('location'),
        'login_page_http': login_code,
        'invalid_credential_http': bad_code,
        'owner_login_http': good_code,
        'owner_login_location': location,
        'secure_cookie': True,
        'dashboard_http': dash_code,
        'dashboard_markers': True,
        'login_body_sha256': sha(login_body),
        'dashboard_body_sha256': sha(dash_body),
    }


def main():
    # Absolutely no production write may occur before this gate.
    if len(OWNER_TOKEN) < 32:
        print(json.dumps({
            'gate': 'MUSITU_ADMIN_OWNER_SECRET_REQUIRED',
            'owner_secret_actions_available': False,
            'production_mutation': False,
            'secret_value_emitted': False,
        }, sort_keys=True))
        raise SystemExit('CHEMISTRY_ADMIN_OWNER_TOKEN GitHub Actions secret is required (minimum 32 characters). No production write attempted.')

    source, parsed_module_name = worker_read()
    settings_before = worker_settings()
    names_before = require_bindings(settings_before, owner=False)
    module_name = str(settings_before.get('main_module') or parsed_module_name or 'index.mjs')
    if '/' in module_name or '\\' in module_name or not module_name.endswith(('.js', '.mjs')):
        raise RuntimeError('unsafe/unexpected Worker main module name: ' + module_name)
    baseline, target, initial_sha = build_sources(source)
    require_schema()
    counts_before = admin_counts()
    public_before = public_regression()
    original = target if initial_sha == TARGET_SHA else baseline
    wrote_source = False
    secret_installed = False
    rollback_verified = False
    initial_target_verified = False
    final_target_verified = False
    try:
        add_owner_worker_secret()
        secret_installed = True
        names_after_secret = require_bindings(worker_settings(), owner=True)
        if not names_before.issubset(names_after_secret):
            raise RuntimeError('existing Worker binding lost while adding Admin owner secret')

        upload_source(target, module_name)
        wrote_source = True
        require_live_sha(TARGET_SHA)
        names_after_target = require_bindings(worker_settings(), owner=True)
        if not names_before.issubset(names_after_target):
            raise RuntimeError('existing Worker binding lost after target deployment')
        time.sleep(1)
        public_target = public_regression()
        admin_target = admin_readonly_certification()
        initial_target_verified = True
        counts_after_target = admin_counts()
        if counts_after_target != counts_before:
            raise RuntimeError('read-only target certification mutated Admin operational rows')

        # Exact rollback drill: source only. Additive empty schema + owner secret remain dormant.
        upload_source(baseline, module_name)
        require_live_sha(BASELINE_SHA)
        names_after_rollback = require_bindings(worker_settings(), owner=True)
        if not names_before.issubset(names_after_rollback):
            raise RuntimeError('existing Worker binding lost during rollback drill')
        time.sleep(1)
        public_rollback = public_regression()
        rollback_verified = True
        counts_after_rollback = admin_counts()
        if counts_after_rollback != counts_before:
            raise RuntimeError('rollback drill mutated Admin operational rows')

        # Final promotion of the exact already-qualified bytes.
        upload_source(target, module_name)
        require_live_sha(TARGET_SHA)
        names_final = require_bindings(worker_settings(), owner=True)
        if not names_before.issubset(names_final):
            raise RuntimeError('existing Worker binding lost on final promotion')
        time.sleep(1)
        public_final = public_regression()
        admin_final = admin_readonly_certification()
        final_target_verified = True
        counts_final = admin_counts()
        if counts_final != counts_before:
            raise RuntimeError('final read-only certification mutated Admin operational rows')

        report = {
            'schema': 'musitu.chemistry.admin.production_cutover.v1',
            'gate': 'MUSITU_ADMIN_PRODUCTION_CUTOVER_PASS',
            'worker': WORKER,
            'initial_live_sha256': initial_sha,
            'baseline_sha256': BASELINE_SHA,
            'target_sha256': TARGET_SHA,
            'final_live_sha256': require_live_sha(TARGET_SHA),
            'main_module': module_name,
            'existing_bindings_before': sorted(names_before),
            'final_binding_names': sorted(names_final),
            'owner_secret_binding_present': 'CHEMISTRY_ADMIN_OWNER_TOKEN' in names_final,
            'owner_secret_value_emitted': False,
            'owner_secret_actions_available': True,
            'admin_schema_ready': True,
            'admin_counts_before': counts_before,
            'admin_counts_final': counts_final,
            'certification_admin_row_mutation': False,
            'public_before': public_before,
            'public_target': public_target,
            'admin_target': admin_target,
            'public_rollback': public_rollback,
            'public_final': public_final,
            'admin_final': admin_final,
            'initial_target_verified': initial_target_verified,
            'rollback_verified': rollback_verified,
            'final_target_verified': final_target_verified,
            'production_mutation': True,
        }
        raw = (json.dumps(report, indent=2, sort_keys=True) + '\n').encode()
        evidence = EVIDENCE_DIR / 'production-cutover.json'
        evidence.write_bytes(raw)
        (EVIDENCE_DIR / 'SHA256SUMS.txt').write_text(sha(raw) + '  production-cutover.json\n')
        print(json.dumps({
            'gate': report['gate'],
            'initial_live_sha256': initial_sha,
            'final_live_sha256': TARGET_SHA,
            'rollback_verified': True,
            'public_regression': True,
            'authenticated_admin_readonly': True,
            'certification_admin_row_mutation': False,
            'owner_secret_value_emitted': False,
            'evidence_sha256': sha(raw),
        }, sort_keys=True))
        print('MUSITU_ADMIN_PRODUCTION_CUTOVER=PASS')
    except Exception as exc:
        # Return source to the exact state observed at entry whenever a source write occurred.
        restore_error = None
        if wrote_source:
            try:
                upload_source(original, module_name)
                require_live_sha(initial_sha)
            except Exception as restore_exc:
                restore_error = f'{type(restore_exc).__name__}: {restore_exc}'
        failure = {
            'schema': 'musitu.chemistry.admin.production_cutover.failure.v1',
            'gate': 'MUSITU_ADMIN_PRODUCTION_CUTOVER_FAIL',
            'error_type': type(exc).__name__,
            'error': str(exc),
            'initial_live_sha256': initial_sha,
            'target_sha256': TARGET_SHA,
            'source_write_attempted': wrote_source,
            'owner_secret_binding_install_attempted': secret_installed,
            'initial_target_verified': initial_target_verified,
            'rollback_verified': rollback_verified,
            'final_target_verified': final_target_verified,
            'source_restore_error': restore_error,
            'owner_secret_value_emitted': False,
        }
        raw = (json.dumps(failure, indent=2, sort_keys=True) + '\n').encode()
        (EVIDENCE_DIR / 'production-cutover-failure.json').write_bytes(raw)
        print(json.dumps(failure, sort_keys=True), file=sys.stderr)
        raise


if __name__ == '__main__':
    main()
