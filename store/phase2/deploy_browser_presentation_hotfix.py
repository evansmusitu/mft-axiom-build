#!/usr/bin/env python3
from __future__ import annotations
import email, email.policy, hashlib, json, os, pathlib, secrets, time, urllib.error, urllib.parse, urllib.request

API='https://api.cloudflare.com/client/v4'
AID=os.environ['ACCOUNT_ID']; ZID=os.environ['ZONE_ID']; ZONE=os.environ['ZONE_NAME']; HOST=os.environ['PAYMENTS_HOST']; ORIGIN=os.environ['PAYMENTS_ORIGIN']; WORKER=os.environ['STORE_WORKER']; ROUTE=os.environ['STORE_ROUTE']; BUCKET=os.environ['STORE_BUCKET']
BASE='https://'+HOST; BASELINE=pathlib.Path(os.environ['BASELINE_MODULE_ROOT']); CANDIDATE=pathlib.Path(os.environ['CANDIDATE_MODULE_ROOT']); EVIDENCE=pathlib.Path(os.environ.get('HOTFIX_DEPLOY_EVIDENCE','/tmp/musitu-store-browser-hotfix-evidence')); EVIDENCE.mkdir(parents=True,exist_ok=True)
SEALED_MAIN=os.environ['SEALED_MAIN']; PHASE1_HEAD=os.environ['PHASE1_HEAD']; HOTFIX_HEAD=os.environ['HOTFIX_HEAD']; HOTFIX_WORKER_SHA=os.environ['HOTFIX_WORKER_SHA']; CATALOG_SHA=os.environ['CATALOG_SHA']; CATALOG_SIG_SHA=os.environ['CATALOG_SIG_SHA']; STORE_SHA=os.environ['STORE_SHA']; STORE_BYTES=int(os.environ['STORE_BYTES'])
AUTH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-Store-Browser-Presentation-Hotfix/1.0'}
MACHINE={
'/store/catalog.json':('application/json','4fa31c5f9f84facc0d1fbf7a91a50b0adcaa5ef4c97b7d82abbe9657ea10b7f9'),
'/store/catalog.sig':('text/plain','9b854358f90368ceb5cc3baab8d99064d8ee94b79ead378a614f8cc1732b06a7'),
'/store/ios/source.json':('application/json','dd4b9c93443dc0298589502f1f1b39948f4d02ab1dcc63213d9abe44b878e706'),
'/store/web/adapter.json':('application/json','2a847ae437cbeec3de89ad74fa900d89d157f6a7949ff83b353398ab0225b378'),
'/store/android/repo/index-v1.json':('application/json','91847560d506c9d72c8ab48af918caa9ae0d5a9015a46e38926cec3b782825a4'),
'/store/apps/chemistry/sbom.json':('application/json','614cdffb9866d5786b68b2028fd3d6fb3c3ea9f8a2f97a227798567ffc5b729e'),
'/store/apps/chemistry/dependencies.json':('application/json','3d0eb0b01267d02bad9b4a0e0ad578e4262d1b9384320b66624c65043c7cfd4d'),
'/store/release/channels.json':('application/json','70adfbab308cb1b2942a426271e808ecb7c175064beb91d2cbaaaf7c4ca28ec4'),
'/store/release/rollback-control.json':('application/json','4c7b3635ede467acb6012cdf5ac334265eda81fa3d6ea9b3649ac36c5751056a'),
'/store/bootstrap/release.json':('application/json','7a4220f321e1aa03077cac9c5ed4961553c11edc68227889513dc0f03d219ec7'),
'/store/locales.json':('application/json','fcd3b25de015a402de326003d1acc9c3be63f0d1a1d33f2af15dd54055b51fee')}
NORMAL=['/store','/store/apps/chemistry','/store/install','/store/developer','/store/releases','/store/status','/store/offline','/store/healthz']
state={'initial_snapshot_verified':False,'presentation_candidate_deployed_once':False,'rollback_drill_performed':False,'rollback_drill_verified':False,'presentation_candidate_redeployed_final':False,'final_state_verified':False,'emergency_rollback_performed':False}; checks={}; snapshot_body=None; snapshot_content_type=None; initial_normal={}

def sha(b): return hashlib.sha256(b).hexdigest()
def req(url,method='GET',headers=None,body=None,timeout=120):
 q=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
 try:
  with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,dict(r.headers),r.read()
 except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def cf(path):
 code,_,raw=req(API+path,'GET',AUTH); obj=json.loads(raw or b'{}') if code==200 else {}
 if code!=200 or obj.get('success') is not True: raise RuntimeError(f'Cloudflare GET failed {path} HTTP {code}')
 return obj.get('result')
