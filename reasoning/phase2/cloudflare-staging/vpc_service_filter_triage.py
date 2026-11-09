"""Bounded Cloudflare Workers VPC catalog cross-check. READ-ONLY, NO RELEASE.

Queries exactly three allowlisted GET paths (unfiltered, TCP, HTTP). An empty
page without provider-confirmed pagination is not treated as an empty account.
Never logs service names, tunnel IDs, origin hosts or raw HTTP response bodies.
"""
import hashlib
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
API = 'https://api.cloudflare.com/client/v4'
OUTPUT = 'axiom-vpc-filtered-services-readonly.json'
PATHS = {
    'all': f'/accounts/{ACCOUNT}/connectivity/directory/services?page=1&per_page=100',
    'tcp': f'/accounts/{ACCOUNT}/connectivity/directory/services?page=1&per_page=100&type=tcp',
    'http': f'/accounts/{ACCOUNT}/connectivity/directory/services?page=1&per_page=100&type=http',
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_fixed(path, token):
    """Reject arbitrary paths, methods and redirect targets before any I/O."""
    if (path not in PATHS.values() or not isinstance(token, str) or not token or
            any(char in token for char in '\r\n')):
        raise ValueError('SCOPED_TOKEN_OR_PATH_INVALID')
    req = urllib.request.Request(API + path, method='GET', headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        'User-Agent': 'AXIOM-PHASE2-VPC-FILTERED-READONLY/20261109',
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
            code = response.status
            raw = response.read(250001)
    except urllib.error.HTTPError as error:
        code = error.code
        raw = error.read(250001)
    except (TimeoutError, OSError, ValueError):
        return {'http': 'NETWORK_ERROR', 'data': None, 'info': None}
    if len(raw) > 250000:
        return {'http': code, 'data': None, 'info': None}
    try:
        doc = json.loads(raw)
    except (UnicodeError, ValueError):
        doc = None
    if not isinstance(doc, dict) or code != 200 or doc.get('success') is not True:
        return {'http': code, 'data': None, 'info': None}
    return {'http': code, 'data': doc.get('result'), 'info': doc.get('result_info')}


def complete_page(result):
    """Provider-supplied full count must establish all rows on page 1."""
    rows = result.get('data')
    info = result.get('info')
    if (result.get('http') != 200 or not isinstance(rows, list) or
            not all(isinstance(row, dict) for row in rows) or
            not isinstance(info, dict)):
        return False
    for key in ('page', 'count', 'total_count'):
        if type(info.get(key)) is not int:
            return False
    if (info['page'] != 1 or info['count'] != len(rows) or
            info['total_count'] != len(rows)):
        return False
    total_pages = info.get('total_pages')
    if total_pages is not None and (type(total_pages) is not int or total_pages not in (0, 1)):
        return False
    return True


def classify(results):
    """Only safe statuses, counts and no-go classification escape this function."""
    out = {
        'schema': 'AXIOM_PHASE2_FILTERED_VPC_SERVICE_INVENTORY_V1',
        'scope': 'SINGLE_PINNED_CLOUDFLARE_ACCOUNT',
        'http_statuses': {kind: results.get(kind, {}).get('http') for kind in PATHS},
        'cloudflare_writes': 0,
        'neon_sql': 0,
        'private_path_verified': False,
        'production_release_qualified': False,
        'account_service_count': None,
        'observed_all_first_page_count': None,
        'observed_tcp_count': None,
        'observed_http_count': None,
        'pagination_confirmed_all': False,
    }
    if any(results.get(kind, {}).get('http') != 200 or
           not isinstance(results.get(kind, {}).get('data'), list) or
           any(not isinstance(row, dict) for row in results[kind]['data'])
           for kind in PATHS):
        out['classification'] = 'CATALOG_QUERY_UNAVAILABLE'
        return out
    all_rows = results['all']['data']
    tcp_rows = results['tcp']['data']
    http_rows = results['http']['data']
    out.update({
        'observed_all_first_page_count': len(all_rows),
        'observed_tcp_count': len(tcp_rows),
        'observed_http_count': len(http_rows),
    })
    if (any(row.get('type') != 'tcp' for row in tcp_rows) or
            any(row.get('type') != 'http' for row in http_rows)):
        out['classification'] = 'FILTER_QUERY_MISMATCH'
        return out
    if (any(row.get('type') not in ('tcp', 'http') for row in all_rows) or
            len(tcp_rows) + len(http_rows) != len(all_rows)):
        out['classification'] = 'CATALOG_QUERY_CONFLICT'
        return out
    complete = all(complete_page(results[kind]) for kind in PATHS)
    out['pagination_confirmed_all'] = complete
    if not complete:
        out['classification'] = ('EMPTY_PAGES_PAGINATION_UNVERIFIED'
                                 if not all_rows else 'PAGINATION_UNVERIFIED')
        return out
    out['account_service_count'] = len(all_rows)
    out['classification'] = ('EMPTY_SERVICE_CATALOG_OBSERVED' if not all_rows
                             else 'CATALOG_ENTRIES_OBSERVED_NOT_CONNECTED')
    return out


def run(token, fetch=fetch_fixed):
    if not isinstance(token, str) or not token or any(char in token for char in '\r\n'):
        raise ValueError('SCOPED_SECRET_MISSING_OR_INVALID')
    observed = {kind: fetch(path, token) for kind, path in PATHS.items()}
    safe = classify(observed)
    safe['requests'] = len(PATHS)
    return safe


def main():
    try:
        safe = run(os.environ.get('CLOUDFLARE_API_TOKEN', ''))
    except Exception:
        # Fail closed, without exposing exception text, URLs, headers or secrets.
        safe = {'schema': 'AXIOM_PHASE2_FILTERED_VPC_SERVICE_INVENTORY_V1',
                'classification': 'CREDENTIAL_OR_RUNTIME_CHECK_FAILED',
                'private_path_verified': False, 'production_release_qualified': False,
                'cloudflare_writes': 0, 'neon_sql': 0}
    data = (json.dumps(safe, indent=2, sort_keys=True) + '\n').encode()
    name = Path(OUTPUT)
    name.write_bytes(data)
    name.with_name(name.name + '.sha256').write_text(
        hashlib.sha256(data).hexdigest() + '  ' + name.name + '\n')
    print('AXIOM_VPC_FILTERED=' + safe['classification'] + ' CF_WRITES=0 SQL=0 NO_RELEASE')
    return 1 if safe['classification'] == 'CREDENTIAL_OR_RUNTIME_CHECK_FAILED' else 0


if __name__ == '__main__':
    raise SystemExit(main())
