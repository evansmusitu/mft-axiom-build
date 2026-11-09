"""One-use, read-only Cloudflare private-path preflight (NOT a deployment gate).

Fetches two exact Cloudflare metadata paths using the GitHub Actions scoped token.
Only explicit aggregate counts and HTTP codes leave the runner, never raw
service/tunnel data, secrets, endpoints, internal hostnames, or credentials.
"""
import hashlib
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
API = 'https://api.cloudflare.com/client/v4'
PATHS = {
    'services': f'/accounts/{ACCOUNT}/connectivity/directory/services?page=1&per_page=100',
    'tunnels': f'/accounts/{ACCOUNT}/tunnels?is_deleted=false&page=1&per_page=100',
}
OUTPUT = 'axiom-phase2-private-network-readonly.json'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_fixed(path, token):
    if path not in PATHS.values() or not isinstance(token, str) or not token or any(c in token for c in '\r\n'):
        raise ValueError('INVALID_FIXED_GET')
    req = urllib.request.Request(API + path, method='GET', headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        'User-Agent': 'AXIOM-CLOUDFLARE-PRIVATE-PATH-READONLY/20261109',
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as resp:
            code = resp.status
            raw = resp.read(250001)
    except urllib.error.HTTPError as exc:
        code = exc.code
        raw = exc.read(250001)
    except (OSError, TimeoutError, ValueError):
        return {'http': 'NETWORK_ERROR', 'data': None, 'info': None}
    if len(raw) > 250000:
        return {'http': code, 'data': None, 'info': None}
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeError):
        body = None
    if code != 200 or not isinstance(body, dict) or body.get('success') is not True:
        return {'http': code, 'data': None, 'info': None}
    return {'http': code, 'data': body.get('result'), 'info': body.get('result_info')}


def complete_page(observation):
    """Never count a single partial page as whole-account absence."""
    rows, info = observation.get('data'), observation.get('info')
    if observation.get('http') != 200 or not isinstance(rows, list) or not isinstance(info, dict):
        return False
    if not all(isinstance(r, dict) for r in rows):
        return False
    if not all(type(info.get(k)) is int for k in ('page', 'count', 'total_count')):
        return False
    if info['page'] != 1 or info['count'] != len(rows) or info['total_count'] != len(rows):
        return False
    pages = info.get('total_pages')
    if pages is not None and (type(pages) is not int or pages not in (0, 1)):
        return False
    return True


def incomplete_reason(observation):
    if observation.get('http') != 200:
        return 'HTTP_NOT_200'
    rows = observation.get('data')
    if not isinstance(rows, list):
        return 'RESULT_NOT_LIST'
    if not all(isinstance(r, dict) for r in rows):
        return 'ROW_NOT_OBJECT'
    info = observation.get('info')
    if not isinstance(info, dict) or not all(type(info.get(k)) is int for k in ('page', 'count', 'total_count')):
        return 'PAGINATION_MISSING'
    if info['page'] != 1:
        return 'UNEXPECTED_PAGE'
    if info['count'] != len(rows) or info['total_count'] != len(rows):
        return 'MULTIPAGE_OR_TOTAL_MISMATCH'
    pages = info.get('total_pages')
    if pages is not None and (type(pages) is not int or pages not in (0, 1)):
        return 'MULTIPAGE_OR_TOTAL_MISMATCH'
    return 'ROW_TYPE_UNRECOGNIZED'