def pub(path,accept='*/*',human=False):
 sep='&' if '?' in path else '?'; headers={'Accept':accept,'User-Agent':'MUSITU-Store-Hotfix-Probe/1.0','Cache-Control':'no-cache','Pragma':'no-cache'}
 if human: headers.update({'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'})
 return req(BASE+path+sep+'musitu_hotfix_probe='+str(time.time_ns()),'GET',headers)
def verify_topology():
 zones=cf('/zones?name='+urllib.parse.quote(ZONE)+'&status=active') or []
 if len(zones)!=1 or zones[0].get('id')!=ZID or (zones[0].get('account') or {}).get('id')!=AID: raise RuntimeError('zone/account drift')
 domains=cf(f'/accounts/{AID}/workers/domains') or []; matches=[d for d in domains if isinstance(d,dict) and d.get('hostname')==HOST]
 if len(matches)!=1 or matches[0].get('service')!=ORIGIN: raise RuntimeError('custom domain drift')
 routes=cf(f'/zones/{ZID}/workers/routes') or []; exact=[r for r in routes if isinstance(r,dict) and r.get('pattern')==ROUTE]
 if len(exact)!=1 or exact[0].get('script')!=WORKER: raise RuntimeError('Store route drift')
 settings=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/settings') or {}; bindings={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
 if set(bindings)!={'STORE_RELEASES','STORE_RUNTIME_PUBLICATION_STATE'} or bindings['STORE_RELEASES'].get('bucket_name')!=BUCKET or bindings['STORE_RUNTIME_PUBLICATION_STATE'].get('text')!='production': raise RuntimeError('binding drift')
def parse_worker(ctype,body):
 raw=('Content-Type: '+ctype+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body; msg=email.message_from_bytes(raw,policy=email.policy.default); out={}
 for p in msg.iter_parts():
  name=p.get_param('name',header='content-disposition') or p.get_filename(); payload=p.get_payload(decode=True)
  if name and payload is not None: out[str(name)]=payload
 return out
def read_live_worker():
 path=f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}'; code,h,b=req(API+path,'GET',AUTH)
 if code!=200: raise RuntimeError('live worker read failed')
 c=h.get('Content-Type') or h.get('content-type') or ''
 if 'multipart/' not in c.lower(): raise RuntimeError('live worker not multipart')
 return c,b,parse_worker(c,b)
def verify_release_identity():
 for path,accept,expected in [('/store/catalog.json','application/json',CATALOG_SHA),('/store/catalog.sig','text/plain',CATALOG_SIG_SHA)]:
  code,_,b=pub(path,accept)
  if code!=200 or sha(b)!=expected: raise RuntimeError(path+' identity drift')
 code,_,apk=pub('/store/bootstrap/MUSITU_Store_1.0.2.apk','application/vnd.android.package-archive')
 if code!=200 or len(apk)!=STORE_BYTES or sha(apk)!=STORE_SHA: raise RuntimeError('Store APK identity drift')
def snapshot_and_verify_baseline():
 global snapshot_body,snapshot_content_type,initial_normal
 c,b,parts=read_live_worker(); names={'worker.mjs','render.mjs','assets.mjs','generated-data.mjs'}
 if not names.issubset(parts): raise RuntimeError('live module set drift')
 for n in names:
  if parts[n]!=(BASELINE/n).read_bytes(): raise RuntimeError('live baseline drift before hotfix: '+n)
 snapshot_body=b; snapshot_content_type=c; state['initial_snapshot_verified']=True; checks['initial_snapshot_sha256']=sha(b)
 for p in NORMAL:
  code,h,body=pub(p,'application/json' if p.endswith('healthz') else 'text/html');
  if code!=200: raise RuntimeError('normal route unavailable before hotfix: '+p)
  initial_normal[p]={'sha256':sha(body),'content_type':h.get('Content-Type') or h.get('content-type')}
def metadata(): return {'main_module':'worker.mjs','compatibility_date':'2026-09-09','bindings':[{'type':'r2_bucket','name':'STORE_RELEASES','bucket_name':BUCKET},{'type':'plain_text','name':'STORE_RUNTIME_PUBLICATION_STATE','text':'production'}]}
def multipart(root):
 boundary='----MUSITUHOTFIX'+secrets.token_hex(18); out=[]
 def add(x): out.append(x.encode() if isinstance(x,str) else x)
 add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'); add(json.dumps(metadata(),separators=(',',':'))); add('\r\n')
 for n in ('worker.mjs','render.mjs','assets.mjs','generated-data.mjs'):
  add(f'--{boundary}\r\nContent-Disposition: form-data; name="{n}"; filename="{n}"\r\nContent-Type: application/javascript+module\r\n\r\n'); add((root/n).read_bytes()); add('\r\n')
 add(f'--{boundary}--\r\n'); return boundary,b''.join(out)
def upload_candidate():
 boundary,body=multipart(CANDIDATE); h=dict(AUTH); h['Content-Type']='multipart/form-data; boundary='+boundary; code,_,raw=req(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}', 'PUT',h,body,180)
 if not 200<=code<300: raise RuntimeError('hotfix upload failed HTTP '+str(code)+' '+raw[:200].decode('utf-8','ignore'))
