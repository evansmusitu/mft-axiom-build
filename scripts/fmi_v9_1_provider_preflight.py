#!/usr/bin/env python3
import argparse,email,hashlib,json,os,pathlib,urllib.error,urllib.parse,urllib.request

EXPECTED = {
  'edge': '32c40130b4295507d0b083796c2a8d61b3504e8d54dd4242386f4d6a8f00f5f9',
  'router': '7912930b4de20fe5b5609576acc5e85d6cc4e840f393aef31d47172a2e9783a6',
  'provider': '875c78f5f3f6c41840c14afedf10d187662a5a79de91e2835a11b1a1882478ff',
  'live_edge': '27ea84793c78f24091e0154836d6330678f3386db97b43f864f117c28ebebcd9',
  'workspace': '64accddb375d9f1c0f0d7fddd319e83a0242c9740ae1ae5bcc59185ac3ca7ec3',
  'billing': 'cd55b2b7b34bc5f73c394eddebd9edbc22690250b4ab7aff36a209064a3b9454',
  'adapter': 'c5c4d059b245565bda0aa8bf2f8b8d6282fcb580187e6ce73bb1e1e38e569ed1',
}

def sha(b): return hashlib.sha256(b).hexdigest()
def bool_true(name): return os.getenv(name,'').strip().lower() == 'true'
def present(name): return bool(os.getenv(name,'').strip())

class CF:
  def __init__(self):
    self.api=os.environ['CF_API'].rstrip('/'); self.aid=os.environ['CLOUDFLARE_ACCOUNT_ID']
    self.h={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'User-Agent':'MUSITU-FMI-V9.1-Preflight/1.0'}
  def raw(self,path):
    q=urllib.request.Request(self.api+path,headers=self.h,method='GET')
    try:
      with urllib.request.urlopen(q,timeout=45) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
  def source(self,name,allow_missing=False):
    code,h,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/content/v2')
    if code==404 and allow_missing:return None
    if code!=200: raise RuntimeError(f'cloudflare source read HTTP {code} for {name}')
    ct=h.get('content-type','')
    if 'multipart/' not in ct.lower(): return b
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+b)
    parts=[]
    for p in msg.walk():
      if p.is_multipart(): continue
      d=p.get_payload(decode=True) or b''
      if any(x in d for x in (b'export default',b'addEventListener',b'fetch(')): parts.append(d)
    if len(parts)!=1: raise RuntimeError(f'executable module ambiguity for {name}: {len(parts)}')
    return parts[0]
  def settings(self,name):
    code,h,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/settings')
    if code!=200: raise RuntimeError(f'cloudflare settings HTTP {code} for {name}')
    x=json.loads(b or b'{}'); return x.get('result') or {}
  def subdomain(self,name):
    code,h,b=self.raw(f'/accounts/{self.aid}/workers/scripts/{urllib.parse.quote(name,safe="")}/subdomain')
    if code!=200: raise RuntimeError(f'cloudflare subdomain HTTP {code} for {name}')
    return json.loads(b or b'{}').get('result') or {}

