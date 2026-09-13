#!/usr/bin/env python3
import argparse,email,hashlib,json,os,pathlib,secrets,sys,time,urllib.error,urllib.parse,urllib.request

EXPECTED={
 'live_edge':'27ea84793c78f24091e0154836d6330678f3386db97b43f864f117c28ebebcd9',
 'candidate_edge':'32c40130b4295507d0b083796c2a8d61b3504e8d54dd4242386f4d6a8f00f5f9',
 'router':'7912930b4de20fe5b5609576acc5e85d6cc4e840f393aef31d47172a2e9783a6',
 'provider':'875c78f5f3f6c41840c14afedf10d187662a5a79de91e2835a11b1a1882478ff',
 'workspace':'64accddb375d9f1c0f0d7fddd319e83a0242c9740ae1ae5bcc59185ac3ca7ec3',
 'billing':'cd55b2b7b34bc5f73c394eddebd9edbc22690250b4ab7aff36a209064a3b9454',
 'adapter':'c5c4d059b245565bda0aa8bf2f8b8d6282fcb580187e6ce73bb1e1e38e569ed1',
}

def sha(b):return hashlib.sha256(b).hexdigest()
def btrue(name):return os.getenv(name,'').strip().lower()=='true'
def need(name):
 v=os.getenv(name,'').strip()
 if not v:raise RuntimeError('required secret/config missing: '+name)
 return v

def safe_binding(v):
 z={'name':v.get('name'),'type':v.get('type')}
 if v.get('type')=='d1':z['id']=v.get('id')
 if v.get('type')=='service':z['service']=v.get('service')
 if v.get('type')=='plain_text':z['text']=v.get('text')
 return z

class CF:
 def __init__(self):
  self.api=os.environ['CF_API'].rstrip('/');self.aid=os.environ['CLOUDFLARE_ACCOUNT_ID']
  self.h={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-V9.3-Promotion/1.0'}
 def raw(self,path,method='GET',headers=None,body=None,timeout=90):
  h=dict(self.h);h.update(headers or {})
  q=urllib.request.Request(self.api+path,headers=h,method=method,data=body)
  try:
   with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
  except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
 def source(self,name,allow_missing=False):
  c,h,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/content/v2')
  if c==404 and allow_missing:return None
  if c!=200:raise RuntimeError(f'source read HTTP {c}: {name}')
  ct=h.get('content-type','')
  if 'multipart/' not in ct.lower():return b
  msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+b);parts=[]
  for p in msg.walk():
   if p.is_multipart():continue
   d=p.get_payload(decode=True) or b''
   if any(x in d for x in (b'export default',b'addEventListener',b'fetch(')):parts.append(d)
  if len(parts)!=1:raise RuntimeError(f'executable module ambiguity: {name}:{len(parts)}')
  return parts[0]
 def settings(self,name):
  c,_,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/settings')
  if c!=200:raise RuntimeError(f'settings HTTP {c}: {name}')
  return json.loads(b or b'{}').get('result') or {}
 def patch_settings(self,name,bindings):
  body=json.dumps({'bindings':bindings},separators=(',',':')).encode()
  c,_,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/settings','PATCH',{'Content-Type':'application/json'},body)
  if not 200<=c<300:raise RuntimeError(f'patch settings HTTP {c}: {name}: '+b[:200].decode('utf-8','ignore'))
 def subdomain(self,name):
  c,_,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/subdomain')
  if c!=200:raise RuntimeError(f'subdomain HTTP {c}: {name}')
  return json.loads(b or b'{}').get('result') or {}
 def set_private(self,name):
  body=b'{"enabled":false,"previews_enabled":false}'
  c,_,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/subdomain','POST',{'Content-Type':'application/json'},body)
  if not 200<=c<300:raise RuntimeError(f'private exposure HTTP {c}: {name}: '+b[:200].decode('utf-8','ignore'))
 def upload(self,name,src):
  bd='----MUSITUFMI'+secrets.token_hex(16);p=[]
  def add(x):p.append(x.encode() if isinstance(x,str) else x)
  add(f'--{bd}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{{"main_module":"index.mjs"}}\r\n')
  add(f'--{bd}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n');add(src);add('\r\n');add(f'--{bd}--\r\n')
  c,_,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/content','PUT',{'Content-Type':'multipart/form-data; boundary='+bd},b''.join(p))
  if not 200<=c<300:raise RuntimeError(f'content PUT HTTP {c}: {name}: '+b[:200].decode('utf-8','ignore'))
 def secret(self,name,key,value):
  body=json.dumps({'name':key,'text':value,'type':'secret_text'},separators=(',',':')).encode()
  c,_,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/secrets','PUT',{'Content-Type':'application/json'},body)
  if not 200<=c<300:raise RuntimeError(f'secret PUT HTTP {c}: {name}:{key}: '+b[:200].decode('utf-8','ignore'))
 def delete(self,name):
  c,_,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}','DELETE')
  if c not in (200,204,404):raise RuntimeError(f'delete HTTP {c}: {name}')

