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

ATTEMPTS=5
DELAY_SECONDS=1.0


def exact_probe(path:str,accept:str,expected_sha:str,*,human:bool=False,html_tokens=()):
    observations=[]
    for attempt in range(1,ATTEMPTS+1):
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
        if attempt<ATTEMPTS:
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
            # Hash equality above is required; this additionally proves literal byte identity.
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


base.verify_machine_contract=stable_machine_contract
base.checks['machine_probe_policy']={
    'semantics':'exact expected bytes required; bounded retries tolerate only transient edge inconsistency',
    'attempts':ATTEMPTS,
    'delay_seconds':DELAY_SECONDS,
    'diagnostic_run':34615364218,
    'diagnostic_result':'all 11 raw overrides byte-identical to software-client raw bodies',
}

if __name__=='__main__':
    base.main()
