#!/usr/bin/env python3
"""MCN-072 Cloudflare Worker settings inventory, fail-closed and GET-only.

Never prints Worker names, binding names, payload values, bearer token, URLs,
credentials or raw provider replies. No customer or scheduler qualification.
The endpoint returns current script settings, not authoritative live execution.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

SCHEMA = 'musitu.mcn072.cloudflare_all_workers_settings_getonly.v1'
CUE = re.compile(r'(?:^|[^a-z0-9])(?:pg(?:host|port|user|database|password)?|postgres|postgresql|neon|sql|db|database|dsn|jdbc|hyperdrive|connection|pool|persistence)(?:$|[^a-z0-9])', re.I)
ALLOWED_ACCT = re.compile(r'[0-9a-f]{32}\Z')
MAX_WORKERS = 200


def digest(x):
    return hashlib.sha256(x.encode('utf-8')).hexdigest()


def raw_hash(x):
    return digest(json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=True))


def summarize_settings(name, settings):
    values = settings.get('bindings') if isinstance(settings, dict) else None
    if not isinstance(values, list):
        raise ValueError('invalid settings reply')
    if not all(isinstance(b, dict) and isinstance(b.get('type'), str) and isinstance(b.get('name'), str) for b in values):
        raise ValueError('invalid binding metadata')
    types = dict(sorted(Counter(b['type'] for b in values).items()))
    cue_count = sum(bool(CUE.search(b['name'])) for b in values)
    return {
        'script_sha256': digest(name),
        'raw_settings_sha256': raw_hash(settings),
        'binding_count': len(values),
        'types': types,
        'database_binding_name_cue_count': cue_count,
        'potential_database_binding': bool(cue_count or types.get('hyperdrive', 0)),
        'postgres_authenticated': False,
    }


def audit_account(getter, account_id):
    if not isinstance(account_id, str) or not ALLOWED_ACCT.fullmatch(account_id):
        raise ValueError('account identifier not valid')
    prefix = '/accounts/' + account_id + '/workers/scripts'
    report = {
        'schema': SCHEMA, 'method': 'GET_ONLY',
        'account_id_sha256': digest(account_id),
        'scope': 'CURRENT_WORKER_SETTINGS_ONLY_NOT_DEPLOYMENT_OR_RUNTIME',
        'worker_scripts_listed': 0, 'worker_settings_read': 0,
        'settings_read_failures': 0, 'potential_pg_binding_scripts': 0,
        'database_cue_script_hashes': [], 'candidate_type_totals': {},
        'inventory_complete': False, 'duplicate_worker_name_observed': False,
        'postgres_authenticated': False, 'cloudflare_pg_correspondence': False,
        'independent_acceptance': False, 'mcn072_qualified': False,
    }
    try:
        reply = getter(prefix)
        raw = reply.get('result') if isinstance(reply, dict) else None
        if isinstance(raw, list): entries = raw
        elif isinstance(raw, dict) and isinstance(raw.get('scripts'), list): entries = raw['scripts']
        else: return report
        if len(entries) > MAX_WORKERS:return report
        names = []
        for item in entries:
            if not isinstance(item,dict):return report
            name = item.get('id') or item.get('name')
            if not isinstance(name,str) or not name or len(name)>250:return report
            names.append(name)
        if len(set(names)) != len(names):
            report['duplicate_worker_name_observed'] = True
            return report
        info = reply.get('result_info', {})
        if isinstance(info,dict) and isinstance(info.get('total_count'),int) and info['total_count'] > len(names):return report
    except Exception:
        return report
    report['worker_scripts_listed'] = len(names)
    report['script_list_sha256'] = raw_hash(reply)
    type_totals = Counter()
    candidates = []
    for name in names:
        try:
            path = prefix + '/' + urllib.parse.quote(name, safe='') + '/settings'
            settings_reply = getter(path)
            if not isinstance(settings_reply,dict):raise ValueError('invalid')
            settings = settings_reply.get('result')
            record = summarize_settings(name,settings)
        except Exception:
            report['settings_read_failures'] += 1
            continue
        report['worker_settings_read'] += 1
        type_totals.update(record['types'])
        if record['potential_database_binding']:
            candidates.append({'script_sha256':record['script_sha256'],
                               'types':record['types'],
                               'binding_count':record['binding_count'],
                               'database_name_cue_count':record['database_binding_name_cue_count'],
                               'response_sha256':record['raw_settings_sha256']})
    report['candidate_type_totals'] = dict(sorted(type_totals.items()))
    report['potential_pg_binding_scripts'] = len(candidates)
    report['database_cue_script_hashes'] = sorted(candidates,key=lambda x:x['script_sha256'])
    report['inventory_complete'] = report['settings_read_failures']==0 and report['worker_settings_read']==len(names)
    return report


def get_cloudflare(path, token):
    # Invoked only with paths constructed from the pinned account and returned names.
    # The bearer token and raw provider replies are never logged or written.
    if not path.startswith('/accounts/') or '/workers/scripts' not in path:
        raise ValueError('path not allowlisted')
    req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,
                              headers={'Authorization':'Bearer '+token,'Accept':'application/json'},
                              method='GET')
    with urllib.request.urlopen(req, timeout=25) as response:
        obj=json.loads(response.read(5_000_000))
    if not isinstance(obj,dict) or obj.get('success') is False:
        raise ValueError('provider did not return success')
    return obj


def main():
    # Never print environment variables, account literals, API responses, errors or URLs.
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    account=os.environ.get('MCN072_CF_ACCOUNT_ID','')
    if not token or not ALLOWED_ACCT.fullmatch(account):
        print(json.dumps({'schema':SCHEMA,'audit':'CREDENTIAL_OR_ACCOUNT_UNAVAILABLE','mcn072_qualified':False}))
        return 2
    report=audit_account(lambda path:get_cloudflare(path,token),account)
    print(json.dumps(report,sort_keys=True,separators=(',',':')))
    return 0 if report['inventory_complete'] else 3

if __name__=='__main__':sys.exit(main())
