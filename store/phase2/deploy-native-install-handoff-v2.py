#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import time

MODULE_PATH=Path(__file__).with_name('deploy-native-install-handoff.py')
spec=importlib.util.spec_from_file_location('musitu_native_install_deploy_base',MODULE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit('unable to load guarded native install deployment module')
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

MACHINE_ATTEMPTS=5
PUBLIC_INSTALL_ATTEMPTS=12
DELAY_SECONDS=1.0


def exact_probe(path:str,accept:str,expected_sha:str,*,human:bool=False,html_tokens=()):
    observations=[]
    for attempt in range(1,MACHINE_ATTEMPTS+1):
        code,headers,body=base.public(path,accept,human=human)
        ctype=(headers.get('Content-Type') or headers.get('content-type') or '').lower()
        digest=base.sha256(body)
        text=body.decode('utf-8','replace') if human else ''
        ok=code==200
        if human:
            ok=ok and ctype.startswith('text/html') and all(token in text for token in html_tokens) and not text.lstrip().startswith(('{','['))
        else:
            ok=ok and digest==expected_sha
        observations.append({'attempt':attempt,'status':code,'content_type':ctype,'sha256':digest,'ok':ok})
        if ok:
            return code,headers,body,observations
        if attempt<MACHINE_ATTEMPTS:
            time.sleep(DELAY_SECONDS)
    raise RuntimeError(f'exact production representation did not converge for {path}: {observations}')


def stable_machine_contract():
    endpoint_observations={}
    for path,(accept,expected) in base.MACHINE.items():
        _,_,_,browser_attempts=exact_probe(
            path,
            'text/html',
            '',
            human=True,
            html_tokens=('Machine-readable endpoint','Readable browser view.','Back to MUSITU Store','?raw=1'),
        )
        _,_,raw,raw_attempts=exact_probe(path,accept,expected)
        _,_,override,override_attempts=exact_probe(path+'?raw=1','text/html',expected,human=False)
        if raw!=override:
            raise RuntimeError(f'raw override byte inequality persisted for {path}')
        endpoint_observations[path]={
            'raw_sha256':expected,
            'browser_html':True,
            'raw_override_identical':True,
            'browser_attempts':browser_attempts,
            'software_raw_attempts':raw_attempts,
            'raw_override_attempts':override_attempts,
        }
    base.checks['machine_endpoint_verification']=endpoint_observations
    return endpoint_observations


def probe_android_install(require_candidate:bool):
    ua='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'
    headers={'Accept':'text/html','User-Agent':ua,'Cache-Control':'no-cache','Pragma':'no-cache'}
    observations=[]
    required=(
        'href="musitustore://app/chemistry"',
        '>Install in MUSITU Store</a>',
        '>Install MUSITU Store first</a>',
        'MUSITU_Store_1.0.2.apk',
    )
    forbidden='<a class="button" href="/store/bootstrap/MUSITU_Store_1.0.2.apk">Install in MUSITU Store</a>'
    for attempt in range(1,PUBLIC_INSTALL_ATTEMPTS+1):
        url=base.BASE_URL+'/store/install?musitu_native_verify='+str(time.time_ns())
        code,resp_headers,body=base.request(url,'GET',headers)
        ctype=(resp_headers.get('Content-Type') or resp_headers.get('content-type') or '').lower()
        digest=base.sha256(body)
        text=body.decode('utf-8','replace')
        if require_candidate:
            ok=code==200 and ctype.startswith('text/html') and all(token in text for token in required) and forbidden not in text
        else:
            ok=code==200 and digest==base.baseline_install_sha
        observations.append({'attempt':attempt,'status':code,'content_type':ctype,'sha256':digest,'ok':ok})
        if ok:
            return body,observations
        if attempt<PUBLIC_INSTALL_ATTEMPTS:
            time.sleep(DELAY_SECONDS)
    label='candidate native install handoff' if require_candidate else 'baseline install response'
    raise RuntimeError(f'{label} did not converge on public production edge: {observations}')


def stable_candidate_public():
    base.verify_topology_and_settings()
    base.verify_release_identity()
    base.verify_unchanged_routes()
    _,attempts=probe_android_install(True)
    base.checks['android_primary_install_routes_to_native_store']=True
    base.checks['candidate_install_edge_attempts']=attempts
    base.checks['machine_endpoint_verification']=stable_machine_contract()
    base.checks['unchanged_store_routes']={k:v['sha256'] for k,v in base.baseline_public.items()}


def stable_baseline_public():
    base.verify_topology_and_settings()
    base.verify_release_identity()
    base.verify_unchanged_routes()
    _,attempts=probe_android_install(False)
    base.checks['rollback_install_edge_attempts']=attempts
    stable_machine_contract()


base.verify_machine_contract=stable_machine_contract
base.verify_candidate_public=stable_candidate_public
base.verify_baseline_public=stable_baseline_public
base.checks['machine_probe_policy']={
    'semantics':'exact expected bytes required; bounded retries tolerate only transient edge inconsistency',
    'attempts':MACHINE_ATTEMPTS,
    'delay_seconds':DELAY_SECONDS,
    'diagnostic_run':34615364218,
    'diagnostic_result':'all 11 raw overrides byte-identical to software-client raw bodies',
}
base.checks['public_install_probe_policy']={
    'semantics':'candidate must expose the native MUSITU Store URI publicly; rollback must reproduce the exact captured baseline install body',
    'attempts':PUBLIC_INSTALL_ATTEMPTS,
    'delay_seconds':DELAY_SECONDS,
    'failure_behavior':'restore exact captured baseline',
}

if __name__=='__main__':
    base.main()
