#!/usr/bin/env python3
"""MCN-072 Worker/Queue binding inventory. GET ONLY; NOT a fairness qualification.

Pin account and paths. Never log Worker names, Queue names, binding content,
raw API JSON, authorization headers or any secret-derived material.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ACCOUNT='93f395f5121954671f92fffa453d6b61'
BASE='https://api.cloudflare.com'
PREFIX=f'/client/v4/accounts/{ACCOUNT}'
QUEUE_PATH=PREFIX+'/queues?page=1&per_page=100'
WORKERS_PATH=PREFIX+'/workers/scripts'
MAX_BODY=196608
MAX_WORKERS=100
MAX_BINDINGS=128
ID=re.compile(r'[0-9a-f]{32}\Z')
SCRIPT=re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
OUT=Path('mcn072-worker-queue-bindings-readonly.json')

class GateError(Exception): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

def digest(value):
    if not isinstance(value,str):raise GateError('IDENTIFIER_INVALID')
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def get(path,token,opener):
    if path not in (QUEUE_PATH,WORKERS_PATH):
        if not re.fullmatch(re.escape(PREFIX)+r'/queues/[0-9a-f]{32}',path):
            if not re.fullmatch(re.escape(WORKERS_PATH)+r'/[A-Za-z0-9_.-]{1,128}/settings',path):
                raise GateError('URL_NOT_ALLOWED')
    if not isinstance(token,str) or not 12<=len(token)<=4096 or any(x.isspace() for x in token):
        raise GateError('TOKEN_UNAVAILABLE')
    req=urllib.request.Request(BASE+path,method='GET',headers={
        'Authorization':'Bearer '+token,'Accept':'application/json',
        'User-Agent':'MUSITU-MCN072-WorkerBinding-Audit/1.0'})
    try:
        with opener.open(req,timeout=12) as resp:
            if resp.status!=200 or 'application/json' not in resp.headers.get('Content-Type','').lower():
                raise GateError('API_RESPONSE_UNEXPECTED')
            raw=resp.read(MAX_BODY+1)
    except urllib.error.HTTPError as exc:
        raise GateError('API_HTTP_'+str(exc.code)) from None
    except (urllib.error.URLError,OSError,TimeoutError):
        raise GateError('API_TRANSPORT_UNAVAILABLE') from None
    if len(raw)>MAX_BODY:raise GateError('API_RESPONSE_TOO_LARGE')
    try: data=json.loads(raw)
    except (ValueError,UnicodeError):raise GateError('API_JSON_INVALID') from None
    if type(data) is not dict or data.get('success') is not True:
        raise GateError('API_ENVELOPE_INVALID')
    return data,hashlib.sha256(raw).hexdigest()

def scan(token,opener):
    if not isinstance(token,str) or not 12<=len(token)<=4096 or any(x.isspace() for x in token):
        raise GateError('TOKEN_UNAVAILABLE')
    listing,list_hash=get(QUEUE_PATH,token,opener)
    queues=listing.get('result')
    if not isinstance(queues,list) or len(queues)!=1 or type(listing.get('result_info')) is not dict:
        raise GateError('QUEUE_INVENTORY_NOT_ONE_COMPLETE')
    info=listing['result_info']
    if info.get('page')!=1 or info.get('total_pages')!=1 or info.get('total_count')!=1:
        raise GateError('QUEUE_INVENTORY_NOT_ONE_COMPLETE')
    qid=queues[0].get('queue_id') if type(queues[0]) is dict else None
    if not isinstance(qid,str) or not ID.fullmatch(qid):
        raise GateError('QUEUE_IDENTIFIER_INVALID')
    detail,detail_hash=get(f'{PREFIX}/queues/{qid}',token,opener)
    obj=detail.get('result')
    if type(obj) is not dict or obj.get('queue_id')!=qid:
        raise GateError('QUEUE_IDENTITY_CONFLICT')
    queue_name=obj.get('queue_name')
    if not isinstance(queue_name,str) or not 1<=len(queue_name)<=128:
        raise GateError('QUEUE_NAME_NOT_VERIFIABLE')
    workers,workers_hash=get(WORKERS_PATH,token,opener)
    records=workers.get('result')
    if not isinstance(records,list) or len(records)>MAX_WORKERS:
        raise GateError('WORKER_LIST_EXCEEDS_BOUND')
    inf=workers.get('result_info')
    count_verified=(type(inf) is dict and inf.get('total_count')==len(records) and
                    inf.get('total_pages')==1 and inf.get('page')==1)
    seen=set()
    queue_matches=[]
    hyperdrive_candidates=[]
    hashes=[]
    for entry in records:
        worker=entry.get('id') if type(entry) is dict else None
        if not isinstance(worker,str) or not SCRIPT.fullmatch(worker) or worker in seen:
            raise GateError('WORKER_ID_INVALID_OR_DUPLICATED')
        seen.add(worker)
        settings,setting_hash=get(f'{WORKERS_PATH}/{worker}/settings',token,opener)
        shape=settings.get('result')
        bindings=shape.get('bindings') if type(shape) is dict else None
        if not isinstance(bindings,list) or len(bindings)>MAX_BINDINGS:
            raise GateError('WORKER_SETTINGS_BINDINGS_UNKNOWN')
        hashes.append(setting_hash)
        target_queue_bindings=0
        hyperdrive_bindings=0
        for b in bindings:
            if type(b) is not dict:raise GateError('WORKER_BINDING_INVALID')
            if b.get('type')=='queue':
                qn=b.get('queue_name')
                if not isinstance(qn,str):raise GateError('QUEUE_BINDING_NAME_INVALID')
                if qn==queue_name: target_queue_bindings+=1
            elif b.get('type')=='hyperdrive':
                if not isinstance(b.get('id'),str) or not ID.fullmatch(b['id']):
                    raise GateError('HYPERDRIVE_BINDING_ID_INVALID')
                hyperdrive_bindings+=1
        if target_queue_bindings:
            queue_matches.append({'worker_sha256':digest(worker),'queue_binding_count':target_queue_bindings,
                                  'settings_sha256':setting_hash})
        if hyperdrive_bindings:
            hyperdrive_candidates.append({'worker_sha256':digest(worker),'hyperdrive_binding_count':hyperdrive_bindings})
    return {'queue_id_sha256':digest(qid),'queue_name_sha256':digest(queue_name),
            'queues_inventory_sha256':list_hash,'queue_detail_sha256':detail_hash,
            'worker_inventory_sha256':workers_hash,'worker_settings_sha256':hashes,
            'worker_count_scanned':len(records),'worker_inventory_complete':count_verified,
            'queue_producer_binding_candidates':queue_matches,
            'hyperdrive_binding_candidates':hyperdrive_candidates,
            'consumer_worker_identified':False,'postgres_scheduler_correlated':False,
            'tenant_mapping_verified':False,'independent_witness_verified':False,
            'mcn072_qualified':False}

def main():
    obj={'schema':'musitu.mcn072.worker_queue_binding_observation.v1',
         'account_id':ACCOUNT,'observed_utc':datetime.now(timezone.utc).isoformat(),
         'github_run_id':os.environ.get('GITHUB_RUN_ID',''),
         'github_sha':os.environ.get('GITHUB_SHA',''),
         'method':'GET','cloudflare_mutations':0,'mcn072_qualified':False,
         'tenant_mapping_verified':False,'postgres_scheduler_correlated':False,
         'independent_witness_verified':False,'commercial_ga':'NO_GO'}
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        obj.update(scan(os.environ.get('CLOUDFLARE_API_TOKEN',''),opener))
        obj['status']='WORKER_METADATA_OBSERVED_NOT_FAIRNESS';code=0
    except GateError as e:
        obj['status']='BLOCKED';obj['reason_code']=str(e);code=2
    except Exception:
        obj['status']='BLOCKED';obj['reason_code']='UNEXPECTED_FAIL_CLOSED';code=2
    raw=(json.dumps(obj,sort_keys=True,indent=2)+'\n').encode()
    OUT.write_bytes(raw)
    OUT.with_name(OUT.name+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+OUT.name+'\n')
    print(json.dumps({'status':obj['status'],'worker_count_scanned':obj.get('worker_count_scanned'),
       'queue_candidate_count':len(obj.get('queue_producer_binding_candidates',[])),
       'reason_code':obj.get('reason_code'),'mcn072_qualified':False},sort_keys=True))
    return code
if __name__=='__main__':sys.exit(main())
