#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import re

MODULE_PATH=Path(__file__).with_name('deploy-install-button-behavior.py')
spec=importlib.util.spec_from_file_location('musitu_store_install_button_transaction',MODULE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit('unable to load guarded MUSITU Store install-button deployment core')
install=importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)
browser=install.browser
base=install.base

EXPECTED_WORKER=os.environ.get('EXPECTED_STORE_SELF_INSTALL_WORKER_SHA','c0c41c6de7b26ba25ebea6ef7eb5dcbf346a179737a4cc6c1a128e6fec4e7409')
install.EXPECTED_WORKER=EXPECTED_WORKER
ORIGINAL_LOCAL_VERIFY=install.verify_local_roots


def verify_local_roots()->None:
    ORIGINAL_LOCAL_VERIFY()
    worker=(base.CANDIDATE/'worker.mjs').read_text(encoding='utf-8')
    required=(
        "case '/store/self-install': r=storeSelfInstallPage(request); break;",
        'data-musitu-store-pwa-install',
        'data-musitu-store-bootstrap-target',
        'function musituInstallStorePwa()',
        'function musituActivateStoreBootstrap(target)',
        'function storeSelfInstallPage(request)',
        'MUSITU_STORE_MANIFEST',
    )
    for token in required:
        if token not in worker:
            raise RuntimeError(f'Store self-install candidate missing token: {token}')
    base.checks['store_self_install_worker_sha256']=EXPECTED_WORKER
    base.checks['store_self_install_local_contract']=True


def verify_install_controller()->None:
    attempts=[]
    for attempt in range(1,browser.ATTEMPTS+1):
        code,headers,body=browser.probe('/store/assets/store.js','web','application/javascript')
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
        attempts.append({'attempt':attempt,'status':code,'sha256':browser.digest(body),'ok':ok})
        if ok:
            base.checks['store_self_install_controller_public']=attempts
            return
        if attempt<browser.ATTEMPTS:
            browser.time.sleep(browser.DELAY_SECONDS)
    raise RuntimeError(f'public Store self-install controller did not converge: {attempts}')


def self_install_page_ok(text:str)->bool:
    return (
        'data-musitu-store-pwa-install' in text and
        re.search(r'data-musitu-store-bootstrap-target="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is not None and
        re.search(r'href="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is None and
        '<link rel="manifest" href="/store/manifest.webmanifest">' in text and
        'href="/store">Open Store in browser</a>' in text
    )


def android_install_page_ok(text:str)->bool:
    return (
        re.search(r'data-musitu-store-bootstrap-target="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is not None and
        re.search(r'href="/store/bootstrap/MUSITU_Store_[^\"]+\.apk"',text) is None and
        re.search(r'data-musitu-install-target="intent://app/chemistry\?action=install[^\"]*package=com\.musitu\.store',text) is not None and
        '<link rel="manifest" href="/chemistry/app/manifest.webmanifest">' in text
    )


def verify_store_self_install()->None:
    convergence={}
    for platform in ('android','web'):
        attempts=[]
        for attempt in range(1,browser.ATTEMPTS+1):
            text=browser.html_probe('/store/self-install',platform)
            ok=self_install_page_ok(text)
            attempts.append({'attempt':attempt,'sha256':browser.digest(text.encode()),'ok':ok})
            if ok: break
            if attempt<browser.ATTEMPTS: browser.time.sleep(browser.DELAY_SECONDS)
        else:
            raise RuntimeError(f'{platform} Store self-install page did not converge: {attempts}')
        convergence[f'{platform} /store/self-install']=attempts

    attempts=[]
    for attempt in range(1,browser.ATTEMPTS+1):
        text=browser.html_probe('/store/install','android')
        ok=android_install_page_ok(text)
        attempts.append({'attempt':attempt,'sha256':browser.digest(text.encode()),'ok':ok})
        if ok: break
        if attempt<browser.ATTEMPTS: browser.time.sleep(browser.DELAY_SECONDS)
    else:
        raise RuntimeError(f'Android Store bootstrap control did not converge: {attempts}')
    convergence['android /store/install bootstrap']=attempts
    base.checks['store_self_install_convergence']=convergence
    base.checks['store_self_install_public_contract']=True


def verify_candidate_public()->None:
    base.verify_topology_and_settings()
    base.verify_release_identity()
    browser.verify_unchanged_routes()
    browser.verify_machine_contract()
    browser.verify_discovery_contract()
    browser.verify_open_redirect()
    install.verify_install_carriers()
    browser.verify_manifest()
    verify_install_controller()
    verify_store_self_install()
    base.checks['browser_first_public_contract']=True
    base.checks['install_button_public_contract']=True
    base.checks['store_self_install_public_contract']=True

install.verify_install_controller=verify_install_controller
install.verify_local_roots=verify_local_roots
install.verify_candidate_public=verify_candidate_public
browser.verify_local_roots=verify_local_roots
browser.verify_candidate_public=verify_candidate_public
base.verify_local_roots=verify_local_roots
base.verify_candidate_public=verify_candidate_public
base.checks['transaction_policy']['candidate']='worker-only Store self-install controller/page; existing Chemistry install behavior and render/assets/generated-data preserved byte-for-byte'

if __name__=='__main__':
    base.main()
