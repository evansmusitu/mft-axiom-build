#!/usr/bin/env python3
"""MCN-072 GET-only Cloudflare Worker current-content *static* correspondence.

Never outputs source, Worker identities, binding names, values, credentials, or URL.
Source scans are not runtime traces, PostgreSQL authentication, or fairness proof.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT='93f395f5121954671f92fffa453d6b61'  # source-pinned known canonical account
QUEUE_SHA='858e0f26ca2186c35dd97e229a0b3b155281bab97fa9bf52cc8349d00c8ae009'
CANDIDATE_SHA='0c6d47030a574f04dce5e8b46b0c010d234b3a15b4dafe60d5ba3d00fd0022e8'
SCHEMA='musitu.mcn072.worker_static_link_getonly.v1'
ROOT='/accounts/'+ACCOUNT+'/workers/scripts'
VID_RE=re.compile(r'[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\Z')
NAME_RE=re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
PG_CODE_MARKERS=(b'@neondatabase/serverless',b'postgresql://',b'postgres://',
                 b'neon.tech',b'skip locked',b'pg.pool',b'pg.client')
SCHEDULER_TABLES=(b'axiom_distributed_execution_jobs',
                  b'axiom_tenant_fair_cursor',b'axiom_tenant_fair_served')

class ProbeError(Exception):pass

def sha(raw):return hashlib.sha256(raw if isinstance(raw,bytes) else raw.encode('utf8')).hexdigest()

def _result(reply):
    if type(reply) is not dict or reply.get('success') is not True or 'result' not in reply:
        raise ProbeError('UNTRUSTED_PROVIDER_ENVELOPE')
    return reply['result']

def _active_version(getter,prefix):
    root=_result(getter(prefix+'/deployments'))
    deployments=root.get('deployments') if type(root) is dict else None
    if type(deployments) is not list or not deployments or type(deployments[0]) is not dict:
        raise ProbeError('DEPLOYMENT_INCOMPLETE')
    entries=deployments[0].get('versions')
    if type(entries) is not list or len(entries)!=1 or type(entries[0]) is not dict:
        raise ProbeError('SINGLE_ACTIVE_VERSION_REQUIRED')
    info=entries[0]
    if (type(info.get('percentage')) not in (int,float)
            or abs(info['percentage']-100)>0.001):
        raise ProbeError('INACTIVE_OR_PARTIAL_TRAFFIC')
    vid=info.get('version_id')
    if type(vid) is not str or not VID_RE.fullmatch(vid):
        raise ProbeError('INVALID_VERSION_ID')
    item=_result(getter(prefix+'/versions/'+vid))
    resources=item.get('resources') if type(item) is dict else None
    script=resources.get('script') if type(resources) is dict else None
    handlers=script.get('handlers') if type(script) is dict else None
    if type(handlers) is not list or not all(type(x) is str for x in handlers):
        raise ProbeError('UNOBSERVABLE_HANDLERS')
    bindings=resources.get('bindings') if type(resources) is dict else None
    if type(bindings) is not list or not all(type(b) is dict and type(b.get('type')) is str for b in bindings):
        raise ProbeError('INVALID_BINDINGS')
    return {'handlers':set(handlers),'service_bindings':sum(b.get('type')=='service' for b in bindings),
            'active_version_sha256':sha(vid)}

def inspect_static(getter, content_getter, account, queue_sha, candidate_sha):
    result={'schema':SCHEMA,'method':'GET_ONLY','read_complete':False,
            'scope':'CURRENT_CONTENT_AND_ACTIVE_VERSION_HANDLERS_ONLY',
            'queue_candidate_literal_reference':False,'candidate_queue_literal_reference':False,
            'postgres_authenticated':False,'cloudflare_postgres_correspondence':False,
            'independent_pre_registration':False,'independent_acceptance':False,
            'real_fairness_windows':0,'mcn072_qualified':False,'commercial_ga':'NO_GO'}
    if (type(account) is not str or not re.fullmatch(r'[0-9a-f]{32}',account)
        or type(queue_sha) is not str or not re.fullmatch(r'[0-9a-f]{64}',queue_sha)
        or type(candidate_sha) is not str or not re.fullmatch(r'[0-9a-f]{64}',candidate_sha)
        or queue_sha==candidate_sha):return result
    root='/accounts/'+account+'/workers/scripts'
    try:
        listed=_result(getter(root))
        if type(listed) is not list or not (2<=len(listed)<=200):raise ProbeError('UNEXPECTED_INVENTORY')
        names=[]
        for item in listed:
            if type(item) is not dict:raise ProbeError('INVALID_WORKER')
            name=item.get('id') or item.get('name')
            if type(name) is not str or not NAME_RE.fullmatch(name):raise ProbeError('INVALID_SCRIPT_NAME')
            names.append(name)
        if len(set(names))!=len(names):raise ProbeError('DUPLICATE_WORKER')
        q_matches=[n for n in names if sha(n)==queue_sha]
        p_matches=[n for n in names if sha(n)==candidate_sha]
        if len(q_matches)!=1 or len(p_matches)!=1:raise ProbeError('WORKER_IDENTITY_UNRESOLVED')
        q,p=q_matches[0],p_matches[0]
        qpath=root+'/'+urllib.parse.quote(q,safe='')
        ppath=root+'/'+urllib.parse.quote(p,safe='')
        q_version=_active_version(getter,qpath)
        p_version=_active_version(getter,ppath)
        qcode=content_getter(qpath+'/content/v2')
        pcode=content_getter(ppath+'/content/v2')
        if type(qcode) is not bytes or type(pcode) is not bytes or not (0<len(qcode)<=3_000_000 and 0<len(pcode)<=3_000_000):
            raise ProbeError('CODE_CONTENT_UNOBSERVABLE')
        qlower=qcode.lower()
        plower=pcode.lower()
        result.update({
            'read_complete':True,
            'queue_handler_observed':'queue' in q_version['handlers'],
            'candidate_fetch_handler_observed':'fetch' in p_version['handlers'],
            'candidate_queue_handler_observed':'queue' in p_version['handlers'],
            'queue_active_version_sha256':q_version['active_version_sha256'],
            'candidate_active_version_sha256':p_version['active_version_sha256'],
            'queue_active_service_binding_count':q_version['service_bindings'],
            'candidate_active_service_binding_count':p_version['service_bindings'],
            'queue_current_code_sha256':sha(qcode),
            'candidate_current_code_sha256':sha(pcode),
            'queue_current_code_bytes':len(qcode),
            'candidate_current_code_bytes':len(pcode),
            'queue_candidate_literal_reference':p.lower().encode('ascii') in qlower,
            'candidate_queue_literal_reference':q.lower().encode('ascii') in plower,
            'queue_scheduler_table_marker_count':sum(x in qlower for x in SCHEDULER_TABLES),
            'candidate_scheduler_table_marker_count':sum(x in plower for x in SCHEDULER_TABLES),
            'queue_pg_code_marker_count':sum(x in qlower for x in PG_CODE_MARKERS),
            'candidate_pg_code_marker_count':sum(x in plower for x in PG_CODE_MARKERS),
            'static_scan_witness_not_qualification':True,
        })
    except Exception:
        # No exception details, URLs, Worker source, identifiers, or secrets in output.
        return result
    return result

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

OPENER=urllib.request.build_opener(NoRedirect())

def _request(path,token,binary=False):
    if not token or type(token) is not str or len(token)>4096 or any(c.isspace() for c in token):
        raise ProbeError('NO_TOKEN')
    prefix=re.escape(ROOT)
    if binary:
        allowed=re.fullmatch(prefix+r'/[A-Za-z0-9_.-]{1,128}/content/v2',path)
    else:
        allowed=(path==ROOT or re.fullmatch(prefix+r'/[A-Za-z0-9_.-]{1,128}/deployments',path)
                 or re.fullmatch(prefix+r'/[A-Za-z0-9_.-]{1,128}/versions/[0-9a-fA-F-]{36}',path))
    if not allowed:raise ProbeError('UNAPPROVED_ENDPOINT')
    req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,
        method='GET',headers={'Authorization':'Bearer '+token,
            'Accept':'*/*' if binary else 'application/json',
            'User-Agent':'MUSITU-MCN072-StaticLink-ReadOnly/1.0'})
    with OPENER.open(req,timeout=20) as response:
        if response.status!=200:raise ProbeError('BAD_STATUS')
        body=response.read((3_000_000 if binary else 400_000)+1)
    if len(body)>(3_000_000 if binary else 400_000):raise ProbeError('OVERSIZE')
    if binary:return body
    return json.loads(body)

def main():
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not token:
        print(json.dumps({'schema':SCHEMA,'read_complete':False,'mcn072_qualified':False,'commercial_ga':'NO_GO'}))
        return 2
    result=inspect_static(lambda p:_request(p,token),lambda p:_request(p,token,binary=True),
                          ACCOUNT,QUEUE_SHA,CANDIDATE_SHA)
    print(json.dumps(result,sort_keys=True,separators=(',',':')))
    return 0 if result.get('read_complete') else 3

if __name__=='__main__':sys.exit(main())