class Promotion:
 def __init__(self,cf,root,output='fmi-v9-3-provider-promotion-evidence.json'):
  self.cf=cf;self.root=pathlib.Path(root);self.output=pathlib.Path(output);self.snap={};self.ops=[]
  self.edge=os.environ['FMI_EDGE'];self.billing=os.environ['FMI_BILLING'];self.adapter=os.environ['FMI_ADAPTER']
  self.router=os.environ.get('FMI_MARKET_ROUTER','mft-fmi-market-router');self.provider=os.environ.get('FMI_TWELVE_DATA_ADAPTER','mft-fmi-twelve-data-adapter')
  self.dbid=os.environ['FMI_DB_UUID']
  self.paths={'edge':self.root/'edge/fmi-global/worker.js','router':self.root/'edge/fmi-market-data/router.js','provider':self.root/'edge/fmi-market-data/providers/twelve-data-adapter.js'}
 def op(self,name):self.ops.append(name)
 def rights_guard(self):
  if not btrue('TWELVE_DATA_LICENSE_AUTHORIZED'):raise RuntimeError('rights gate: license_authorized')
  if not btrue('TWELVE_DATA_REDISTRIBUTION_AUTHORIZED'):raise RuntimeError('rights gate: redistribution_authorized')
  for n in ('TWELVE_DATA_API_KEY','TWELVE_DATA_ENTITLEMENT_LABEL','TWELVE_DATA_FRESHNESS_LABEL','TWELVE_DATA_RIGHTS_REFERENCE'):need(n)
 def local_guard(self):
  for k,p in self.paths.items():
   got=sha(p.read_bytes());exp=EXPECTED['candidate_edge' if k=='edge' else k]
   if got!=exp:raise RuntimeError(f'candidate hash mismatch:{k}:{got}')
 def snapshot_guard(self):
  edge=self.cf.source(self.edge);bill=self.cf.source(self.billing);adapt=self.cf.source(self.adapter)
  if sha(edge)!=EXPECTED['live_edge']:raise RuntimeError('live edge drift')
  if sha(bill)!=EXPECTED['billing']:raise RuntimeError('billing drift')
  if sha(adapt)!=EXPECTED['adapter']:raise RuntimeError('adapter drift')
  settings=self.cf.settings(self.edge);bindings=[safe_binding(x) for x in settings.get('bindings') or []]
  by={x.get('name'):x for x in bindings}
  if set(by)!={'FMI_DB','FMI_KERNEL','FMI_BILLING'}:raise RuntimeError('live binding set drift')
  if by['FMI_DB'].get('id')!=self.dbid:raise RuntimeError('D1 drift')
  if by['FMI_KERNEL'].get('service')!=self.adapter or by['FMI_BILLING'].get('service')!=self.billing:raise RuntimeError('service binding drift')
  private={}
  for n,exp in ((self.router,EXPECTED['router']),(self.provider,EXPECTED['provider'])):
   s=self.cf.source(n,allow_missing=True)
   if s is None:private[n]={'state':'ABSENT'}
   else:
    if sha(s)!=exp:raise RuntimeError('worker name collision:'+n)
    raise RuntimeError('promotion requires planned private worker name to be absent:'+n)
  self.snap={'edge_source':edge,'edge_settings':settings,'edge_bindings':bindings,'private':private}
 def verify_private(self,name,expected_sha):
  if sha(self.cf.source(name))!=expected_sha:raise RuntimeError('private source mismatch:'+name)
  sub=self.cf.subdomain(name)
  if sub.get('enabled') is not False or sub.get('previews_enabled') not in (False,None):raise RuntimeError('private exposure mismatch:'+name)
 def promote(self):
  self.rights_guard();self.local_guard();self.snapshot_guard()
  try:
   psrc=self.paths['provider'].read_bytes();self.cf.upload(self.provider,psrc);self.op('deploy_provider_private')
   self.cf.secret(self.provider,'TWELVE_DATA_API_KEY',need('TWELVE_DATA_API_KEY'));self.op('write_provider_secret')
   self.cf.secret(self.provider,'TWELVE_DATA_LICENSE_AUTHORIZED','true')
   self.cf.secret(self.provider,'TWELVE_DATA_ENTITLEMENT_LABEL',need('TWELVE_DATA_ENTITLEMENT_LABEL'))
   self.cf.secret(self.provider,TWELVE_DATA_FRESHNESS_LABEL',need('TWELVE_DATA_FRESHNESS_LABEL'))
   self.cf.set_private(self.provider);self.op('disable_provider_workers_dev_and_previews');self.verify_private(self.provider,EXPECTED['provider']);self.op('verify_provider_source_settings_privacy')
   rsrc=self.paths['router'].read_bytes();self.cf.upload(self.router,rsrc);self.op('deploy_router_private')
   self.cf.patch_settings(self.router,[{'type':'service','name':'FMI_MARKET_PRIMARY','service':self.provider}]);self.op('bind_router_primary_to_provider')
   self.cf.set_private(self.router);self.op('disable_router_workers_dev_and_previews');self.verify_private(self.router,EXPECTED['router']);self.op('verify_router_source_settings_privacy')
   new_bindings=list(self.snap['edge_bindings'])+[{'type':'service','name':'FMI_MARKET_DATA','service':self.router}]
   self.cf.patch_settings(self.edge,new_bindings);self.op('patch_public_edge_add_FMI_MARKET_DATA')
   got={x.get('name'):safe_binding(x) for x in (self.cf.settings(self.edge).get('bindings') or [])}
   if got.get('FMI_MARKET_DATA',{}).get('service')!=self.router:raise RuntimeError('public market binding verification failed')
   self.op('verify_public_edge_binding')
   self.cf.upload(self.edge,self.paths['edge'].read_bytes());self.op('content_put_v9_edge')
   if sha(self.cf.source(self.edge))!=EXPECTED['candidate_edge']:raise RuntimeError('candidate edge readback mismatch')
   if sha(self.cf.source(self.billing))!=EXPECTED['billing'] or sha(self.cf.source(self.adapter))!=EXPECTED['adapter']:raise RuntimeError('protected worker drift')
   self.op('verify_edge_source_workspace_billing_adapter')
   ev={'schema':'musitu.fmi.v9-3-provider-promotion.v1','status':'PROMOTED_SOURCE_AND_BINDINGS_VERIFIED','mutation_performed':True,'operations':self.ops,'edge_sha256':EXPECTED['candidate_edge'],'router_sha256':EXPECTED['router'],'provider_sha256':EXPECTED['provider'],'billing_sha256':EXPECTED['billing'],'adapter_sha256':EXPECTED['adapter'],"provider_rights_reference_present':True,'secret_values_logged':False,'live_trading':False,'trade_execution':False,'functional_market_context_probe':'SEPARATE_REQUIRED'}
   self.output.write_text(json.dumps(ev,indent=2,sort_keys=True)+'\n');return ev
  except Exception:
   self.rollback();raise
 def restore_worker(self,name,info):
  if info['state']=='ABSENT':self.cf.delete(name);return
  self.cf.upload(name,info['source']);bindings=[safe_binding(x) for x in (info['settings'].get('bindings') or [])];self.cf.patch_settings(name,bindings)
  sub=info.get('subdomain') or {}
  body=json.dumps(z'enabled':bool(sub.get('enabled')),'previews_enabled':bool(sub.get('previews_enabled'))},separators=(',',':')).encode()
  c,_,b=self.cf.raw(f'/accounts/{self.cf.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/subdomain','POST',{'Content-Type':'application/json'},body)
  if not 200<=c<300:raise RuntimeError('restore exposure failed:'+name)
 def rollback(self):
  if not self.snap:return
  errs=[]
  try:self.cf.upload(self.edge,self.snap['edge_source'])
  except Exception as e:errs.append('edge_source:'+str(e))
  try:self.cf.patch_settings(self.edge,self.snap['edge_bindings'])
  except Exception as e:errs.append('edge_settings:'+str(e))
  for n in (self.router,self.provider):
   try:self.restore_worker(n,self.snap['private'][n])
   except Exception as e:errs.append(n+':'+str(e))
  try:
   if sha(self.cf.source(self.edge))!=EXPECTED['live_edge']:errs.append('edge_verify')
   if sha(self.cf.source(self.billing))!=EXPECTED['billing']:errs.append('billing_verify')
   if sha(self.cf.source(self.adapter))!=EXPECTED['adapter']:errs.append('adapter_verify')
  except Exception as e:errs.append('verify:'+str(e))
  pathlib.Path('fmi-v9-3-provider-rollback-evidence.json').write_text(json.dumps({'schema':'musitu.fmi.v9-3-provider-rollback.v1','rollback_verified':not errs,'errors':errs,'secret_values_logged':False},indent=2,sort_keys=True)+'\n')
  if errs:raise RuntimeError('rollback verification failed:'+repr(errs))

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--payload-root',required=True);ap.add_argument('--output',default='fmi-v9-3-provider-promotion-evidence.json');a=ap.parse_args()
 try:
  ev=Promotion(CF(),a.payload_root,a.output).promote();print(json.dumps(ev,sort_keys=True))
 except Exception as e:
  print('FAIL '+type(e).__name__+' '+str(e),file=sys.stderr);raise
if __name__=='__main__':main()
