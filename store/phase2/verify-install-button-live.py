#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,os,re,time,urllib.error,urllib.request
from pathlib import Path

BASE='https://payments.mftintelligence.com'
APP=BASE+'/chemistry/app/'
PWA=BASE+'/chemistry/install'
ATTEMPTS=12
DELAY=1.0
UA={
 'android':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
 'ios':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
 'web':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl): return None
no=urllib.request.build_opener(NoRedirect)
yes=urllib.request.build_opener()

def request(path,platform='web',accept='text/html',follow=True):
 sep='&' if '?' in path else '?'
 url=BASE+path+sep+'musitu_install_button_probe='+str(time.time_ns())
 q=urllib.request.Request(url,headers={'User-Agent':UA[platform],'Accept':accept,'Cache-Control':'no-cache, no-store','Pragma':'no-cache'})
 try:
  with (yes if follow else no).open(q,timeout=60) as r: return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
 except urllib.error.HTTPError as e: return e.code,{k.lower():v for k,v in e.headers.items()},e.read()

def wait_html(path,platform,check):
 attempts=[]
 for n in range(1,ATTEMPTS+1):
  c,h,b=request(path,platform)
  text=b.decode('utf-8','replace')
  ok=c==200 and h.get('content-type','').lower().startswith('text/html') and check(text)
  attempts.append({'attempt':n,'status':c,'sha256':hashlib.sha256(b).hexdigest(),'ok':ok})
  if ok:return attempts
  if n<ATTEMPTS:time.sleep(DELAY)
 raise RuntimeError(f'{platform} {path} did not converge: {attempts}')

def install_ok(text,platform,action):
 if '<link rel="manifest" href="/chemistry/app/manifest.webmanifest">' not in text:return False
 if 'href="intent://app/chemistry' in text or 'href="sidestore://install?' in text or f'href="{PWA}"' in text:return False
 if 'href="/store/open"' not in text:return False
 if platform=='android':return re.search(r'data-musitu-install-target="intent://app/chemistry\?action='+re.escape(action)+r'[^\"]*package=com\.musitu\.store',text) is not None
 if platform=='ios':return 'data-musitu-install-target="sidestore://install?url=' in text
 return f'data-musitu-install-target="{PWA}"' in text

def main():
 results={}
 for action in ('install','update','repair','reinstall'):
  path='/store/install' if action=='install' else '/store/'+action
  for platform in ('android','ios','web'):
   results[f'{platform} {action}']=wait_html(path,platform,lambda t,p=platform,a=action:install_ok(t,p,a))

 for n in range(1,ATTEMPTS+1):
  c,h,b=request('/store/assets/store.js','web','application/javascript')
  text=b.decode('utf-8','replace')
  ok=(c==200 and 'beforeinstallprompt' in text and 'data-musitu-install-target' in text and '/chemistry/app/manifest.webmanifest' in text and 'window.location.assign(target)' in text and not re.search(r'\.(?:apk|ipa)(?:[\'\"?]|$)',text,re.I))
  if ok:
   results['install_controller']=[{'attempt':n,'status':c,'sha256':hashlib.sha256(b).hexdigest(),'ok':True}]
   break
  if n<ATTEMPTS:time.sleep(DELAY)
 else:raise RuntimeError('public install controller did not converge')

 c,h,b=request('/store/open','web','text/html',False)
 if c!=302 or h.get('location')!=APP or h.get('content-disposition') is not None or b:
  raise RuntimeError(f'/store/open contract drift: {(c,h.get("location"),h.get("content-disposition"),len(b))}')

 payload={'schema':'musitu.store.install_button.live.v1','gate':'MUSITU_STORE_INSTALL_BUTTON_LIVE_PASS','worker_sha256':os.environ.get('EXPECTED_INSTALL_BUTTON_WORKER_SHA'),'checks':results,'open_redirect':APP}
 out=Path(os.environ.get('NATIVE_HANDOFF_EVIDENCE','/tmp'))
 out.mkdir(parents=True,exist_ok=True)
 (out/'install-button-live.json').write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
 print(json.dumps(payload,sort_keys=True))

if __name__=='__main__':main()
