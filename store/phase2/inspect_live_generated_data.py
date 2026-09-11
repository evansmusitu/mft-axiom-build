#!/usr/bin/env python3
from __future__ import annotations
import difflib, email, email.policy, hashlib, json, os
from pathlib import Path
import urllib.error, urllib.parse, urllib.request

API='https://api.cloudflare.com/client/v4'
ACCOUNT_ID=os.environ['ACCOUNT_ID']; WORKER=os.environ['STORE_WORKER']; BASELINE=Path(os.environ['BASELINE_MODULE_ROOT']); OUT=Path(os.environ.get('FORENSIC_OUTPUT','/tmp/musitu-store-generated-data-forensics')); OUT.mkdir(parents=True,exist_ok=True)
AUTH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'*/*','User-Agent':'MUSITU-Store-Generated-Data-Forensics/1.0'}

def sha(b): return hashlib.sha256(b).hexdigest()
def get(url):
 r=urllib.request.Request(url,headers=AUTH,method='GET')
 try:
  with urllib.request.urlopen(r,timeout=120) as x:return x.status,dict(x.headers),x.read()
 except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def parts(ctype,body):
 raw=('Content-Type: '+ctype+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body; msg=email.message_from_bytes(raw,policy=email.policy.default); out={}
 for p in msg.iter_parts():
  name=p.get_param('name',header='content-disposition') or p.get_filename(); payload=p.get_payload(decode=True)
  if name and payload is not None: out[str(name)]=payload
 return out

def main():
 path=f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}'
 code,h,b=get(API+path)
 if code!=200: raise RuntimeError(f'GET failed HTTP {code}')
 c=h.get('Content-Type') or h.get('content-type') or ''; p=parts(c,b)
 live=p['generated-data.mjs']; base=(BASELINE/'generated-data.mjs').read_bytes()
 lt=live.decode('utf-8','strict'); bt=base.decode('utf-8','strict')
 diff=''.join(difflib.unified_diff(bt.splitlines(keepends=True),lt.splitlines(keepends=True),fromfile='reconstructed-phase1-1.0.2/generated-data.mjs',tofile='live-production/generated-data.mjs',n=4))
 (OUT/'generated-data.diff').write_text(diff)
 (OUT/'baseline-generated-data.mjs').write_bytes(base)
 (OUT/'live-generated-data.mjs').write_bytes(live)
 report={'schema':'musitu.store.phase2.generated_data_forensics.v1','result':'PASS_READ_ONLY_CAPTURE','cloudflare_method':'GET_ONLY','baseline_sha256':sha(base),'live_sha256':sha(live),'baseline_bytes':len(base),'live_bytes':len(live),'diff_lines':len(diff.splitlines()),'diff_sha256':sha(diff.encode())}
 (OUT/'forensics.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
 print(json.dumps(report,indent=2,sort_keys=True))
if __name__=='__main__': main()
