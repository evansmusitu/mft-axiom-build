#!/usr/bin/env python3
"""Sanitized Cloudflare GET-only MCN-072 exact Queue consumer / active Worker binding audit.
No Worker source, binding values, auth material, identifiers or raw provider replies exported.
Never qualifies PostgreSQL connection, event correspondence, or fairness.
"""
import collections
import hashlib
import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, '.')
from qualification import mcn072_cloudflare_consumer_field_diag as old

ACCOUNT = old.ACCOUNT
BASE = old.BASE
OUT = Path('mcn072-worker-binding-readonly.json')
SAFE = re.compile(r'^[A-Za-z0-9_.-]{1,128}$')
NAME_CUE = re.compile(r'(?:PG|POSTGRES|DATABASE|NEON|SQL|SCHEDUL|DB)(?:_|$)|^(?:PG|POSTGRES|DATABASE|NEON|SQL|SCHEDUL|DB)', re.I)
MAX_BODY = 131072


def digest(v):
    return hashlib.sha256(v if isinstance(v, bytes) else str(v).encode()).hexdigest()


def _read_json(path, token, opener):
    """Only Cloudflare endpoint Worker current settings is permitted here."""
    if not re.fullmatch(r'/client/v4/accounts/' + ACCOUNT + r'/workers/scripts/[A-Za-z0-9_.-]{1,128}/settings', path):
        raise old.ProbeFailure('PATH_NOT_ALLOWLISTED')
    req = urllib.request.Request(BASE + path, method='GET', headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        'User-Agent': 'MUSITU-MCN072-ReadOnly-Bindings/1.0'})
    try:
        with opener.open(req, timeout=15) as response:
            if response.status != 200 or 'application/json' not in response.headers.get('Content-Type','').lower():
                raise old.ProbeFailure('SETTINGS_HTTP_OR_MIME_INVALID')
            raw = response.read(MAX_BODY + 1)
    except urllib.error.HTTPError as e:
        raise old.ProbeFailure('SETTINGS_HTTP_' + str(e.code)) from None
    except (urllib.error.URLError, OSError, TimeoutError):
        raise old.ProbeFailure('SETTINGS_TRANSPORT_UNAVAILABLE') from None
    if len(raw)>MAX_BODY: raise old.ProbeFailure('SETTINGS_TOO_LARGE')
    try: payload = json.loads(raw,object_pairs_hook=old.unique_object)
    except (ValueError,UnicodeError): raise old.ProbeFailure('SETTINGS_JSON_INVALID') from None
    if type(payload) is not dict or payload.get('success') is not True or type(payload.get('result')) is not dict:
        raise old.ProbeFailure('SETTINGS_ENVELOPE_INVALID')
    return payload['result'], digest(raw)


def binding_summary(items):
    if type(items) is not list or len(items)>128: raise old.ProbeFailure('BINDINGS_SHAPE_INVALID')
    seen=set(); summary=[]
    for item in items:
        if type(item) is not dict: raise old.ProbeFailure('BINDING_SHAPE_INVALID')
        name, kind=item.get('name'),item.get('type')
        if type(name) is not str or not SAFE.fullmatch(name):raise old.ProbeFailure('BINDING_NAME_INVALID')
        if type(kind) is not str or not SAFE.fullmatch(kind):raise old.ProbeFailure('BINDING_TYPE_INVALID')
        if name in seen:raise old.ProbeFailure('BINDING_DUPLICATE')
        seen.add(name)
        # Do not read or serialize the binding's text, credential, host or URL values.
        summary.append({'name_sha256':digest(name),'type':kind,
                        'database_name_cue':bool(NAME_CUE.search(name))})
    return sorted(summary,key=lambda x:x['name_sha256'])


