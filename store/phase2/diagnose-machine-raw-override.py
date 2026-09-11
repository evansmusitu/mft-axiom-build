#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request

BASE='https://payments.mftintelligence.com'
ENDPOINTS=[
  '/store/catalog.json',
  '/store/catalog.sig',
  '/store/ios/source.json',
  '/store/web/adapter.json',
  '/store/android/repo/index-v1.json',
  '/store/apps/chemistry/sbom.json',
  '/store/apps/chemistry/dependencies.json',
  '/store/release/channels.json',
  '/store/release/rollback-control.json',
  '/store/bootstrap/release.json',
  '/store/locales.json',
]

def sha(raw:bytes)->str:
  return hashlib.sha256(raw).hexdigest()

def get(path:str, headers:dict[str,str]):
  sep='&' if '?' in path else '?'
  url=BASE+path+sep+'musitu_diag='+str(time.time_ns())
  req=urllib.request.Request(url,headers=headers,method='GET')
  try:
    with urllib.request.urlopen(req,timeout=60) as r:
      return r.status,dict(r.headers),r.read()
  except urllib.error.HTTPError as e:
    return e.code,dict(e.headers),e.read()

def obs(path:str,mode:str,headers:dict[str,str]):
  code,h,b=get(path,headers)
  return {
    'mode':mode,
    'path':path,
    'status':code,
    'content_type':h.get('Content-Type') or h.get('content-type'),
    'cache_control':h.get('Cache-Control') or h.get('cache-control'),
    'vary':h.get('Vary') or h.get('vary'),
    'bytes':len(b),
    'sha256':sha(b),
    'prefix_utf8':b[:120].decode('utf-8','replace'),
    '_body':b,
  }

rows=[]
for path in ENDPOINTS:
  accept='text/plain' if path.endswith('.sig') else 'application/json'
  raw=obs(path,'software_raw',{'Accept':accept,'User-Agent':'MUSITU-Machine-Raw-Diagnostic/1.0','Cache-Control':'no-cache','Pragma':'no-cache'})
  browser=obs(path,'browser_navigation',{'Accept':'text/html','User-Agent':'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537.36','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','Cache-Control':'no-cache','Pragma':'no-cache'})
  override=obs(path+'?raw=1','browser_raw_override',{'Accept':'text/html','User-Agent':'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile Safari/537.36','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document','Cache-Control':'no-cache','Pragma':'no-cache'})
  row={
    'endpoint':path,
    'software_raw':{k:v for k,v in raw.items() if k!='_body'},
    'browser_navigation':{k:v for k,v in browser.items() if k!='_body'},
    'browser_raw_override':{k:v for k,v in override.items() if k!='_body'},
    'raw_override_body_equal':raw['_body']==override['_body'],
    'raw_override_sha_equal':raw['sha256']==override['sha256'],
  }
  rows.append(row)

report={
  'schema':'musitu.store.machine_raw_override_diagnostic.v1',
  'method':'GET_ONLY',
  'production_mutation':False,
  'endpoint_count':len(rows),
  'all_raw_overrides_equal':all(r['raw_override_body_equal'] for r in rows),
  'mismatches':[r['endpoint'] for r in rows if not r['raw_override_body_equal']],
  'endpoints':rows,
}
print(json.dumps(report,indent=2,sort_keys=True))