def restore_snapshot():
 if snapshot_body is None or snapshot_content_type is None: raise RuntimeError('snapshot unavailable')
 h=dict(AUTH); h['Content-Type']=snapshot_content_type; code,_,raw=req(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}', 'PUT',h,snapshot_body,180)
 if not 200<=code<300: raise RuntimeError('snapshot restore failed HTTP '+str(code)+' '+raw[:200].decode('utf-8','ignore'))
def verify_candidate_bytes():
 if sha((CANDIDATE/'worker.mjs').read_bytes())!=HOTFIX_WORKER_SHA: raise RuntimeError('hotfix worker hash mismatch')
 for n in ('render.mjs','assets.mjs','generated-data.mjs'):
  if (CANDIDATE/n).read_bytes()!=(BASELINE/n).read_bytes(): raise RuntimeError('unexpected non-worker delta: '+n)
def verify_baseline_restored():
 _,_,parts=read_live_worker()
 for n in ('worker.mjs','render.mjs','assets.mjs','generated-data.mjs'):
  if parts.get(n)!=(BASELINE/n).read_bytes(): raise RuntimeError('rollback module mismatch: '+n)
def verify_public_hotfix():
 verify_topology(); verify_release_identity(); observations={}
 for p,(accept,expected) in MACHINE.items():
  code,h,body=pub(p,'text/html',True); ctype=(h.get('Content-Type') or h.get('content-type') or '').lower(); text=body.decode('utf-8','replace')
  if code!=200 or not ctype.startswith('text/html') or 'Machine-readable endpoint' not in text or 'Readable browser view.' not in text or '?raw=1' not in text or text.lstrip().startswith(('{','[')): raise RuntimeError('browser presentation failed: '+p)
  code,_,raw=pub(p,accept)
  if code!=200 or sha(raw)!=expected: raise RuntimeError('machine raw compatibility failed: '+p)
  code,_,override=pub(p+'?raw=1','text/html',True)
  if code!=200 or sha(override)!=expected: raise RuntimeError('raw override failed: '+p)
  observations[p]={'raw_sha256':expected,'browser_html':True,'raw_override_identical':True}
 for p,before in initial_normal.items():
  code,h,body=pub(p,'application/json' if p.endswith('healthz') else 'text/html')
  if code!=200 or sha(body)!=before['sha256']: raise RuntimeError('normal Store response changed: '+p)
 checks['machine_endpoint_verification']=observations; checks['normal_store_responses_unchanged']=True
def write_evidence(gate,error=None):
 out={'schema':'musitu.store.phase2.browser_presentation_hotfix_deployment.v1','gate':gate,'sealed_main':SEALED_MAIN,'phase1_head':PHASE1_HEAD,'hotfix_head':HOTFIX_HEAD,'hotfix_worker_sha256':HOTFIX_WORKER_SHA,'store_version':'1.0.2','catalog_revision':3,'catalog_sha256':CATALOG_SHA,'catalog_signature_sha256':CATALOG_SIG_SHA,'store_apk_sha256':STORE_SHA,'store_apk_bytes':STORE_BYTES,'scope':'Worker presentation only; no catalog/APK/commerce/licence/security-hardening mutation','state':state,'checks':checks,'error':error}; raw=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode(); (EVIDENCE/'deployment.json').write_bytes(raw); (EVIDENCE/'deployment.sha256').write_text(sha(raw)+'  deployment.json\n'); return out
def emergency_rollback():
 if snapshot_body is None:return
 restore_snapshot(); state['emergency_rollback_performed']=True; verify_baseline_restored()
def main():
 verify_topology(); verify_release_identity(); verify_candidate_bytes(); snapshot_and_verify_baseline()
 try:
  upload_candidate(); state['presentation_candidate_deployed_once']=True; verify_public_hotfix()
  restore_snapshot(); state['rollback_drill_performed']=True; verify_baseline_restored(); state['rollback_drill_verified']=True
  upload_candidate(); state['presentation_candidate_redeployed_final']=True; verify_public_hotfix(); state['final_state_verified']=True
  print(json.dumps(write_evidence('MUSITU_STORE_BROWSER_PRESENTATION_HOTFIX_DEPLOY_AND_ROLLBACK_PASS'),sort_keys=True))
 except Exception as exc:
  original=repr(exc); rb=None
  try: emergency_rollback()
  except Exception as e: rb=repr(e)
  msg=original if rb is None else original+' | EMERGENCY_ROLLBACK_ERROR='+rb; print(json.dumps(write_evidence('MUSITU_STORE_BROWSER_PRESENTATION_HOTFIX_DEPLOY_FAIL',msg),sort_keys=True)); raise RuntimeError(msg) from exc
if __name__=='__main__': main()
