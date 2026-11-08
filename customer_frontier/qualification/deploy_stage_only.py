"""One-use, exact-host staging gate. Does not provide authenticated AXIOM service.

All Cloudflare auth stays in GitHub Actions secrets; no account keys emitted.
No customer/OAuth D1, no production Worker edits, no existing DNS overwrites.
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT='93f395f5121954671f92fffa453d6b61'
ZONE='5b56528f03948ff5917a5e0cd9f7109e'
ZONE_NAME='mftintelligence.com'
HOST='axiom-customer-staging.mftintelligence.com'
WORKER='musitu-axiom-customer-staging'
API='https://api.cloudflare.com/client/v4'
SCRIPT_SHA='3d1b3cdb1f740b970ef736067371548d1e79584196c9c977421a0ac1cf34e451'
ALLOWED={
    '/zones?name='+ZONE_NAME+'&per_page=50&page=1',
    '/zones/'+ZONE+'/dns_records?name='+HOST+'&per_page=100&page=1',
    '/zones/'+ZONE+'/workers/routes?per_page=100&page=1',
    '/accounts/'+ACCOUNT+'/workers/scripts',
    '/accounts/'+ACCOUNT+'/workers/domains',
    '/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER+'/settings',
}
class Stop(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None

def document(body):
    if not isinstance(body,dict) or body.get('success') is not True or 'result' not in body:
        raise Stop('PROVIDER_ENVELOPE_UNQUALIFIED')
    return body

class APIClient:
    def __init__(self,token):
        if not token or '\n' in token or '\r' in token:raise Stop('SCOPED_GITHUB_SECRET_MISSING')
        self.token=token
        self.write_paths=[]
    def request(self,method,path,body=None,content_type=None):
        if method=='GET' and path not in ALLOWED:raise Stop('UNREVIEWED_READ_PATH')
        if method=='PUT' and path not in ('/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER, '/accounts/'+ACCOUNT+'/workers/domains'):
            raise Stop('UNREVIEWED_WRITE_PATH')
        if method not in ('GET','PUT'):raise Stop('UNREVIEWED_METHOD')
        if method=='PUT':self.write_paths.append(path)
        headers={'authorization':'Bearer '+self.token,'accept':'application/json',
                 'user-agent':'MUSITU-AXIOM-STAGING-ONE-SHOT/20261108'}
        if body is not None:headers['content-type']=content_type
        req=urllib.request.Request(API+path,data=body,headers=headers,method=method)
        try:
            with urllib.request.build_opener(NoRedirect).open(req,timeout=18) as resp:
                raw=resp.read(250001)
                if len(raw)>250000 or resp.status!=200:raise Stop('PROVIDER_UNEXPECTED_SUCCESS_STATUS')
        except urllib.error.HTTPError as e:
            raise Stop('PROVIDER_HTTP_'+str(e.code)) from None
        except (OSError,ValueError):raise Stop('PROVIDER_CONNECTION_UNKNOWN') from None
        try:data=json.loads(raw)
        except (ValueError,UnicodeError):raise Stop('PROVIDER_RESPONSE_INVALID') from None
        return document(data)
    def get(self,path):return self.request('GET',path)
    def put(self,path,payload,typ):return self.request('PUT',path,payload,typ)

def list_result(doc):
    # Incomplete pagination is not authoritative absence.
    ri=doc.get('result_info')
    if isinstance(ri,dict) and (ri.get('total_pages',1)!=1 or ri.get('page',1)!=1):raise Stop('PROVIDER_LIST_INCOMPLETE')
    r=doc.get('result')
    if not isinstance(r,list):raise Stop('PROVIDER_LIST_INVALID')
    return r

def preflight(api):
    zones=list_result(api.get('/zones?name='+ZONE_NAME+'&per_page=50&page=1'))
    if len(zones)!=1 or zones[0].get('id')!=ZONE or zones[0].get('name')!=ZONE_NAME or zones[0].get('status')!='active':raise Stop('ZONE_MISMATCH')
    records=list_result(api.get('/zones/'+ZONE+'/dns_records?name='+HOST+'&per_page=100&page=1'))
    if any(isinstance(r,dict) and r.get('name')==HOST for r in records):raise Stop('EXISTING_DNS_OCCUPIED')
    routes=list_result(api.get('/zones/'+ZONE+'/workers/routes?per_page=100&page=1'))
    if any(isinstance(r,dict) and (r.get('pattern') in (HOST,HOST+'/*') or str(r.get('pattern','')).startswith(HOST+'/')) for r in routes):
        raise Stop('EXISTING_ROUTE_OCCUPIED')
    scripts=list_result(api.get('/accounts/'+ACCOUNT+'/workers/scripts'))
    if len(scripts)>=100:raise Stop('ACCOUNT_WORKER_CAPACITY_UNQUALIFIED')
    if any(isinstance(r,dict) and r.get('id')==WORKER for r in scripts):raise Stop('EXISTING_SCRIPT_OCCUPIED')
    domains=list_result(api.get('/accounts/'+ACCOUNT+'/workers/domains'))
    if any(isinstance(r,dict) and r.get('hostname')==HOST for r in domains):raise Stop('EXISTING_CUSTOM_DOMAIN_OCCUPIED')
    return True

def multipart(source):
    boundary='axiom-fixed-staging-20261108-0470cf99'
    metadata=json.dumps({'main_module':'index.mjs','compatibility_date':'2026-11-08','bindings':[]},separators=(',',':'))
    chunks=[
      '--'+boundary+'\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'+metadata+'\r\n',
      '--'+boundary+'\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n'+source+'\r\n',
      '--'+boundary+'--\r\n'
    ]
    return ''.join(chunks).encode('utf-8'),'multipart/form-data; boundary='+boundary

def host_readback():
    req=urllib.request.Request('https://'+HOST+'/_health',headers={'accept':'application/json'},method='GET')
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=12) as resp:
            if resp.status!=200 or resp.headers.get('set-cookie'):raise Stop('HOST_HTTP_NOT_QUALIFIED')
            data=json.loads(resp.read(6000))
    except (OSError,ValueError,urllib.error.HTTPError):return False
    return data=={
        'ok':True,'service':WORKER,'stage':'host_route_only','identity_live_qualified':False,
        'customer_ownership_qualified':False,'oauth_upgrade_qualified':False,'release_qualified':False,
    }

def deploy(api,source,readback=host_readback):
    receipt={'kind':'MUSITU_AXIOM_FAIL_CLOSED_STAGE_ROUTE','host':HOST,'account':ACCOUNT,'zone':ZONE,
             'service':WORKER,'script_sha256':SCRIPT_SHA,'preflight':'NOT_RUN',
             'script_uploaded':False,'custom_domain_attached':False,'https_health_pass':False,
             'customer_identity_qualified':False,'production_oauth_touched':False,
             'd1_queries':0,'paid_services_enabled':False,'real_login_enabled':False,
             'no_release':True,'status':'NO_GO'}
    if hashlib.sha256(source.encode()).hexdigest()!=SCRIPT_SHA:
        raise Stop('SCRIPT_CONTENT_PIN_MISMATCH')
    preflight(api);receipt['preflight']='PASS'
    body,typ=multipart(source)
    result=api.put('/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER,body,typ)
    if not isinstance(result.get('result'),dict) or result['result'].get('id')!=WORKER:
        raise Stop('SCRIPT_PROVIDER_RESULT_UNKNOWN_NO_RETRY')
    receipt['script_uploaded']=True
    settings=api.get('/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER+'/settings')['result']
    if not isinstance(settings,dict) or settings.get('bindings')!=[]:
        raise Stop('SCRIPT_BINDINGS_NOT_EMPTY_STOP')
    payload=json.dumps({'hostname':HOST,'service':WORKER,'enabled':True,
                        'previews_enabled':False,'zone_id':ZONE,'zone_name':ZONE_NAME},separators=(',',':')).encode()
    result=api.put('/accounts/'+ACCOUNT+'/workers/domains',payload,'application/json')
    d=result.get('result')
    if not isinstance(d,dict) or d.get('hostname')!=HOST or d.get('service')!=WORKER or d.get('enabled') is not True or d.get('zone_id')!=ZONE:
        raise Stop('DOMAIN_PROVIDER_RESULT_UNKNOWN_NO_RETRY')
    receipt['custom_domain_attached']=True
    # ONE immediate GET only; certificate propagation may require later read-only acceptance.
    receipt['https_health_pass']=bool(readback())
    receipt['status']='STAGING_ROUTE_READY_LOGIN_DISABLED' if receipt['https_health_pass'] else 'DOMAIN_ATTACHED_HTTPS_NOT_YET_QUALIFIED'
    return receipt

def main():
    receipt={'status':'NO_GO','reason':'NOT_EXECUTED','customer_identity_qualified':False,
             'production_oauth_touched':False,'paid_services_enabled':False}
    try:
        source=Path('customer_frontier/qualification/route_worker.mjs').read_text()
        client=APIClient(os.environ.get('CLOUDFLARE_API_TOKEN',''))
        receipt=deploy(client,source)
    except Stop as e:
        receipt['reason']=str(e)
        if 'client' in locals():receipt['attempted_write_paths']=client.write_paths
        receipt['mutation_outcome_ambiguous']=bool(receipt.get('attempted_write_paths'))
        print('STAGING_GATE_STOP='+str(e))
    raw=(json.dumps(receipt,sort_keys=True,indent=2)+'\n').encode()
    Path('axiom-staging-route-one-shot.json').write_bytes(raw)
    Path('axiom-staging-route-one-shot.json.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  axiom-staging-route-one-shot.json\n')
    print('STAGING_STATUS='+receipt['status'])
    print('NO_CUSTOMER_IDENTITY_OR_PRODUCTION_OAUTH_ACCESS')
    return 0 if receipt.get('status') in ('STAGING_ROUTE_READY_LOGIN_DISABLED','DOMAIN_ATTACHED_HTTPS_NOT_YET_QUALIFIED') else 2

if __name__=='__main__':sys.exit(main())
