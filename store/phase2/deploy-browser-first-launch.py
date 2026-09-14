#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

MODULE_PATH=Path(__file__).with_name('deploy-native-install-handoff.py')
spec=importlib.util.spec_from_file_location('musitu_store_module_root_transaction',MODULE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit('unable to load guarded MUSITU Store module-root deployment core')
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

ATTEMPTS=12
DELAY_SECONDS=1.0
APP_URL='https://payments.mftintelligence.com/chemistry/app/'
PWA_INSTALL='https://payments.mftintelligence.com/chemistry/install'
EXPECTED_RENDER_SHA='d4d0b6aef8b1a8d887449c7be60c75190123e7fbb3183e4faf42d10f69be492c'
UA={
    'android':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
    'ios':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
    'web':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
}
UNCHANGED=(
    '/store/developer','/store/releases','/store/status','/store/offline','/store/healthz',
    '/store/assets/store.css','/store/assets/store.js','/store/sw.js',
)
ROLLBACK_CASES=[]
for platform in ('android','ios','web'):
    for path in ('/store','/store/apps/chemistry','/store/search?q=chemistry','/store?lite=1','/store/install','/store/update','/store/repair','/store/reinstall'):
        ROLLBACK_CASES.append((path,platform,'text/html'))
ROLLBACK_CASES.extend((
    ('/store/manifest.webmanifest','web','application/manifest+json'),
    ('/store/open','web','text/html'),
))
baseline_snapshots={}


def digest(raw:bytes)->str:
    return hashlib.sha256(raw).hexdigest()


def add_nonce(path:str)->str:
    sep='&' if '?' in path else '?'
    return path+sep+'musitu_browser_first_probe='+str(time.time_ns())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None


def no_redirect(path:str,headers:dict[str,str]):
    req=urllib.request.Request(base.BASE_URL+add_nonce(path),headers=headers,method='GET')
    opener=urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req,timeout=120) as response:
            return response.status,dict(response.headers),response.read()
    except urllib.error.HTTPError as exc:
        if 300<=exc.code<400:
            return exc.code,dict(exc.headers),exc.read()
        return exc.code,dict(exc.headers),exc.read()


def probe(path:str,platform='web',accept='text/html',navigate=False,no_follow=False):
    headers={
        'Accept':accept,
        'User-Agent':UA[platform],
        'Cache-Control':'no-cache',
        'Pragma':'no-cache',
    }
    if navigate:
        headers['Sec-Fetch-Mode']='navigate'
        headers['Sec-Fetch-Dest']='document'
    if no_follow:
        return no_redirect(path,headers)
    return base.request(base.BASE_URL+add_nonce(path),'GET',headers)


def snapshot(path:str,platform='web',accept='text/html',no_follow=False):
    code,headers,body=probe(path,platform,accept,no_follow=no_follow)
    return {
        'status':code,
        'sha256':digest(body),
        'bytes':len(body),
        'content_type':(headers.get('Content-Type') or headers.get('content-type') or ''),
        'location':headers.get('Location') or headers.get('location'),
    }


def assert_direct_package_free(text:str,label:str)->None:
    if re.search(r'href="https?:[^\"]+\.(?:apk|ipa)(?:[?#][^\"]*)?"',text,re.I):
        raise RuntimeError(f'{label} exposes a direct HTTP package download')


def html_probe(path:str,platform='web'):
    code,headers,body=probe(path,platform,'text/html')
    ctype=(headers.get('Content-Type') or headers.get('content-type') or '').lower()
    if code!=200 or not ctype.startswith('text/html'):
        raise RuntimeError(f'{platform} {path} is not HTML 200: status={code} content_type={ctype!r}')
    return body.decode('utf-8','replace')


def verify_machine_contract():
    observations={}
    for path,(accept,expected) in base.MACHINE.items():
        attempts=[]
        for attempt in range(1,ATTEMPTS+1):
            hc,hh,hb=probe(path,'web','text/html',navigate=True)
            htype=(hh.get('Content-Type') or hh.get('content-type') or '').lower()
            htext=hb.decode('utf-8','replace')
            rc,_,rb=probe(path,'web',accept)
            oc,_,ob=probe(path+'?raw=1','web','text/html',navigate=True)
            ok=(
                hc==200 and htype.startswith('text/html') and
                'Machine-readable endpoint' in htext and 'Readable browser view.' in htext and '?raw=1' in htext and
                rc==200 and digest(rb)==expected and oc==200 and digest(ob)==expected and rb==ob
            )
            attempts.append({'attempt':attempt,'human_status':hc,'raw_status':rc,'override_status':oc,'raw_sha256':digest(rb),'ok':ok})
            if ok:
                observations[path]={'raw_sha256':expected,'raw_override_identical':True,'browser_html':True,'attempts':attempts}
                break
            if attempt<ATTEMPTS:
                time.sleep(DELAY_SECONDS)
        else:
            raise RuntimeError(f'machine endpoint contract did not converge: {path}: {attempts}')
    base.checks['machine_endpoint_verification']=observations
    return observations


