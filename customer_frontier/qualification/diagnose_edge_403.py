"""Read-only public HTTPS 403 characterization; no auth, cookies, bypass, or mutations."""
import hashlib,json,urllib.error,urllib.request
from pathlib import Path
HOST='axiom-customer-staging.mftintelligence.com'
PATHS=('/_health','/auth/start')
AGENTS=('AXIOM-ReadOnly-Independent-20261108',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36')
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None

def probe(path,agent,opener=None):
 if path not in PATHS or agent not in AGENTS:raise ValueError('OUT_OF_SCOPE')
 req=urllib.request.Request('https://'+HOST+path,method='GET',headers={'Accept':'application/json','User-Agent':agent})
 try:
  with (opener or urllib.request.build_opener(NoRedirect)).open(req,timeout=14) as r:
   status=r.status;headers=r.headers;raw=r.read(16001)
 except urllib.error.HTTPError as e:
  status=e.code;headers=e.headers;raw=e.read(16001)
 except (OSError,TimeoutError,ValueError):
  return {'path':path,'transport':'UNKNOWN','status':None}
 low=raw[:16000].lower()
 words=['cf-mitigated','cf_chl_','challenge-platform','attention required','error 1020',
        'cloudflare access','one-time pin','access denied','managed challenge',
        'captcha','bot management','just a moment']
 return {'path':path,'status':status,'transport':'RESPONDED',
         'server_cloudflare':str(headers.get('server','')).lower()=='cloudflare',
         'cf_mitigated':str(headers.get('cf-mitigated',''))[:32],
         'www_authenticate':bool(headers.get('www-authenticate')),
         'location_set':bool(headers.get('location')),
         'body_sha256':hashlib.sha256(raw).hexdigest(),
         'markers':[x for x in words if x.encode() in low],
         'bytes_seen':len(raw)}

def main():
 a=[probe(p,u) for p in PATHS for u in AGENTS]
 status='EDGE_403_REQUIRES_RULE_REVIEW' if any(x['status']==403 for x in a) else 'NO_EDGE_403_IN_THIS_VIEW'
 data={'kind':'AXIOM_STAGING_EDGE_403_READONLY','status':status,'requests':a,
       'signed_session_qualified':False,'customer_ownership_qualified':False,
       'oauth_production_touched':False,'cloudflare_mutations':0}
 b=(json.dumps(data,sort_keys=True,indent=2)+'\n').encode();p=Path('axiom-staging-edge403-readonly.json')
 p.write_bytes(b);Path(str(p)+'.sha256').write_text(hashlib.sha256(b).hexdigest()+'  '+str(p)+'\n')
 print('EDGE_CLASSIFICATION='+status+' REQUESTS='+str(len(a)))
 return 0
if __name__=='__main__':raise SystemExit(main())
