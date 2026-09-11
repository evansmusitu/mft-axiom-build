#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import time

MODULE_PATH=Path(__file__).with_name('deploy-native-install-handoff.py')
spec=importlib.util.spec_from_file_location('musitu_store_platform_carrier_base',MODULE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit('unable to load guarded Store deployment module')
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

ATTEMPTS=14
MACHINE_ATTEMPTS=5
DELAY_SECONDS=1.0
UA={
    'android':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
    'ios':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
    'web':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
}
ACTION_PATHS=(
    '/store',
    '/store/apps/chemistry',
    '/store/install',
    '/store/update',
    '/store/repair',
    '/store/reinstall',
    '/store/search?q=chemistry',
    '/store?lite=1',
)
UNCHANGED=(
    '/store/developer',
    '/store/releases',
    '/store/status',
    '/store/offline',
    '/store/healthz',
    '/store/rollback',
    '/store/transfer-device',
)
base.UNCHANGED=list(UNCHANGED)
baseline_platform={}


def direct_public(path:str,ua:str,accept='text/html'):
    sep='&' if '?' in path else '?'
    headers={'Accept':accept,'User-Agent':ua,'Cache-Control':'no-cache','Pragma':'no-cache'}
    return base.request(base.BASE_URL+path+sep+'musitu_platform_carrier_probe='+str(time.time_ns()),'GET',headers)


def verify_local_roots():
    for name,digest in base.EXPECTED_BASELINE.items():
        observed=base.sha256((base.BASELINE/name).read_bytes())
        if observed!=digest:
            raise RuntimeError(f'baseline {name} hash mismatch: {observed} != {digest}')
    for name in ('assets.mjs','generated-data.mjs'):
        if (base.BASELINE/name).read_bytes()!=(base.CANDIDATE/name).read_bytes():
            raise RuntimeError(f'candidate unexpectedly changes {name}')
    for name in ('worker.mjs','render.mjs'):
        if (base.BASELINE/name).read_bytes()==(base.CANDIDATE/name).read_bytes():
            raise RuntimeError(f'candidate did not change {name}')
    render=(base.CANDIDATE/'render.mjs').read_text(encoding='utf-8')
    worker=(base.CANDIDATE/'worker.mjs').read_text(encoding='utf-8')
    for token in (
        'package=com.musitu.store',
        'sidestore://install?url=',
        'sidestore://source?url=',
        'https://payments.mftintelligence.com/chemistry/install',
        'Install Web App instead',
        'Open in browser',
    ):
        if token not in render:
            raise RuntimeError(f'candidate render missing {token!r}')
    for token in (
        'primaryInstallHref',
        'renderApp(request)',
        "renderLifecycle(request,'update')",
        "renderLifecycle(request,'repair')",
        "renderLifecycle(request,'reinstall')",
        "renderSearch(request,u.searchParams.get('q')||'')",
        'liteHome(lang,request)',
    ):
        if token not in worker:
            raise RuntimeError(f'candidate worker missing {token!r}')
    base.checks['changed_modules']=['worker.mjs','render.mjs']
    base.checks['candidate_module_sha256']={name:base.sha256((base.CANDIDATE/name).read_bytes()) for name in base.MODULES}
    base.checks['assets_and_generated_data_preserved']=True


def stable_machine_contract():
    observations={}
    for path,(accept,expected) in base.MACHINE.items():
        last=[]
        for attempt in range(1,MACHINE_ATTEMPTS+1):
            code,headers,body=base.public(path,'text/html',human=True)
            ctype=(headers.get('Content-Type') or headers.get('content-type') or '').lower()
            text=body.decode('utf-8','replace')
            browser_ok=code==200 and ctype.startswith('text/html') and all(t in text for t in ('Machine-readable endpoint','Readable browser view.','Back to MUSITU Store','?raw=1'))
            code2,_,raw=base.public(path,accept)
            code3,_,override=base.public(path+'?raw=1','text/html',human=True)
            raw_ok=code2==200 and base.sha256(raw)==expected
            override_ok=code3==200 and base.sha256(override)==expected and raw==override
            ok=browser_ok and raw_ok and override_ok
            last.append({'attempt':attempt,'browser_ok':browser_ok,'raw_ok':raw_ok,'override_ok':override_ok})
            if ok:
                observations[path]={'raw_sha256':expected,'browser_html':True,'raw_override_identical':True,'attempts':last}
                break
            if attempt<MACHINE_ATTEMPTS:
                time.sleep(DELAY_SECONDS)
        else:
            raise RuntimeError(f'machine endpoint did not converge: {path}: {last}')
    base.checks['machine_endpoint_verification']=observations
    return observations


def capture_baseline_public():
    base.baseline_public.clear()
    for path in UNCHANGED:
        accept='application/json' if path.endswith('healthz') else 'text/html'
        code,headers,body=base.public(path,accept)
        if code!=200:
            raise RuntimeError(f'baseline unchanged route unavailable: {path}')
        base.baseline_public[path]={'sha256':base.sha256(body),'content_type':headers.get('Content-Type') or headers.get('content-type')}
    for platform,ua in UA.items():
        baseline_platform[platform]={}
        for path in ACTION_PATHS:
            code,headers,body=direct_public(path,ua)
            ctype=(headers.get('Content-Type') or headers.get('content-type') or '').lower()
            if code!=200 or not ctype.startswith('text/html'):
                raise RuntimeError(f'baseline {platform} route unavailable: {path}: HTTP {code} {ctype}')
            baseline_platform[platform][path]={'status':code,'content_type':ctype,'sha256':base.sha256(body)}
    base.checks['baseline_platform_matrix']=baseline_platform


def html_hrefs(text:str):
    import re
    return re.findall(r'href="([^"]+)"',text)


def expected_action(path:str)->str:
    if path.startswith('/store/update'): return 'update'
    if path.startswith('/store/repair'): return 'repair'
    if path.startswith('/store/reinstall'): return 'reinstall'
    return 'install'


def candidate_check(platform:str,path:str,text:str):
    links=html_hrefs(text)
    if platform=='android':
        action=expected_action(path)
        if not any(h.startswith(f'intent://app/chemistry?action={action}') and 'scheme=musitustore' in h and 'package=com.musitu.store' in h for h in links):
            raise RuntimeError(f'Android native Store intent missing for {path}')
        if any(('chemistry' in h.lower() and h.lower().endswith('.apk')) or '/store/android/repo/' in h.lower() for h in links):
            raise RuntimeError(f'Android browser Chemistry APK action leaked on {path}')
        if path=='/store/install':
            for token in ('Install MUSITU Store first','MUSITU_Store_1.0.2.apk','Install Web App instead','Open in browser'):
                if token not in text: raise RuntimeError(f'Android Install missing {token!r}')
    elif platform=='ios':
        if not any(h.startswith('sidestore://install?url=') for h in links):
            raise RuntimeError(f'iOS SideStore install handoff missing for {path}')
        if any(h.lower().startswith(('http://','https://')) and h.lower().endswith('.ipa') for h in links):
            raise RuntimeError(f'iOS raw IPA browser action leaked on {path}')
        if path=='/store/install':
            for token in ('sidestore://source?url=','Add MUSITU source to SideStore','Install Web App instead','Open in browser'):
                if token not in text: raise RuntimeError(f'iOS Install missing {token!r}')
    else:
        if 'https://payments.mftintelligence.com/chemistry/install' not in links:
            raise RuntimeError(f'Web/PWA dedicated install surface missing for {path}')
        if any(h.lower().endswith(('.apk','.ipa')) for h in links):
            raise RuntimeError(f'Web/PWA package browser action leaked on {path}')
        if path=='/store/install' and 'Open in browser' not in text:
            raise RuntimeError('Web/PWA Open in browser fallback missing')


def verify_candidate_matrix():
    observations={}
    for platform,ua in UA.items():
        observations[platform]={}
        for path in ACTION_PATHS:
            attempts=[]
            for attempt in range(1,ATTEMPTS+1):
                try:
                    code,headers,body=direct_public(path,ua)
                    ctype=(headers.get('Content-Type') or headers.get('content-type') or '').lower()
                    text=body.decode('utf-8','replace')
                    if code!=200 or not ctype.startswith('text/html'):
                        raise RuntimeError(f'HTTP {code} {ctype}')
                    candidate_check(platform,path,text)
                    attempts.append({'attempt':attempt,'status':code,'sha256':base.sha256(body),'ok':True})
                    observations[platform][path]={'sha256':base.sha256(body),'attempts':attempts}
                    break
                except Exception as exc:
                    attempts.append({'attempt':attempt,'ok':False,'error':str(exc)[:240]})
                    if attempt<ATTEMPTS:
                        time.sleep(DELAY_SECONDS)
            else:
                raise RuntimeError(f'candidate {platform} {path} did not converge: {attempts}')
    base.checks['candidate_platform_matrix']=observations
    base.checks['android_all_install_actions_target_com_musitu_store']=True
    base.checks['ios_all_install_actions_target_sidestore']=True
    base.checks['web_pwa_all_install_actions_target_install_surface']=True
    base.checks['browser_chemistry_package_download_actions_absent']=True


def verify_baseline_matrix():
    observations={}
    for platform,ua in UA.items():
        observations[platform]={}
        for path in ACTION_PATHS:
            expected=baseline_platform[platform][path]
            attempts=[]
            for attempt in range(1,ATTEMPTS+1):
                code,headers,body=direct_public(path,ua)
                ctype=(headers.get('Content-Type') or headers.get('content-type') or '').lower()
                digest=base.sha256(body)
                ok=code==expected['status'] and ctype==expected['content_type'] and digest==expected['sha256']
                attempts.append({'attempt':attempt,'status':code,'content_type':ctype,'sha256':digest,'ok':ok})
                if ok:
                    observations[platform][path]={'sha256':digest,'attempts':attempts}
                    break
                if attempt<ATTEMPTS:
                    time.sleep(DELAY_SECONDS)
            else:
                raise RuntimeError(f'rollback {platform} {path} did not restore exact baseline: {attempts}')
    base.checks['rollback_platform_matrix']=observations


def verify_candidate_public():
    base.verify_topology_and_settings()
    base.verify_release_identity()
    base.verify_unchanged_routes()
    verify_candidate_matrix()
    stable_machine_contract()
    base.checks['unchanged_store_routes']={k:v['sha256'] for k,v in base.baseline_public.items()}


def verify_baseline_public():
    base.verify_topology_and_settings()
    base.verify_release_identity()
    base.verify_unchanged_routes()
    verify_baseline_matrix()
    stable_machine_contract()


def write_evidence(gate:str,error=None):
    passed=gate.endswith('PASS')
    normalized='MUSITU_STORE_PLATFORM_INSTALL_CARRIERS_DEPLOY_AND_ROLLBACK_PASS' if passed else 'MUSITU_STORE_PLATFORM_INSTALL_CARRIERS_DEPLOY_FAIL'
    payload={
        'schema':'musitu.store.platform_install_carriers.production.v1',
        'gate':normalized,
        'head':base.HEAD,
        'worker':base.WORKER,
        'route':base.ROUTE,
        'baseline_modules':base.EXPECTED_BASELINE,
        'candidate_modules':base.checks.get('candidate_module_sha256'),
        'platforms':['android','ios','web_pwa'],
        'install_actions':['install','update','repair','reinstall'],
        'state':base.state,
        'checks':base.checks,
        'error':error,
    }
    raw=(json.dumps(payload,indent=2,sort_keys=True)+'\n').encode()
    (base.EVIDENCE/'deployment.json').write_bytes(raw)
    (base.EVIDENCE/'deployment.sha256').write_text(base.sha256(raw)+'  deployment.json\n',encoding='utf-8')
    return payload


base.verify_local_roots=verify_local_roots
base.verify_machine_contract=stable_machine_contract
base.capture_baseline_public=capture_baseline_public
base.verify_candidate_public=verify_candidate_public
base.verify_baseline_public=verify_baseline_public
base.write_evidence=write_evidence
base.checks['probe_policy']={
    'attempts':ATTEMPTS,
    'delay_seconds':DELAY_SECONDS,
    'platforms':['Android Chrome','iPhone Safari','Desktop Chrome'],
    'action_routes':list(ACTION_PATHS),
    'rollback':'exact platform-specific HTML body SHA-256 restoration',
    'failure_behavior':'restore exact captured module-root baseline',
}
base.checks['physical_device_verification_claimed']=False
base.checks['physical_device_verification_boundary']='Production edge and UA-specific routing are verified here; real-device app handoff requires a physical device and is not fabricated by CI.'

if __name__=='__main__':
    base.main()
