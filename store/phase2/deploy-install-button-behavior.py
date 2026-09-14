#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import re

MODULE_PATH=Path(__file__).with_name('deploy-browser-first-launch.py')
spec=importlib.util.spec_from_file_location('musitu_store_browser_first_transaction',MODULE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit('unable to load guarded MUSITU Store browser-first deployment core')
browser=importlib.util.module_from_spec(spec)
spec.loader.exec_module(browser)
base=browser.base

EXPECTED_WORKER=os.environ.get('EXPECTED_INSTALL_BUTTON_WORKER_SHA','60fcba26dc4d104c6bb9cb0567c66c8e98d38b217c89217b89625947b9062782')
EXPECTED_RENDER='d4d0b6aef8b1a8d887449c7be60c75190123e7fbb3183e4faf42d10f69be492c'
PWA='https://payments.mftintelligence.com/chemistry/install'
CHEMISTRY_MANIFEST='/chemistry/app/manifest.webmanifest'

browser.UNCHANGED=tuple(p for p in browser.UNCHANGED if p!='/store/assets/store.js')
if ('/store/assets/store.js','web','application/javascript') not in browser.ROLLBACK_CASES:
    browser.ROLLBACK_CASES.append(('/store/assets/store.js','web','application/javascript'))


def verify_local_roots()->None:
    for name,expected in base.EXPECTED_BASELINE.items():
        observed=browser.digest((base.BASELINE/name).read_bytes())
        if observed!=expected:
            raise RuntimeError(f'baseline {name} hash mismatch: {observed} != {expected}')
    changed=[]
    for name in base.MODULES:
        before=(base.BASELINE/name).read_bytes(); after=(base.CANDIDATE/name).read_bytes()
        if before!=after: changed.append(name)
    if changed!=['worker.mjs']:
        raise RuntimeError(f'install-button production change must be worker-only: {changed}')
    for name in ('render.mjs','assets.mjs','generated-data.mjs'):
        if (base.BASELINE/name).read_bytes()!=(base.CANDIDATE/name).read_bytes():
            raise RuntimeError(f'protected module changed: {name}')
    if browser.digest((base.CANDIDATE/'render.mjs').read_bytes())!=EXPECTED_RENDER:
        raise RuntimeError('verified browser-first renderer drift')
    worker=(base.CANDIDATE/'worker.mjs').read_text(encoding='utf-8')
    if browser.digest(worker.encode())!=EXPECTED_WORKER:
        raise RuntimeError('install-button worker hash mismatch')
    for token in (
        'beforeinstallprompt','data-musitu-install-target','/chemistry/app/manifest.webmanifest',
        'function installControlButtons(','function musituChemistryManifestActive()',
        'window.location.assign(target)',"case '/store/open': r=Response.redirect(CATALOG.apps[0].releases[0].web.appURL,302);",
        'const MACHINE_ENDPOINT_INFO=',"'/store/android/repo/index-v1.jar'","'/store/bootstrap/MUSITU_Store_1.0.2.apk'",
    ):
        if token not in worker: raise RuntimeError(f'candidate worker missing required token: {token}')
    base.checks['candidate_modules']={name:browser.digest((base.CANDIDATE/name).read_bytes()) for name in base.MODULES}
    base.checks['changed_modules']=['worker.mjs']
    base.checks['protected_modules_preserved']=['render.mjs','assets.mjs','generated-data.mjs']
    base.checks['install_button_worker_sha256']=EXPECTED_WORKER
    base.checks['production_only_worker_logic_preserved']=True


def install_surface_ok(text:str,platform:str,action:str)->bool:
    if f'href="{PWA}"' in text or 'href="intent://app/chemistry' in text or 'href="sidestore://install?' in text:
        return False
    if f'<link rel="manifest" href="{CHEMISTRY_MANIFEST}">' not in text or 'href="/store/open"' not in text:
        return False
    if platform=='android':
        return re.search(r'data-musitu-install-target="intent://app/chemistry\?action='+re.escape(action)+r'[^\"]*package=com\.musitu\.store',text) is not None
    if platform=='ios': return 'data-musitu-install-target="sidestore://install?url=' in text
    return f'data-musitu-install-target="{PWA}"' in text


def verify_install_carriers()->None:
    convergence={}
    for action in ('install','update','repair','reinstall'):
        path='/store/install' if action=='install' else '/store/'+action
        for platform in ('android','ios','web'):
            attempts=[]
            for attempt in range(1,browser.ATTEMPTS+1):
                text=browser.html_probe(path,platform)
                ok=install_surface_ok(text,platform,action)
                attempts.append({'attempt':attempt,'sha256':browser.digest(text.encode()),'ok':ok})
                if ok: break
                if attempt<browser.ATTEMPTS: browser.time.sleep(browser.DELAY_SECONDS)
            else:
                raise RuntimeError(f'{platform} {action} install-button behavior did not converge: {attempts}')
            convergence[f'{platform} {action}']=attempts
    base.checks['install_button_convergence']=convergence
    base.checks['install_carrier_separation']={
        'android':'button -> MUSITU Store intent','ios':'button -> SideStore','web':'button -> browser PWA prompt/help',
        'browser_fallback':'/store/open'
    }


def verify_install_controller()->None:
    attempts=[]
    for attempt in range(1,browser.ATTEMPTS+1):
        code,headers,body=browser.probe('/store/assets/store.js','web','application/javascript')
        text=body.decode('utf-8','replace')
        ok=(code==200 and 'beforeinstallprompt' in text and 'data-musitu-install-target' in text and CHEMISTRY_MANIFEST in text and 'window.location.assign(target)' in text and re.search(r'\.(?:apk|ipa)(?:[\'\"?]|$)',text,re.I) is None)
        attempts.append({'attempt':attempt,'status':code,'sha256':browser.digest(body),'ok':ok})
        if ok:
            base.checks['install_button_controller_public']=attempts
            return
        if attempt<browser.ATTEMPTS: browser.time.sleep(browser.DELAY_SECONDS)
    raise RuntimeError(f'public install controller did not converge: {attempts}')


def verify_candidate_public()->None:
    base.verify_topology_and_settings()
    base.verify_release_identity()
    browser.verify_unchanged_routes()
    browser.verify_machine_contract()
    browser.verify_discovery_contract()
    browser.verify_open_redirect()
    verify_install_carriers()
    browser.verify_manifest()
    verify_install_controller()
    base.checks['browser_first_public_contract']=True
    base.checks['install_button_public_contract']=True

browser.verify_local_roots=verify_local_roots
browser.verify_install_carriers=verify_install_carriers
browser.verify_candidate_public=verify_candidate_public
base.verify_local_roots=verify_local_roots
base.verify_candidate_public=verify_candidate_public
base.checks['transaction_policy']['candidate']='worker-only install-button controller; render/assets/generated-data preserved byte-for-byte'

if __name__=='__main__':
    base.main()
