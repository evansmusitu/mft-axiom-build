#!/usr/bin/env python3
"""GET-only Cloudflare observability and route readback, unqualified MCN-072.

No account/script/host/binding/secret values, request URLs or raw responses are emitted.
Returns null for unknown settings; never infers an exhaustive per-message journal.
"""
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ACCOUNT='93f395f5121954671f92fffa453d6b61'
QUEUE_SHA='858e0f26ca2186c35dd97e229a0b3b155281bab97fa9bf52cc8349d00c8ae009'
CANDIDATE_SHA='0c6d47030a574f04dce5e8b46b0c010d234b3a15b4dafe60d5ba3d00fd0022e8'
SCHEMA='musitu.mcn072.cloudflare_worker_observability_routes_getonly.v1'


def digest(s):return hashlib.sha256(s.encode('utf-8')).hexdigest()
def bool_or_none(x):return x if type(x) is bool else None
def rate_or_none(x):return x if isinstance(x,(float,int)) and not isinstance(x,bool) and 0<=x<=1 else None


def settings_snapshot(obj):
    obs=obj.get('observability') if isinstance(obj,dict) else None
    obs=obs if isinstance(obs,dict) else {}
    logs=obs.get('logs')
    logs=logs if isinstance(logs,dict) else {}
    traces=obs.get('traces')
    traces=traces if isinstance(traces,dict) else {}
    tails=obj.get('tail_consumers') if isinstance(obj,dict) else None
    return {'settings_read':isinstance(obj,dict) and bool(obj),
      'logpush':bool_or_none(obj.get('logpush')) if isinstance(obj,dict) else None,
      'observability_enabled':bool_or_none(obs.get('enabled')),
      'logs_enabled':bool_or_none(logs.get('enabled')),
      'logs_invocation_enabled':bool_or_none(logs.get('invocation_logs')),
      'logs_persist':bool_or_none(logs.get('persist')),
      'logs_sampling_rate':rate_or_none(logs.get('head_sampling_rate')),
      'observability_sampling_rate':rate_or_none(obs.get('head_sampling_rate')),
      'traces_enabled':bool_or_none(traces.get('enabled')),
      'traces_persist':bool_or_none(traces.get('persist')),
      'tail_consumer_count':len(tails) if isinstance(tails,list) else None,
      'domains_enabled':None,
      'domains_all':None,
      'per_message_immutable_evidence_authenticated':False}


def inspect(getter, account_id, queue_script_digest, candidate_script_digest):
    report={'schema':SCHEMA,'method':'GET_ONLY','read_complete':False,
       'cloudflare_pg_correspondence':False,'mcn072_qualified':False,
       'commercial_ga':'NO_GO','real_fairness_windows':0,
       'scope':'SCRIPT_SETTINGS_AND_ACCOUNT_WORKER_CUSTOM_DOMAINS_NOT_PROVIDER_EVENT_HISTORY'}
    if not isinstance(account_id,str) or not re.fullmatch('[0-9a-f]{32}',account_id):return report
    if not all(isinstance(s,str) and re.fullmatch('[a-f0-9]{64}',s) for s in (queue_script_digest,candidate_script_digest)) or queue_script_digest==candidate_script_digest:return report
    prefix='/accounts/'+account_id+'/workers'
    try:
      inv=getter(prefix+'/scripts')
      items=inv.get('result') if isinstance(inv,dict) else None
      if not isinstance(items,list) or len(items)>200 or not items:return report
      names=[x.get('id') or x.get('name') for x in items if isinstance(x,dict)]
      if len(names)!=len(items) or any(not isinstance(s,str) or len(s)>250 for s in names) or len(set(names))!=len(names):return report
      selected=[]
      for candidate in (queue_script_digest,candidate_script_digest):
        matches=[x for x in names if digest(x)==candidate]
        if len(matches)!=1:return report
        selected.append(matches[0])
      for label,name in zip(('queue','candidate'),selected):
        raw=getter(prefix+'/scripts/'+urllib.parse.quote(name,safe='')+'/script-settings')
        result=raw.get('result') if isinstance(raw,dict) else None
        report[label]=settings_snapshot(result)
      domains_reply=getter(prefix+'/domains')
      domains=domains_reply.get('result') if isinstance(domains_reply,dict) else None
      if not isinstance(domains,list) or len(domains)>1000:return report
      for label,name in zip(('queue','candidate'),selected):
        matches=[d for d in domains if isinstance(d,dict) and (d.get('service')==name or d.get('script')==name)]
        report[label]['domains_all']=len(matches)
        report[label]['domains_enabled']=sum(d.get('enabled') is True for d in matches)
      report['read_complete']=all(report[label]['settings_read'] for label in ('queue','candidate'))
    except Exception:
      # Provider errors and raw responses may contain private identifiers.
      return report
    return report


def fetch_json(path,token):
    if not path.startswith('/accounts/'+ACCOUNT+'/workers') or not token:raise ValueError('route denied')
    req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,
          headers={'Authorization':'Bearer '+token,'Accept':'application/json'},method='GET')
    with urllib.request.urlopen(req,timeout=25) as response:
        data=response.read(2_000_001)
    if len(data)>2_000_000:raise ValueError('bounded response exceeded')
    obj=json.loads(data)
    if not isinstance(obj,dict) or obj.get('success') is not True:raise ValueError('provider denied')
    return obj


def main():
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not token:
      print(json.dumps({'schema':SCHEMA,'read_complete':False,'mcn072_qualified':False,'error':'CREDENTIAL_UNAVAILABLE'}));return 2
    result=inspect(lambda path:fetch_json(path,token),ACCOUNT,QUEUE_SHA,CANDIDATE_SHA)
    print(json.dumps(result,sort_keys=True,separators=(',',':')))
    return 0 if result['read_complete'] else 3

if __name__=='__main__':sys.exit(main())