def verify_local_roots()->None:
    for name,expected in base.EXPECTED_BASELINE.items():
        observed=digest((base.BASELINE/name).read_bytes())
        if observed!=expected:
            raise RuntimeError(f'baseline {name} hash mismatch: {observed} != {expected}')
    for name in ('assets.mjs','generated-data.mjs'):
        if (base.BASELINE/name).read_bytes()!=(base.CANDIDATE/name).read_bytes():
            raise RuntimeError(f'candidate unexpectedly changes protected live module: {name}')
    old_render=(base.BASELINE/'render.mjs').read_bytes(); new_render=(base.CANDIDATE/'render.mjs').read_bytes()
    old_worker=(base.BASELINE/'worker.mjs').read_bytes(); new_worker=(base.CANDIDATE/'worker.mjs').read_bytes()
    if old_render==new_render or old_worker==new_worker:
        raise RuntimeError('browser-first candidate must change both render.mjs and worker.mjs')
    if digest(new_render)!=EXPECTED_RENDER_SHA:
        raise RuntimeError('candidate render does not equal the verified browser-first renderer')
    worker_text=new_worker.decode('utf-8')
    render_text=new_render.decode('utf-8')
    required_worker=(
        'const MACHINE_ENDPOINT_INFO=',
        'function machineDataResponse(',
        "'/store/android/repo/index-v1.jar'",
        "'/store/bootstrap/MUSITU_Store_1.0.2.apk'",
        "Open MUSITU instantly in your browser.",
        "Browser-first verified MUSITU software distribution.",
        'href="/store/open">Open app</a>',
    )
    for token in required_worker:
        if token not in worker_text:
            raise RuntimeError(f'candidate worker missing required preserved/browser-first token: {token}')
    for token in ('const BROWSER_LAUNCH_URL=\'/store/open\';','Install options','Open MUSITU instantly in your browser.'):
        if token not in render_text:
            raise RuntimeError(f'candidate render missing browser-first token: {token}')
    base.checks['candidate_modules']={name:digest((base.CANDIDATE/name).read_bytes()) for name in base.MODULES}
    base.checks['changed_modules']=['render.mjs','worker.mjs']
    base.checks['protected_modules_preserved']=['assets.mjs','generated-data.mjs']
    base.checks['candidate_render_sha256']=digest(new_render)
    base.checks['production_only_worker_logic_preserved']=True


def capture_baseline_public()->None:
    for path in UNCHANGED:
        accept='application/json' if path.endswith('/healthz') else ('text/css' if path.endswith('.css') else ('application/javascript' if path.endswith(('.js','.mjs')) else 'text/html'))
        baseline_snapshots[(path,'web',accept,False)]=snapshot(path,'web',accept)
    for path,platform,accept in ROLLBACK_CASES:
        no_follow=(path=='/store/open')
        baseline_snapshots[(path,platform,accept,no_follow)]=snapshot(path,platform,accept,no_follow=no_follow)
    base.checks['baseline_public_snapshot_count']=len(baseline_snapshots)


def verify_unchanged_routes()->None:
    for path in UNCHANGED:
        accept='application/json' if path.endswith('/healthz') else ('text/css' if path.endswith('.css') else ('application/javascript' if path.endswith(('.js','.mjs')) else 'text/html'))
        expected=baseline_snapshots[(path,'web',accept,False)]
        observations=[]
        for attempt in range(1,ATTEMPTS+1):
            got=snapshot(path,'web',accept)
            ok=got==expected
            observations.append({'attempt':attempt,'sha256':got['sha256'],'status':got['status'],'ok':ok})
            if ok: break
            if attempt<ATTEMPTS: time.sleep(DELAY_SECONDS)
        else:
            raise RuntimeError(f'unchanged route drift after deploy: {path}: {observations}')


def verify_discovery_contract()->None:
    for platform in ('android','ios','web'):
        for path in ('/store','/store/apps/chemistry','/store/search?q=chemistry'):
            text=html_probe(path,platform)
            if not re.search(r'href="/store/open"[^>]*>Open [^<]+</a>.*?href="/store/install"[^>]*>Install options</a>',text,re.S):
                raise RuntimeError(f'{platform} {path} is not browser-first')
            assert_direct_package_free(text,f'{platform} {path}')
        lite=html_probe('/store?lite=1',platform)
        if 'href="/store/open">Open app</a>' not in lite or 'href="/store/install">Install options</a>' not in lite:
            raise RuntimeError(f'{platform} low-bandwidth home is not browser-first')
        if 'intent://' in lite or 'sidestore://' in lite:
            raise RuntimeError(f'{platform} low-bandwidth home directly invokes a native carrier')


