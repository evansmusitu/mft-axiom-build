"""Credential-free bounded public HTML reachability observation; not legal approval."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request

URLS = {
    'privacy': 'https://mcp.mftintelligence.com/privacy',
    'terms': 'https://mcp.mftintelligence.com/terms',
    'docs': 'https://mcp.mftintelligence.com/docs',
    'support': 'https://github.com/evansmusitu/mft-axiom-build/issues',
}
MAX_BODY = 524288


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def assess_public_page(name, status, content_type, body):
    base = {
        'schema': 'musitu.axiom.public_page_diagnostic.v1',
        'page': name,
        'status': 'PUBLIC_HTML_NOT_CONFIRMED',
        'http_status': status if type(status) is int and 100 <= status <= 599 else None,
        'legal_signoff_verified': False,
        'commercial_ga_qualified': False,
        'openai_submission_approved': False,
    }
    if name not in URLS:
        return {**base, 'status': 'UNAUTHORIZED_PAGE_IDENTIFIER'}
    if (status != 200 or not isinstance(content_type, str)
            or 'text/html' not in content_type.lower()
            or not isinstance(body, bytes) or not 200 <= len(body) <= MAX_BODY):
        return base
    head = body[:128].lower().lstrip()
    if not (head.startswith(b'<!doctype html') or head.startswith(b'<html')):
        return base
    lower = body.lower()
    if b'cf-chl' in lower or b'cf_chl' in lower or b'just a moment' in lower:
        return base
    return {**base, 'status': 'PUBLIC_HTML_OBSERVED_NOT_LEGALLY_APPROVED'}


def probe_page(name, opener=None):
    if name not in URLS:
        return assess_public_page(name, None, '', b'')
    if opener is None:
        opener = urllib.request.build_opener(_NoRedirect()).open
    request = urllib.request.Request(URLS[name], method='GET', headers={
        'Accept': 'text/html',
        'User-Agent': 'MUSITU-Public-Reachability-Diagnostic/1.0',
    })
    try:
        with opener(request, timeout=15) as response:
            return assess_public_page(name, response.status,
                                      response.headers.get('Content-Type', ''),
                                      response.read(MAX_BODY + 1))
    except urllib.error.HTTPError as exc:
        return assess_public_page(name, exc.code, '', b'')
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return assess_public_page(name, None, '', b'')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Public page GET only; never legal release')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args(argv)
    result = {
        'schema': 'musitu.axiom.public_pages_diagnostic.v1',
        'source': 'CREDENTIAL_FREE_BOUNDED_HTTP_GET',
        'pages': {name: probe_page(name) for name in URLS},
        'legal_signoff_verified': False,
        'commercial_ga_qualified': False,
        'openai_submission_approved': False,
    }
    result['all_pages_html_observed'] = all(
        v['status'] == 'PUBLIC_HTML_OBSERVED_NOT_LEGALLY_APPROVED'
        for v in result['pages'].values()
    )
    try:
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(result, output, sort_keys=True, indent=2, allow_nan=False)
            output.write('\n')
    except OSError:
        print('PUBLIC_PAGES=BLOCKED_REPORT_WRITE_UNAVAILABLE')
        return 2
    print('PUBLIC_PAGES_HTML_OBSERVED=' + str(result['all_pages_html_observed']))
    for name, record in result['pages'].items():
        print('PUBLIC_PAGE_' + name.upper() + '=' + record['status'])
    print('OPENAI_PUBLICATION_AND_COMMERCIAL_GA=NOT_APPROVED_BY_PAGE_CHECK')
    return 0 if result['all_pages_html_observed'] or not args.strict else 1


if __name__ == '__main__':
    raise SystemExit(main())
