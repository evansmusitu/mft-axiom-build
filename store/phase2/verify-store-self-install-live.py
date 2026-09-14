#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
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

NO=urllib.request.build_opener(NoRedirect)
YES=urllib.request.build_opener()


def request(path:str,platform='web',accept='text/html',follow=True):
    sep='&' if '?' in path else '?'
    url=BASE+path+sep+'musitu_store_self_install_probe='+str(time.time_ns())
    req=urllib.request.Request(url,headers={
        'User-Agent':UA[platform],
        'Accept':accept,
        'Cache-Control':'no-cache, no-store',
        'Pragma':'no-cache',
    })
    try:
        with (YES if follow else NO).open(req,timeout=60) as response:
            return response.status,{k.lower():v for k,v in response.headers.items()},response.read()
    except urllib.error.HTTPError as exc:
        return exc.code,{k.lower():v for k,v in exc.headers.items()},exc.read()


def wait_html(path:str,platform:str,check):
    attempts=[]
    for attempt in range(1,ATTEMPTS+1):
        code,headers,body=request(path,platform)
        text=body.decode('utf-8','replace')
        ok=code==200 and headers.get('content-type','').lower().startswith('text/html') and check(text)
        attempts.append({'attempt':attempt,'status':code,'sha256':hashlib.sha256(body).hexdigest(),'ok':ok})
        if ok: return attempts
        if attempt<ATTEMPTS: time.sleep(DELAY)
    raise RuntimeError(f'{platform} {path} did not converge: {attempts}')


def chemistry_install_ok(text:str,platform:str,action:str)->bool:
    if '<link rel="manifest" href="/chemistry/app/manifest.webmanifest">' not in text: return False
    if 'href="intent://app/chemistry' in text or 'href="sidestore://install?' in text or f'href="{PWA}"' in text: return False
    if 'href="/store/open"' not in text: return False
    if platform=='android':
        return re.search(r'data-musitu-install-target="intent://app/chemistry\?action='+re.escape(action)+r'[^\"]*package=com\.musitu\.store',text) is not None
    if platform=='ios': return 'data-musitu-install-target="sidestore://install?url=' in text
    return f'data-musitu-install-target="{PWA}"' in text


def self_install_ok(text:str)->bool:
    return (
        'data-musitu-store-pwa-install' in text and
        re.search(r'data-musitu-store-bootstrap-target="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is not None and
        re.search(r'href="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is None and
        '<link rel="manifest" href="/store/manifest.webmanifest">' in text and
        'href="/store">Open Store in browser</a>' in text
    )


def android_bootstrap_ok(text:str)->bool:
    return (
        re.search(r'data-musitu-store-bootstrap-target="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is not None and
        re.search(r'href="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is None and
        re.search(r'data-musitu-install-target="intent://app/chemistry\?action=install[^\"]*package=com\.musitu\.store',text) is not None and
        '<link rel="manifest" href="/chemistry/app/manifest.webmanifest">' in text
    )


def main()->None:
    results={}

    for platform in ('android','web'):
        results[f'{platform} self-install']=wait_html('/store/self-install',platform,self_install_ok)

    results['android bootstrap-control']=wait_html('/store/install','android',android_bootstrap_ok)

    for action in ('install','update','repair','reinstall'):
        path='/store/install' if action=='install' else '/store/'+action
        for platform in ('android','ios','web'):
            results[f'{platform} chemistry-{action}']=wait_html(path,platform,lambda text,p=platform,a=action:chemistry_install_ok(text,p,a))

    for attempt in range(1,ATTEMPTS+1):
        code,headers,body=request('/store/assets/store.js','web','application/javascript')
        text=body.decode('utf-8','replace')
        ok=(
            code==200 and
            'beforeinstallprompt' in text and
            'data-musitu-install-target' in text and
            'data-musitu-store-pwa-install' in text and
            'data-musitu-store-bootstrap-target' in text and
            'function musituInstallStorePwa()' in text and
            'function musituActivateStoreBootstrap(target)' in text and
            'MUSITU_STORE_MANIFEST' in text and
            '/chemistry/app/manifest.webmanifest' in text and
            'MUSITU_Store_1.0.2.apk' not in text and
            'https://payments.mftintelligence.com/store/bootstrap/' not in text
        )
        if ok:
            results['store-controller']=[{'attempt':attempt,'status':code,'sha256':hashlib.sha256(body).hexdigest(),'ok':True}]
            break
        if attempt<ATTEMPTS: time.sleep(DELAY)
    else:
        raise RuntimeError('public Store self-install controller did not converge')

    code,headers,body=request('/store/open','web','text/html',False)
    if code!=302 or headers.get('location')!=APP or headers.get('content-disposition') is not None or body:
        raise RuntimeError(f'/store/open contract drift: {(code,headers.get("location"),headers.get("content-disposition"),len(body))}')

    payload={
        'schema':'musitu.store.self_install.live.v1',
        'gate':'MUSITU_STORE_SELF_INSTALL_LIVE_PASS',
        'worker_sha256':os.environ.get('EXPECTED_STORE_SELF_INSTALL_WORKER_SHA'),
        'checks':results,
        'open_redirect':APP,
        'native_bootstrap_note':'Android first native Store install still requires local APK acquisition and mandatory system installer approval.',
    }
    out=Path(os.environ.get('NATIVE_HANDOFF_EVIDENCE','/tmp'))
    out.mkdir(parents=True,exist_ok=True)
    (out/'store-self-install-live.json').write_text(json.dumps(payload,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    print(json.dumps(payload,sort_keys=True))

if __name__=='__main__': main()
