"""Fail-closed, fixed-target, zero-write Cloudflare staging host preflight.

This metadata is NEVER evidence for signed user login or production OAuth approval.
No customer/production D1 access, no mutating HTTP methods, no provider bodies logged.
"""
from __future__ import annotations
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
ZONE = 'mftintelligence.com'
STAGING_HOST = 'axiom-customer-staging.mftintelligence.com'
WORKER = 'musitu-axiom-customer-staging'
ALLOWED_HOST='api.cloudflare.com'
ZONES='/zones?name=mftintelligence.com&per_page=50&page=1'
WORKERS=f'/accounts/{ACCOUNT}/workers/scripts'
class Refuse(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k):return None

def api_get(path: str):
    """Exactly the five bounded metadata-only paths, never SQL or raw secrets."""
    allowed={ZONES,WORKERS}
    if re.fullmatch(r'/zones/[0-9a-f]{32}/dns_records\?name=axiom-customer-staging\.mftintelligence\.com&per_page=100&page=1',path):allowed.add(path)
    if re.fullmatch(r'/zones/[0-9a-f]{32}/workers/routes\?per_page=100&page=1',path):allowed.add(path)
    if path==WORKERS+'/'+WORKER+'/settings':allowed.add(path)
    if path not in allowed:raise Refuse('UNREVIEWED_PATH_DENIED')
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not token:raise Refuse('MISSING_SCOPED_TOKEN')
    url='https://'+ALLOWED_HOST+'/client/v4'+path
    req=urllib.request.Request(url,method='GET',headers={
        'Authorization':'Bearer '+token,
        'Accept':'application/json',
        'User-Agent':'AXIOM-Staging-Identity-Readonly/20261108',
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=14) as f:
            raw=f.read(300001)
            if f.status!=200 or len(raw)>300000:raise Refuse('BAD_STATUS_OR_SIZE')
    except urllib.error.HTTPError as e:
        raise Refuse('PROVIDER_REJECTED_'+str(e.code)) from None
    except (TimeoutError,ValueError,OSError,http.client.HTTPException):
        raise Refuse('PROVIDER_TRANSPORT_ERROR') from None
    try: doc=json.loads(raw)
    except (ValueError,UnicodeError):raise Refuse('INVALID_JSON') from None
    if not isinstance(doc,dict) or doc.get('success') is not True or 'result' not in doc:
        raise Refuse('INVALID_PROVIDER_ENVELOPE')
    return doc

def inspect(fetch=api_get):
    out={
        'schema':'musitu.axiom.staging_identity_route_metadata_only.v1',
        'observed_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'account_id':ACCOUNT,'host':STAGING_HOST,
        'api_methods':['GET'], 'request_paths':[],
        'd1_queries':0,'customer_data_read':False,'provider_mutations':0,
        'production_oauth_access':False,'real_signed_session_verified':False,
        'identity_live_qualified':False,'release_authorized':False,
        'status':'UNKNOWN_PROVIDER_READ',
        'zone_status':None,'dns_records_matching':None,
        'staging_worker_present':False,'exact_stage_route':False,
        'private_browser_service_binding':False,
        'errors':[],
    }
    def read(path):
        out['request_paths'].append(path)
        try:
            data=fetch(path)
            if not isinstance(data,dict) or not isinstance(data.get('result'),(list,dict)):
                raise Refuse('INVALID_PROVIDER_SHAPE')
            return data['result']
        except Refuse as e:
            out['errors'].append({'path':path,'reason':str(e)[:90]})
            return None
        except (OSError,ValueError,TypeError,http.client.HTTPException):
            out['errors'].append({'path':path,'reason':'INVALID_PROVIDER_RESULT'})
            return None
    zones=read(ZONES)
    z_id=None
    if isinstance(zones,list) and len(zones)==1:
        z=zones[0]
        if isinstance(z,dict) and z.get('name')==ZONE and re.fullmatch('[0-9a-f]{32}',z.get('id','')):
            z_id=z['id'];out['zone_status']=z.get('status') if z.get('status') in ('active','pending') else 'unknown'
    records=routes=None
    if z_id:
        records=read(f'/zones/{z_id}/dns_records?name={STAGING_HOST}&per_page=100&page=1')
        routes=read(f'/zones/{z_id}/workers/routes?per_page=100&page=1')
    workers=read(WORKERS)
    if isinstance(workers,list):
        out['staging_worker_present']=any(isinstance(w,dict) and w.get('id')==WORKER for w in workers)
    if isinstance(records,list):
        chosen=[r for r in records if isinstance(r,dict) and r.get('name')==STAGING_HOST and r.get('type') in ('A','AAAA','CNAME')]
        out['dns_records_matching']=len(chosen)
        out['dns_proxied']=bool(len(chosen)==1 and chosen[0].get('proxied') is True)
    if isinstance(routes,list):
        chosen=[r for r in routes if isinstance(r,dict) and r.get('pattern')==STAGING_HOST+'/*']
        out['exact_stage_route']=bool(len(chosen)==1 and chosen[0].get('script')==WORKER)
        out['stage_route_conflict']=len(chosen)>1 or any(r.get('script')!=WORKER for r in chosen)
    if out['exact_stage_route'] and out['staging_worker_present']:
        settings=read(WORKERS+'/'+WORKER+'/settings')
        if isinstance(settings,dict) and isinstance(settings.get('bindings'),list):
            bindings=settings['bindings']
            out['private_browser_service_binding']=any(
                isinstance(b,dict) and b.get('name')=='CUSTOMER_IDP_BROWSER' and b.get('type')=='service'
                for b in bindings)
    ok_shapes=(z_id and isinstance(records,list) and isinstance(routes,list) and isinstance(workers,list))
    if not ok_shapes or out['errors']:
        out['status']='UNKNOWN_PROVIDER_READ'
    elif not out['dns_records_matching'] and not out['exact_stage_route']:
        out['status']='NO_MATCHING_STAGE_DNS_OR_ROUTE'
    elif out['dns_records_matching'] and not out['exact_stage_route']:
        out['status']='STAGE_DNS_PRESENT_WORKER_ROUTE_MISSING'
    elif not out['dns_records_matching']:
        out['status']='STAGE_ROUTE_PRESENT_DNS_MISSING'
    elif not out['dns_proxied'] or out.get('stage_route_conflict'):
        out['status']='STAGE_HOST_CONFIGURATION_CONFLICT'
    elif not out['staging_worker_present']:
        out['status']='STAGE_ROUTE_TO_UNKNOWN_WORKER'
    elif not out['private_browser_service_binding']:
        out['status']='WORKER_BINDING_NOT_QUALIFIED'
    else:
        out['status']='METADATA_PRESENT_NOT_HTTP_OR_SESSION_QUALIFIED'
    return out

def main():
    evidence=inspect()
    out=Path('axiom-stage-route-readonly-receipt.json')
    raw=(json.dumps(evidence,sort_keys=True,indent=2)+'\n').encode()
    out.write_bytes(raw)
    (out.parent/(out.name+'.sha256')).write_text(hashlib.sha256(raw).hexdigest()+'  '+out.name+'\n')
    # Never print response payloads: only fixed classifications and bounded flags.
    print('AXIOM_STAGING_HOST_PREFLIGHT='+evidence['status'])
    print('GET_COUNT='+str(len(evidence['request_paths'])))
    print('CUSTOMER_DATA_READ=false; D1_QUERIES=0; MUTATIONS=0; RELEASE=false')
    return 0 if evidence['status']!='UNKNOWN_PROVIDER_READ' else 2

if __name__=='__main__':raise SystemExit(main())
