#!/usr/bin/env python3
"""MCN-072 single alternate Worker version-bound binding cue audit; GET only.

Targets the sole non-D1 name-cue candidate from the independently verified
all-Worker settings scan. Never exports Worker name, binding name/value,
secret, provider response, script code or URL. Read of a version is not proof
of a PostgreSQL connection or an immutable event audit trail.
"""
import hashlib
import json
import os
import re
import sys
import urllib.parse
from collections import Counter
from qualification.mcn072_all_worker_settings_readonly import get_cloudflare, digest, raw_hash

TARGET_SHA='0c6d47030a574f04dce5e8b46b0c010d234b3a15b4dafe60d5ba3d00fd0022e8'
QUEUE_SHA='858e0f26ca2186c35dd97e229a0b3b155281bab97fa9bf52cc8349d00c8ae009'
ACCOUNT='93f395f5121954671f92fffa453d6b61'
UUID_RE=re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z')
PG_CUE=re.compile(r'(?:^|_)(?:PG(?:HOST|PORT|USER|DATABASE|PASSWORD|_DSN|_URL)?|POSTGRES(?:QL)?|NEON|DATABASE_URL|DATABASE_DSN|DSN|JDBC|PSQL)(?:_|$)',re.I)
GENERIC_CUE=re.compile(r'(?:^|_)(?:DB|DATABASE|SQL|PERSISTENCE|POOL|CONNECTION)(?:_|$)',re.I)


def classify_bindings(bindings):
    if not isinstance(bindings,list) or not all(isinstance(x,dict) and isinstance(x.get('name'),str) and isinstance(x.get('type'),str) for x in bindings):
        raise ValueError('invalid binding list')
    strict=sum(bool(PG_CUE.search(x['name'])) for x in bindings)
    generic=sum(bool(GENERIC_CUE.search(x['name'])) and not PG_CUE.search(x['name']) for x in bindings)
    return {'strict_pg_cues':strict,'generic_db_cues':generic,
            'types':dict(sorted(Counter(x['type'] for x in bindings).items())),
            'binding_count':len(bindings)}


def inspect_candidate(getter, account, target_sha):
    result={'schema':'musitu.mcn072.alternate_worker_deployment_getonly.v1',
            'account_sha256':digest(account),'candidate_sha256':target_sha,
            'candidate_found':False,'same_as_queue_consumer':target_sha==QUEUE_SHA,
            'settings_read':False,'active_deployment_verified':False,
            'active_version_metadata_read':False,'active_version_strict_pg_cues':False,
            'postgres_authenticated':False,'mcn072_qualified':False,
            'method':'GET_ONLY','read_completeness':'INCOMPLETE'}
    if not isinstance(account,str) or not re.fullmatch('[0-9a-f]{32}',account) or not re.fullmatch('[0-9a-f]{64}',target_sha):return result
    prefix='/accounts/'+account+'/workers/scripts'
    try:
        all_workers=getter(prefix)
        arr=all_workers.get('result')
        if not isinstance(arr,list):return result
        names=[i.get('id') or i.get('name') for i in arr if isinstance(i,dict)]
        if not all(isinstance(s,str) for s in names) or len(names)!=len(arr) or len(set(names))!=len(names):return result
        matched=[x for x in names if digest(x)==target_sha]
        if len(matched)!=1:return result
        script=urllib.parse.quote(matched[0],safe='')
        result['candidate_found']=True
        settings=getter(prefix+'/'+script+'/settings')
        root=settings.get('result') if isinstance(settings,dict) else None
        if not isinstance(root,dict):return result
        result['current_binding_classification']=classify_bindings(root.get('bindings'))
        result['current_settings_response_sha256']=raw_hash(settings)
        result['settings_read']=True
        deployments=getter(prefix+'/'+script+'/deployments')
        payload=deployments.get('result') if isinstance(deployments,dict) else None
        listing=payload.get('deployments') if isinstance(payload,dict) else None
        if not isinstance(listing,list):return result
        result['deployment_count_read']=len(listing)
        result['deployments_response_sha256']=raw_hash(deployments)
        if not listing:
            result['read_completeness']='SETTINGS_AND_DEPLOYMENTS_READ'
            return result
        d=listing[0] if isinstance(listing[0],dict) else {}
        versions=d.get('versions')
        if not isinstance(versions,list) or not versions:return result
        if not all(isinstance(v,dict) and isinstance(v.get('percentage'),(int,float)) and isinstance(v.get('version_id'),str) for v in versions):return result
        if abs(sum(v['percentage'] for v in versions)-100)>0.001:return result
        result['active_deployment_verified']=True
        result['active_version_count']=len(versions)
        result['active_traffic_percentages']=sorted([v['percentage'] for v in versions])
        reads=[]
        for v in versions:
            vid=v['version_id']
            if not UUID_RE.fullmatch(vid):return result
            vr=getter(prefix+'/'+script+'/versions/'+urllib.parse.quote(vid,safe=''))
            record=vr.get('result') if isinstance(vr,dict) else None
            resources=record.get('resources') if isinstance(record,dict) else None
            bindings=resources.get('bindings') if isinstance(resources,dict) else None
            classified=classify_bindings(bindings)
            reads.append({'version_sha256':digest(vid),'response_sha256':raw_hash(vr),'bindings':classified})
        result['active_versions']=reads
        result['active_version_metadata_read']=True
        result['active_version_strict_pg_cues']=any(v['bindings']['strict_pg_cues'] for v in reads)
        result['read_completeness']='ACTIVE_DEPLOYMENT_AND_VERSION_BINDING_METADATA_READ'
    except Exception:
        # No provider error bodies, URLs, binding names or token information.
        return result
    return result


def main():
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not token:
        print(json.dumps({'schema':'musitu.mcn072.alternate_worker_deployment_getonly.v1','read_completeness':'NO_CREDENTIAL','mcn072_qualified':False}))
        return 2
    report=inspect_candidate(lambda path:get_cloudflare(path,token),ACCOUNT,TARGET_SHA)
    print(json.dumps(report,sort_keys=True,separators=(',',':')))
    return 0 if report.get('read_completeness')=='ACTIVE_DEPLOYMENT_AND_VERSION_BINDING_METADATA_READ' else 3

if __name__=='__main__':sys.exit(main())