def verify_open_redirect()->None:
    observations=[]
    for attempt in range(1,ATTEMPTS+1):
        code,headers,body=probe('/store/open','web','text/html',no_follow=True)
        location=headers.get('Location') or headers.get('location')
        disposition=headers.get('Content-Disposition') or headers.get('content-disposition')
        ok=code==302 and location==APP_URL and disposition is None and len(body)==0
        observations.append({'attempt':attempt,'status':code,'location':location,'content_disposition':disposition,'bytes':len(body),'ok':ok})
        if ok:
            base.checks['open_redirect_attempts']=observations
            return
        if attempt<ATTEMPTS: time.sleep(DELAY_SECONDS)
    raise RuntimeError(f'/store/open did not converge to browser application redirect: {observations}')


def verify_install_carriers()->None:
    carrier_checks={}
    for action in ('install','update','repair','reinstall'):
        path='/store/install' if action=='install' else '/store/'+action
        android=html_probe(path,'android')
        if not re.search(r'intent://app/chemistry\?action='+re.escape(action)+r'[^\"]*package=com\.musitu\.store',android):
            raise RuntimeError(f'Android {action} native MUSITU Store handoff lost')
        if 'href="/store/open"' not in android:
            raise RuntimeError(f'Android {action} browser fallback lost')
        ios=html_probe(path,'ios')
        if 'sidestore://install?url=' not in ios or 'href="/store/open"' not in ios:
            raise RuntimeError(f'iOS {action} SideStore/browser separation lost')
        assert_direct_package_free(ios,f'iOS {action}')
        web=html_probe(path,'web')
        if f'href="{PWA_INSTALL}"' not in web or 'href="/store/open"' not in web:
            raise RuntimeError(f'Web {action} PWA/browser separation lost')
        assert_direct_package_free(web,f'Web {action}')
        carrier_checks[action]={'android':'MUSITU Store intent','ios':'SideStore','web':'PWA','browser_fallback':'/store/open'}
    base.checks['install_carrier_separation']=carrier_checks


def verify_manifest()->None:
    code,_,body=probe('/store/manifest.webmanifest','web','application/manifest+json')
    if code!=200:
        raise RuntimeError('manifest unavailable')
    manifest=json.loads(body)
    if manifest.get('description')!='Browser-first verified MUSITU software distribution.' or manifest.get('start_url')!='/store':
        raise RuntimeError('browser-first manifest contract failed')
    base.checks['browser_first_manifest']=True


def verify_candidate_public()->None:
    base.verify_topology_and_settings()
    base.verify_release_identity()
    verify_unchanged_routes()
    verify_machine_contract()
    verify_discovery_contract()
    verify_open_redirect()
    verify_install_carriers()
    verify_manifest()
    base.checks['browser_first_public_contract']=True


def verify_baseline_public()->None:
    base.verify_topology_and_settings()
    base.verify_release_identity()
    observations={}
    for key,expected in baseline_snapshots.items():
        path,platform,accept,no_follow=key
        attempts=[]
        for attempt in range(1,ATTEMPTS+1):
            got=snapshot(path,platform,accept,no_follow=no_follow)
            ok=got==expected
            attempts.append({'attempt':attempt,'status':got['status'],'sha256':got['sha256'],'location':got['location'],'ok':ok})
            if ok: break
            if attempt<ATTEMPTS: time.sleep(DELAY_SECONDS)
        else:
            raise RuntimeError(f'rollback did not reproduce exact public baseline for {platform} {path}: {attempts}')
        observations[f'{platform} {path}']=attempts
    verify_machine_contract()
    base.checks['rollback_public_exactness']=observations


def write_evidence(_gate:str,error=None):
    candidate={name:digest((base.CANDIDATE/name).read_bytes()) for name in base.MODULES}
    gate='MUSITU_STORE_BROWSER_FIRST_DEPLOY_AND_ROLLBACK_PASS' if error is None and base.state.get('final_state_verified') else 'MUSITU_STORE_BROWSER_FIRST_DEPLOY_AND_ROLLBACK_FAIL'
    payload={
        'schema':'musitu.store.browser_first.production.v1',
        'gate':gate,
        'head':base.HEAD,
        'worker':base.WORKER,
        'route':base.ROUTE,
        'baseline_modules':base.EXPECTED_BASELINE,
        'candidate_modules':candidate,
        'state':base.state,
        'checks':base.checks,
        'error':error,
    }
    raw=(json.dumps(payload,indent=2,sort_keys=True)+'\n').encode()
    (base.EVIDENCE/'deployment.json').write_bytes(raw)
    (base.EVIDENCE/'deployment.sha256').write_text(digest(raw)+'  deployment.json\n',encoding='utf-8')
    return payload


base.verify_local_roots=verify_local_roots
base.capture_baseline_public=capture_baseline_public
base.verify_machine_contract=verify_machine_contract
base.verify_candidate_public=verify_candidate_public
base.verify_baseline_public=verify_baseline_public
base.write_evidence=write_evidence
base.checks['transaction_policy']={
    'baseline':'fresh exact live Cloudflare Worker modules from this run',
    'candidate':'patch current live worker + verified browser-first render; preserve live assets and generated data',
    'rollback':'module-root upload of all four exact captured baseline modules',
    'final':'candidate module-root upload only after rollback verification',
    'emergency':'exact baseline restore on any exception',
}

if __name__=='__main__':
    base.main()