def summarize(observed):
    status = {k: observed[k].get('http') for k in PATHS}
    services_ok = complete_page(observed['services']) and all(
        row.get('type') in ('tcp', 'http') for row in observed['services']['data'])
    tunnels_ok = complete_page(observed['tunnels']) and all(
        row.get('tun_type') in ('cfd_tunnel', 'warp_connector', 'warp', 'magic', 'ip_sec', 'gre', 'cni')
        for row in observed['tunnels']['data'])
    services = observed['services']['data'] if services_ok else []
    tunnels = observed['tunnels']['data'] if tunnels_ok else []
    pg_services = [r for r in services if r.get('type') == 'tcp'
                   and r.get('app_protocol') == 'postgresql' and r.get('tcp_port') == 5432]
    insecure = sum((r.get('tls_settings') or {}).get('cert_verification_mode') in ('disabled', 'verify_ca')
                   for r in pg_services if isinstance(r.get('tls_settings') or {}, dict))
    # Cloudflare documents verify_full as the default only when TLS settings are omitted.
    # Unknown/invalid or partially configured modes must not be treated as strict TLS.
    non_strict_tls = sum(
        ('tls_settings' in r and
         (not isinstance(r['tls_settings'], dict) or
          r['tls_settings'].get('cert_verification_mode') != 'verify_full'))
        for r in pg_services)
    out = {
        'schema': 'AXIOM_PHASE2_PRIVATE_NETWORK_READONLY_V1',
        'scope': 'EXACT_SINGLE_OWNER_CLOUDFLARE_ACCOUNT',
        'http_statuses': status,
        'methods': ['GET'], 'api_requests': len(PATHS), 'cloudflare_writes': 0,
        'neon_sql_queries': 0, 'database_network_change': False,
        'private_path_verified': False, 'real_database_connection_verified': False,
        'services_complete': services_ok, 'tunnels_complete': tunnels_ok,
        'services_incomplete_reason': None if services_ok else incomplete_reason(observed['services']),
        'tunnels_incomplete_reason': None if tunnels_ok else incomplete_reason(observed['tunnels']),
        'services_first_page_rows': (len(observed['services']['data']) if isinstance(observed['services'].get('data'), list) else None),
        'service_count': len(services) if services_ok else None,
        'postgres_vpc_service_count': len(pg_services) if services_ok else None,
        'insecure_tls_postgres_service_count': insecure if services_ok else None,
        'postgres_vpc_service_non_strict_tls_count': non_strict_tls if services_ok else None,
        'tunnel_count': len(tunnels) if tunnels_ok else None,
        'healthy_tunnel_count': sum(r.get('status') == 'healthy' for r in tunnels) if tunnels_ok else None,
    }
    # Evidence can justify a negative gate, never a network qualification: metadata
    # alone cannot prove private origin reachability or a successful TLS connection.
    blockers = []
    if not services_ok:
        blockers.append('VPC_SERVICE_INVENTORY_UNVERIFIED')
    if not tunnels_ok:
        blockers.append('TUNNEL_INVENTORY_UNVERIFIED')
    elif out['healthy_tunnel_count'] == 0:
        blockers.append('NO_HEALTHY_TUNNEL_REPORTED')
    if services_ok and not pg_services:
        blockers.append('NO_POSTGRES_VPC_SERVICE_IN_CHECKED_ACCOUNT')
    if services_ok and non_strict_tls:
        blockers.append('POSTGRES_VPC_TLS_NOT_STRICT')
    blockers.append('PRIVATE_ORIGIN_REACHABILITY_UNVERIFIED')
    out['blocking_reasons'] = blockers
    if not services_ok or not tunnels_ok:
        out['classification'] = 'PRIVATE_NETWORK_INVENTORY_INCOMPLETE'
    elif not services and not tunnels:
        out['classification'] = 'NO_PRIVATE_CONNECTIVITY_RESOURCES_IN_CHECKED_ACCOUNT'
    else:
        out['classification'] = 'PRIVATE_CONNECTIVITY_CANDIDATES_EXIST_UNVERIFIED'
    return out


def run(token, fetch=fetch_fixed):
    if not isinstance(token, str) or not token or any(c in token for c in '\r\n'):
        raise ValueError('SCOPED_READ_TOKEN_MISSING_OR_INVALID')
    rows = {name: fetch(path, token) for name, path in PATHS.items()}
    return summarize(rows)


def main():
    try:
        state = run(os.environ.get('CLOUDFLARE_API_TOKEN', ''))
    except Exception:
        state = {'schema': 'AXIOM_PHASE2_PRIVATE_NETWORK_READONLY_V1',
                 'classification': 'READONLY_CHECK_FAILED_NO_GO',
                 'methods': ['GET'], 'cloudflare_writes': 0, 'neon_sql_queries': 0,
                 'private_path_verified': False, 'real_database_connection_verified': False}
    data = (json.dumps(state, sort_keys=True, indent=2) + '\n').encode()
    path = Path(OUTPUT)
    path.write_bytes(data)
    path.with_name(OUTPUT + '.sha256').write_text(hashlib.sha256(data).hexdigest() + '  ' + OUTPUT + '\n')
    print('AXIOM_PRIVATE_NETWORK_READONLY=' + state['classification'] + ' CF_WRITES=0 SQL=0')
    return 1 if state['classification'] == 'READONLY_CHECK_FAILED_NO_GO' else 0


if __name__ == '__main__':
    raise SystemExit(main())
