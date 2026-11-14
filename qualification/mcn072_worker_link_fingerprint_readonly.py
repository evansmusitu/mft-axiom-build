#!/usr/bin/env python3
"""Bounded no-export GET-only content correspondence hints for two Cloudflare Workers.

Scans only current /content/v2 responses. Raw source is *never* printed,
written, uploaded or included in error messages; source content could differ
from the active version. Zero client secrets, Worker names, or URLs exported.
Boolean code-presence hints never qualify an actual runtime/PG connection.
"""
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from qualification.mcn072_all_worker_settings_readonly import get_cloudflare, digest

ACCOUNT='93f395f5121954671f92fffa453d6b61'
QUEUE_SHA='858e0f26ca2186c35dd97e229a0b3b155281bab97fa9bf52cc8349d00c8ae009'
CANDIDATE_SHA='0c6d47030a574f04dce5e8b46b0c010d234b3a15b4dafe60d5ba3d00fd0022e8'
SCHEMA='musitu.mcn072.queue_to_pg_candidate_current_code_hints_getonly.v1'


def fingerprint_pair(queue_name,candidate_name,queue_bytes,candidate_bytes):
    if not isinstance(queue_bytes,bytes) or not isinstance(candidate_bytes,bytes):raise ValueError('contents must be bytes')
    q=queue_bytes.lower(); c=candidate_bytes.lower()
    return {
      'source_scope':'CURRENT_CONTENT_ONLY_NOT_DEPLOYED_VERSION',
      'queue_content_sha256':hashlib.sha256(queue_bytes).hexdigest(),
      'queue_content_bytes':len(queue_bytes),
      'candidate_content_sha256':hashlib.sha256(candidate_bytes).hexdigest(),
      'candidate_content_bytes':len(candidate_bytes),
      'candidate_name_literal_in_queue_current_content':candidate_name.lower().encode() in q,
      'queue_current_content_neon_cue':b'neon' in q,
      'queue_current_content_postgres_cue':b'postgres' in q,
      'queue_current_content_job_table_cue':b'axiom_distributed_execution_jobs' in q,
      'queue_current_content_fair_cursor_cue':b'axiom_tenant_fair_cursor' in q,
      'candidate_current_content_neon_cue':b'neon' in c,
      'candidate_current_content_postgres_cue':b'postgres' in c,
      'candidate_current_content_job_table_cue':b'axiom_distributed_execution_jobs' in c,
      'candidate_current_content_fair_cursor_cue':b'axiom_tenant_fair_cursor' in c,
      'correspondence_authenticated':False,
      'mcn072_qualified':False,
    }


def inspect_pair(get_json,get_binary,account_id,queue_sha,candidate_sha):
    out={'schema':SCHEMA,'source_pair_complete':False,'method':'GET_ONLY','postgres_authenticated':False,
         'correspondence_authenticated':False,'mcn072_qualified':False}
    if not re.fullmatch('[0-9a-f]{32}',account_id):return out
    for sha in [queue_sha,candidate_sha]:
        if not re.fullmatch('[0-9a-f]{64}',sha):return out
    base='/accounts/'+account_id+'/workers/scripts'
    try:
        listing=get_json(base)
        arr=listing.get('result') if isinstance(listing,dict) else None
        if not isinstance(arr,list):return out
        names=[x.get('id') or x.get('name') for x in arr if isinstance(x,dict)]
        if len(names)!=len(arr) or not all(isinstance(x,str) and x for x in names) or len(set(names))!=len(names):return out
        qn=[x for x in names if digest(x)==queue_sha]
        cn=[x for x in names if digest(x)==candidate_sha]
        if len(qn)!=1 or len(cn)!=1 or qn[0]==cn[0]:return out
        qcontent=get_binary(base+'/'+urllib.parse.quote(qn[0],safe='')+'/content/v2')
        ccontent=get_binary(base+'/'+urllib.parse.quote(cn[0],safe='')+'/content/v2')
        if not isinstance(qcontent,bytes) or not isinstance(ccontent,bytes) or len(qcontent)>3_000_000 or len(ccontent)>3_000_000:return out
        out.update(fingerprint_pair(qn[0],cn[0],qcontent,ccontent))
        out['source_pair_complete']=True
    except Exception:
        return out
    return out


def get_binary(path,token):
    if not path.startswith('/accounts/'+ACCOUNT+'/workers/scripts/') or not path.endswith('/content/v2'):
        raise ValueError('not an approved Cloudflare content GET')
    req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,
        method='GET',headers={'Authorization':'Bearer '+token,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=30) as resp:
        return resp.read(3_000_001)


def main():
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not token:
        print(json.dumps({'schema':SCHEMA,'source_pair_complete':False,'mcn072_qualified':False}))
        return 2
    result=inspect_pair(lambda path:get_cloudflare(path,token),lambda path:get_binary(path,token),ACCOUNT,QUEUE_SHA,CANDIDATE_SHA)
    print(json.dumps(result,sort_keys=True,separators=(',',':')))
    return 0 if result['source_pair_complete'] else 3

if __name__=='__main__':sys.exit(main())