def main():
  ap=argparse.ArgumentParser(); ap.add_argument('--payload-root',default='/tmp/fmi-v9-1-runtime'); ap.add_argument('--require-ready',action='store_true'); ap.add_argument('--output',default='fmi-v9-1-provider-preflight.json'); a=ap.parse_args()
  root=pathlib.Path(a.payload_root)
  paths={'edge':root/'edge/fmi-global/worker.js','router':root/'edge/fmi-market-data/router.js','provider':root/'edge/fmi-market-data/providers/twelve-data-adapter.js'}
  local={k:sha(p.read_bytes()) for k,p in paths.items()}
  blockers=[]
  for k,v in local.items():
    if v!=EXPECTED[k]: blockers.append(f'PAYLOAD_HASH_MISMATCH:{k}')
  rights={
    'license_authorized':bool_true('TWELVE_DATA_LICENSE_AUTHORIZED'),
    'redistribution_authorized':bool_true('TWELVE_DATA_REDISTRIBUTION_AUTHORIZED'),
    'api_key_present':present('TWELVE_DATA_API_KEY'),
    'entitlement_label_present':present('TWELVE_DATA_ENTITLEMENT_LABEL'),
    'freshness_label_present':present('TWELVE_DATA_FRESHNESS_LABEL'),
    'rights_reference_present':present('TWELVE_DATA_RIGHTS_REFERENCE'),
  }
  for k,v in rights.items():
    if not v:blockers.append('RIGHTS_GATE:'+k)
  cf=CF(); edge=os.environ['FMI_EDGE']; bill=os.environ['FMI_BILLING']; adapt=os.environ['FMI_ADAPTER']
  router_name=os.environ.get('FMI_MARKET_ROUTER','mft-fmi-market-router'); provider_name=os.environ.get('FMI_TWELVE_DATA_ADAPTER','mft-fmi-twelve-data-adapter')
  live_src=cf.source(edge); bill_src=cf.source(bill); adapt_src=cf.source(adapt)
  live={'edge_sha256':sha(live_src),'billing_sha256':sha(bill_src),'adapter_sha256':sha(adapt_src)}
  if live['edge_sha256']!=EXPECTED['live_edge']: blockers.append('LIVE_EDGE_DRIFT')
  if live['billing_sha256']!=EXPECTED['billing']: blockers.append('BILLING_WORKER_DRIFT')
  if live['adapter_sha256']!=EXPECTED['adapter']: blockers.append('MODAL_ADAPTER_DRIFT')
  st=cf.settings(edge); bindings={x.get('name'):x for x in (st.get('bindings') or []) if isinstance(x,dict) and x.get('name')}
  expected_names={'FMI_DB','FMI_KERNEL','FMI_BILLING'}
  if set(bindings)!=expected_names: blockers.append('LIVE_BINDING_SET_DRIFT')
  if 'FMI_MARKET_DATA' in bindings: blockers.append('FMI_MARKET_DATA_ALREADY_BOUND')
  if bindings.get('FMI_DB',{}).get('id')!=os.environ['FMI_DB_UUID']: blockers.append('FMI_DB_BINDING_DRIFT')
  if bindings.get('FMI_KERNEL',{}).get('service')!=adapt: blockers.append('FMI_KERNEL_BINDING_DRIFT')
  if bindings.get('FMI_BILLING',{}).get('service')!=bill: blockers.append('FMI_BILLING_BINDING_DRIFT')
  collisions={}
  for name,exp in ((router_name,EXPECTED['router']),(provider_name,EXPECTED['provider'])):
    s=cf.source(name,allow_missing=True)
    if s is None: collisions[name]={'state':'ABSENT','sha256':None}
    else:
      got=sha(s); collisions[name]={'state':'EXACT_CANDIDATE' if got==exp else 'UNEXPECTED_EXISTING','sha256':got}
      if got!=exp:blockers.append('WORKER_NAME_COLLISION:'+name)
  for name,info in collisions.items():
    if info['state']=='EXACT_CANDIDATE':
      sub=cf.subdomain(name); info['public_exposure']=sub
      if sub.get('enabled') is not False or sub.get('previews_enabled') not in (False,None): blockers.append('PRIVATE_WORKER_EXPOSURE:'+name)
  state={
    'schema':'musitu.fmi.v9-1-provider-preflight.v1','mutation_performed':False,
    'candidate_hashes':local,'live_readback':live,'binding_names':sorted(bindings),
    'planned_workers':collisions,'rights_gate':rights,'secret_values_logged':False,
    'promotion_ready':len(blockers)==0,'blockers':sorted(set(blockers)),
    'authority':{'live_trading':False,'trade_execution':False,'production_model_authority':False,'numeric_finance_risk':'DETERMINISTIC_TOOL_ONLY'},
  }
  pathlib.Path(a.output).write_text(json.dumps(state,indent=2,sort_keys=True)+'\n'); print(json.dumps(state,sort_keys=True))
  if a.require_ready and blockers: raise SystemExit(3)
main()
