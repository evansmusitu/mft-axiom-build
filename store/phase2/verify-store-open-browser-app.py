#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

STORE_OPEN=os.environ.get('STORE_OPEN_URL','https://payments.mftintelligence.com/store/open')
APP_BASE=os.environ.get('STORE_BROWSER_APP_URL','https://payments.mftintelligence.com/chemistry/app').rstrip('/')
ATTEMPTS=int(os.environ.get('STORE_BROWSER_APP_VERIFY_ATTEMPTS','30'))
DELAY=float(os.environ.get('STORE_BROWSER_APP_VERIFY_DELAY','1'))
UAS={
    'android-chrome':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36',
    'samsung':'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36',
    'ios-safari':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
    'desktop-chrome':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None

NO=urllib.request.build_opener(NoRedirect)
YES=urllib.request.build_opener()

def request(url:str,ua:str,follow:bool=True):
    q=urllib.request.Request(url,headers={
        'User-Agent':ua,
        'Accept':'text/html',
        'Cache-Control':'no-cache, no-store',
        'Pragma':'no-cache',
    })
    try:
        with (YES if follow else NO).open(q,timeout=60) as r:
            return r.status,r.geturl(),{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:
        return e.code,e.geturl(),{k.lower():v for k,v in e.headers.items()},e.read()

def browser_ok(status:int,url:str,headers:dict[str,str],body:bytes)->bool:
    ctype=headers.get('content-type','').lower()
    disposition=headers.get('content-disposition','').lower()
    return (
        status==200
        and url.startswith(APP_BASE+'/')
        and '/install' not in url
        and not re.search(r'\.(?:apk|ipa|aab|zip|exe|msi)(?:[?#]|$)',url,re.I)
        and ctype.startswith('text/html')
        and 'attachment' not in disposition
        and len(body)>1000
        and (b'<html' in body.lower() or b'<!doctype' in body.lower())
    )

def main()->None:
    results={}
    for label,ua in UAS.items():
        attempts=[]
        for n in range(1,ATTEMPTS+1):
            status,url,headers,body=request(STORE_OPEN,ua,True)
            ok=browser_ok(status,url,headers,body)
            attempts.append({
                'attempt':n,
                'status':status,
                'final_url':url,
                'content_type':headers.get('content-type'),
                'content_disposition':headers.get('content-disposition'),
                'platform_route':headers.get('x-musitu-platform-route'),
                'bytes':len(body),
                'sha256':hashlib.sha256(body).hexdigest(),
                'ok':ok,
            })
            if ok:
                break
            if n<ATTEMPTS:
                time.sleep(DELAY)
        else:
            raise SystemExit(f'{label} Store Open did not converge to the browser application: {attempts[-3:]}')
        results[label]=attempts

        status,url,headers,body=request(APP_BASE,ua,False)
        if status!=308 or headers.get('location')!='/chemistry/app/' or headers.get('x-musitu-platform-route')!='universal-browser':
            raise SystemExit(f'{label} direct app root is not universal-browser: {(status,url,headers.get("location"),headers.get("x-musitu-platform-route"))}')

    payload={
        'schema':'musitu.store.browser_app_end_to_end.v1',
        'gate':'MUSITU_STORE_BROWSER_APP_END_TO_END_PASS',
        'store_open':STORE_OPEN,
        'app_base':APP_BASE+'/',
        'platforms':sorted(results),
        'observations':results,
    }
    raw=(json.dumps(payload,indent=2,sort_keys=True)+'\n').encode()
    evidence=os.environ.get('NATIVE_HANDOFF_EVIDENCE')
    if evidence:
        root=Path(evidence)
        root.mkdir(parents=True,exist_ok=True)
        (root/'browser-app-end-to-end.json').write_bytes(raw)
        (root/'browser-app-end-to-end.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  browser-app-end-to-end.json\n',encoding='utf-8')
    print(json.dumps(payload,sort_keys=True))
    print('MUSITU_STORE_BROWSER_APP_END_TO_END=PASS')

if __name__=='__main__':
    main()
