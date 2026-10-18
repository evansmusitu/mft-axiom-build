"""Read-only Cloudflare Access/HTTP correlation with no identity or raw path output.

Analytics sampling and unbound logs do NOT certify Android/browser-origin rendering.
"""
import json
import os
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = 'https://api.cloudflare.com/client/v4'
ACCOUNT = '93f395f5121954671f92fffa453d6b61'
HOST = 'studio.mftintelligence.com'
START = '2026-10-18T06:00:00Z'
END = '2026-10-18T06:45:00Z'
JOB_START = '2026-10-18T06:34:00Z'
JOB_END = '2026-10-18T06:37:00Z'
UUID_RE = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
OUTPUT = pathlib.Path('studio-access-usage-correlation-20261018.json')


def summarize_edge_groups(groups):
    out = {'edge_sampled_count': 0, 'mobile_post_dispatch_sampled_count': 0,
           'mobile_post_submit_sampled_count': 0, 'mobile_post_approve_sampled_count': 0,
           'mobile_post_sync_sampled_count': 0, 'session_get_sampled_count': 0,
           'browser_origin_proven': False, 'http_analytics_is_sampled': True}
    for item in (groups if isinstance(groups, list) else []):
        if not isinstance(item, dict) or not isinstance(item.get('dimensions'), dict):
            continue
        dimensions = item['dimensions']
        path, method, device = (dimensions.get('clientRequestPath'),
                                dimensions.get('clientRequestHTTPMethodName'),
                                dimensions.get('clientDeviceType'))
        n = item.get('count')
        if type(n) is not int or not 0 <= n <= 100000:
            continue
        out['edge_sampled_count'] += n
        if method == 'GET' and path == '/api/session':
            out['session_get_sampled_count'] += n
        if method != 'POST' or not isinstance(path, str) or not isinstance(device, str) or device.lower() != 'mobile':
            continue
        if path == '/api/jobs':
            out['mobile_post_submit_sampled_count'] += n
        for action, suffix in (('dispatch', 'dispatch'), ('approve', 'approve'), ('sync', 'sync')):
            if re.fullmatch('/api/jobs/' + UUID_RE + '/' + suffix, path):
                out['mobile_post_' + action + '_sampled_count'] += n
    return out


def summarize_access_logs(logs):
    out = {'studio_allowed_logins_in_window': 0, 'studio_denied_logins_in_window': 0,
           'access_events_seen': 0, 'staff_browser_session_bound_to_cpu_job': False}
    if not isinstance(logs, list):
        return out
    for event in logs:
        if not isinstance(event, dict) or event.get('app_domain') != HOST:
            continue
        stamp = event.get('created_at')
        if not isinstance(stamp, str) or not START <= stamp[:19]+'Z' <= END:
            continue
        if event.get('action') not in ('login', None):
            continue
        out['access_events_seen'] += 1
        if event.get('allowed') is True:
            out['studio_allowed_logins_in_window'] += 1
        elif event.get('allowed') is False:
            out['studio_denied_logins_in_window'] += 1
    return out


def request_json(method, url, token, body=None):
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=22) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (OSError, ValueError):
        return 0, None


def main():
    receipt = {'schema': 'musitu.studio.access-usage-readonly-correlation.v1',
               'checked_at_utc': datetime.now(timezone.utc).isoformat(),
               'read_only': True, 'cloudflare_mutated': False,
               'staff_browser_session_bound_to_cpu_job': False,
               'genuine_android_browser_to_r2_certified': False,
               'access_window': {'start': START, 'end': END},
               'job_time_window': {'start': JOB_START, 'end': JOB_END},
               'zone_verified': False}
    token = os.getenv('CLOUDFLARE_API_TOKEN') or os.getenv('CF_API_TOKEN')
    if not token:
        receipt['outcome'] = 'NO_AUTHORIZED_CLOUDFLARE_READ_TOKEN'
    else:
        q = urllib.parse.urlencode({'since': START, 'until': END, 'limit': 100, 'direction': 'desc'})
        status, body = request_json('GET', f'{BASE}/accounts/{ACCOUNT}/access/logs/access_requests?{q}', token)
        receipt['access_log_status'] = status
        if status == 200 and isinstance(body, dict) and body.get('success') is True:
            receipt.update(summarize_access_logs(body.get('result')))
            receipt['access_log_readable'] = True
        else:
            receipt['access_log_readable'] = False
        zones_status, zones_body = request_json('GET', BASE+'/zones?name=mftintelligence.com&status=active', token)
        receipt['zone_lookup_status'] = zones_status
        zones = zones_body.get('result') if isinstance(zones_body, dict) and zones_body.get('success') is True else []
        matches = [z for z in (zones or []) if isinstance(z, dict) and z.get('name')=='mftintelligence.com'
                   and (z.get('account') or {}).get('id') == ACCOUNT]
        if len(matches) == 1:
            receipt['zone_verified'] = True
            query = '''query StudioUsage($zoneTag: string, $filter: HttpRequestsAdaptiveGroupsFilter_InputObject) {
                viewer { zones(filter: {zoneTag: $zoneTag}) {
                  httpRequestsAdaptiveGroups(filter: $filter, limit: 90, orderBy: [count_DESC]) {
                    count dimensions { clientRequestPath clientRequestHTTPMethodName clientDeviceType edgeResponseStatus }
                  }
                }}
            }'''
            variables = {'zoneTag': matches[0]['id'], 'filter': {
                'clientRequestHTTPHost': HOST, 'clientRequestPath_like': '/api/%',
                'requestSource': 'eyeball', 'datetime_geq': JOB_START, 'datetime_leq': JOB_END}}
            graph_status, graph = request_json('POST', BASE+'/graphql', token, {'query': query, 'variables': variables})
            receipt['graphql_status'] = graph_status
            if graph_status == 200 and isinstance(graph, dict) and not graph.get('errors'):
                zs = (((graph.get('data') or {}).get('viewer') or {}).get('zones') or [])
                if len(zs) == 1 and isinstance(zs[0], dict) and isinstance(zs[0].get('httpRequestsAdaptiveGroups'), list):
                    receipt.update(summarize_edge_groups(zs[0]['httpRequestsAdaptiveGroups']))
                    receipt['analytics_query_usable'] = True
            receipt.setdefault('analytics_query_usable', False)
        receipt['outcome'] = 'BOUNDED_PROVIDER_CORRELATION_RECORDED'
    OUTPUT.write_text(json.dumps(receipt, indent=2, sort_keys=True)+'\n')
    print('STUDIO_USAGE_FORENSICS='+json.dumps(receipt, sort_keys=True))


if __name__ == '__main__':
    main()