def main():
    result={'schema':'musitu.mcn072.provider_worker_binding_getonly.v1',
            'qualification':'NO_GO','mcn072_qualified':False,
            'postgres_scheduler_authenticated':False,
            'cloudflare_postgres_event_correspondence':False,
            'independent_reviewer_accepted':False,
            'provider_get_only':True,'secret_values_exported':False,
            'worker_source_exported':False,'cloudflare_mutations':0,'pg_mutations':0}
    try:
        token=os.environ.get('CLOUDFLARE_API_TOKEN','')
        if not isinstance(token,str) or len(token)<12 or any(c.isspace() for c in token):
            raise old.ProbeFailure('TOKEN_NOT_PRESENT')
        opener=urllib.request.build_opener(old.NoRedirect())
        inventory,_=old.fetch(old.LIST_PATH,token,opener)
        queues=inventory.get('result'); meta=inventory.get('result_info')
        if type(queues) is not list or len(queues)!=1 or type(meta) is not dict or meta.get('total_pages')!=1 or meta.get('total_count')!=1:
            raise old.ProbeFailure('QUEUE_INVENTORY_NOT_COMPLETE_SINGLETON')
        qid=old.checked_id(queues[0].get('queue_id'))
        queue_env,_=old.fetch(old.PREFIX+'/'+qid,token,opener)
        q=queue_env.get('result')
        if type(q) is not dict or q.get('queue_id')!=qid:raise old.ProbeFailure('QUEUE_DETAIL_MISMATCH')
        qname=q.get('queue_name')
        if type(qname) is not str or not 0<len(qname)<=128:raise old.ProbeFailure('QUEUE_NAME_INVALID')
        rows=q.get('consumers')
        if type(rows) is not list or len(rows)!=1 or q.get('consumers_total_count')!=1:
            raise old.ProbeFailure('QUEUE_CONSUMER_NOT_SINGLETON')
        cid,kind=old.validate_consumer(rows[0],qname)
        if kind!='worker':raise old.ProbeFailure('CONSUMER_NOT_WORKER')
        listing_env,_=old.fetch(old.PREFIX+'/'+qid+'/consumers',token,opener)
        lst=listing_env.get('result')
        if type(lst) is not list or len(lst)!=1:raise old.ProbeFailure('CONSUMER_LIST_NOT_SINGLETON')
        cid2,kind2=old.validate_consumer(lst[0],qname)
        if cid2!=cid or kind2!=kind:raise old.ProbeFailure('CONSUMER_LIST_CONFLICT')
        exact_env,_=old.fetch(old.PREFIX+'/'+qid+'/consumers/'+cid,token,opener)
        exact=exact_env.get('result')
        if type(exact) is not dict or old.validate_consumer(exact,qname)!=(cid,'worker'):
            raise old.ProbeFailure('EXACT_CONSUMER_CONFLICT')
        sources=(rows[0],lst[0],exact)
        declared={old.script_value(v) for v in sources}-{None}
        if len(declared)>1:raise old.ProbeFailure('DOCUMENTED_SCRIPT_CONFLICT')
        aliases={old.script_alias_value(v) for v in sources}-{None}
        if len(aliases)!=1:raise old.ProbeFailure('ALIAS_UNKNOWN_OR_CONFLICT')
        alias=aliases.pop()
        if not all(old.script_alias_value(v)==alias for v in sources):raise old.ProbeFailure('ALIAS_NOT_TRIPLY_OBSERVED')
        if declared and next(iter(declared))!=alias:raise old.ProbeFailure('SCRIPT_NAME_ALIAS_CONFLICT')
        workers,_,inventory_complete=old.worker_listing(token,opener)
        if alias not in workers:raise old.ProbeFailure('ALIAS_NOT_IN_WORKER_INVENTORY')
        dep_env,dep_digest=old.fetch(old.WORKERS_PREFIX+alias+'/deployments',token,opener)
        deps=dep_env.get('result',{}).get('deployments')
        if type(deps) is not list or not deps:raise old.ProbeFailure('NO_DEPLOYMENT')
        versions=deps[0].get('versions') if type(deps[0]) is dict else None
        if type(versions) is not list or len(versions)!=1 or versions[0].get('percentage')!=100:
            raise old.ProbeFailure('ACTIVE_VERSION_NOT_UNIQUE_100')
        vid=versions[0].get('version_id')
        if type(vid) is not str or not old.VERSION_ID_RE.fullmatch(vid):raise old.ProbeFailure('ACTIVE_VERSION_INVALID')
        v_env,v_digest=old.fetch(old.WORKERS_PREFIX+alias+'/versions/'+vid,token,opener)
        v=v_env.get('result')
        if type(v) is not dict or v.get('id')!=vid:raise old.ProbeFailure('VERSION_ID_MISMATCH')
        resources=v.get('resources',{})
        if type(resources) is not dict:raise old.ProbeFailure('VERSION_RESOURCES_INVALID')
        script=resources.get('script')
        if type(script) is not dict or type(script.get('handlers')) is not list or 'queue' not in script['handlers']:
            raise old.ProbeFailure('ACTIVE_VERSION_NO_QUEUE_HANDLER')
        active_bindings=binding_summary(resources.get('bindings') or [])
        settings,settings_digest=_read_json(old.WORKERS_PREFIX+alias+'/settings',token,opener)
        current_bindings=binding_summary(settings.get('bindings') or [])
        # Deployments must still be stable when metadata read completes.
        dep_check,dep_check_digest=old.fetch(old.WORKERS_PREFIX+alias+'/deployments',token,opener)
        if dep_digest != dep_check_digest:raise old.ProbeFailure('DEPLOYMENT_CHANGED_DURING_READ')
        def compact(items):
            return {'count':len(items),'types':dict(sorted(collections.Counter(x['type'] for x in items).items())),
                    'database_name_cue_counts':dict(sorted(collections.Counter(x['type'] for x in items if x['database_name_cue']).items()))}
        result.update({'observation_status':'CLOUDFLARE_CONSUMER_WORKER_SETTINGS_OBSERVED',
                       'documented_script_name_present':bool(declared),
                       'undocumented_script_alias_triple_match':True,
                       'worker_inventory_complete':inventory_complete,
                       'queue_id_sha256':digest(qid),'consumer_id_sha256':digest(cid),
                       'candidate_script_sha256':digest(alias),'active_version_id_sha256':digest(vid),
                       'active_deployment_response_sha256':dep_digest,
                       'active_version_response_sha256':v_digest,
                       'current_settings_response_sha256':settings_digest,
                       'active_version_bindings':compact(active_bindings),
                       'current_settings_bindings':compact(current_bindings),
                       'binding_name_type_fingerprints_active_version':active_bindings,
                       'binding_name_type_fingerprints_current_settings':current_bindings,
                       'same_binding_name_type_set':active_bindings==current_bindings,
                       'actual_postgres_host_or_database_verified':False})
    except old.ProbeFailure as e:
        result.update({'observation_status':'BLOCKED','reason_code':str(e)})
    except Exception:
        result.update({'observation_status':'BLOCKED','reason_code':'UNCLASSIFIED_PROVIDER_FAILURE'})
    serialized=(json.dumps(result,sort_keys=True,indent=2)+'\n').encode()
    OUT.write_bytes(serialized)
    OUT.with_suffix('.json.sha256').write_text(digest(serialized)+'  '+OUT.name+'\n')
    print(json.dumps({'observation_status':result.get('observation_status'),
                      'reason_code':result.get('reason_code'),
                      'active_version_binding_types':result.get('active_version_bindings',{}).get('types',{}),
                      'mcn072_qualified':False,'secret_values_exported':False},sort_keys=True))
    return 0 if result.get('observation_status')!='BLOCKED' else 2

if __name__=='__main__':sys.exit(main())
