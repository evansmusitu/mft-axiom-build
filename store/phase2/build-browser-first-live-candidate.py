#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil

MODULES=("worker.mjs","render.mjs","assets.mjs","generated-data.mjs")
BASELINE=Path(os.environ["BASELINE_MODULE_ROOT"])
CANDIDATE=Path(os.environ["CANDIDATE_MODULE_ROOT"])
REPORT=Path(os.environ.get("BROWSER_FIRST_BUILD_REPORT","/tmp/musitu-store-install-button-candidate.json"))
EXPECTED_BASELINE_RENDER_SHA=os.environ.get("EXPECTED_BROWSER_FIRST_RENDER_SHA","d4d0b6aef8b1a8d887449c7be60c75190123e7fbb3183e4faf42d10f69be492c")
EXPECTED_CANDIDATE_WORKER_SHA=os.environ.get("EXPECTED_INSTALL_BUTTON_WORKER_SHA","60fcba26dc4d104c6bb9cb0567c66c8e98d38b217c89217b89625947b9062782")

INSTALL_CONTROLLER_OLD="""const STORE_JS=String.raw`'use strict';
if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/store/sw.js',{scope:'/store/'}).catch(()=>{});
  });
}
`;"""
INSTALL_CONTROLLER_NEW="""const STORE_JS=String.raw`'use strict';
const MUSITU_PWA_INSTALL='https://payments.mftintelligence.com/chemistry/install';
const MUSITU_PWA_HELP='https://payments.mftintelligence.com/chemistry/app/#help';
let musituInstallPrompt=null;

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  musituInstallPrompt=event;
});
window.addEventListener('appinstalled',()=>{musituInstallPrompt=null;});

function musituChemistryManifestActive(){
  const manifest=document.querySelector('link[rel="manifest"]');
  if(!manifest) return false;
  try{return new URL(manifest.getAttribute('href')||'',location.href).pathname==='/chemistry/app/manifest.webmanifest';}
  catch{return false;}
}
async function musituActivateInstall(target){
  if(target===MUSITU_PWA_INSTALL){
    if(musituChemistryManifestActive() && musituInstallPrompt){
      const prompt=musituInstallPrompt;
      musituInstallPrompt=null;
      await prompt.prompt();
      return;
    }
    window.location.assign(MUSITU_PWA_HELP);
    return;
  }
  window.location.assign(target);
}
function musituBindInstallControl(control){
  const target=control.getAttribute('data-musitu-install-target')||'';
  if(!target) return;
  control.addEventListener('click',event=>{
    event.preventDefault();
    void musituActivateInstall(target);
  });
}
window.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-musitu-install-target]').forEach(musituBindInstallControl);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/store/sw.js',{scope:'/store/'}).catch(()=>{});
  });
}
`;"""

INSTALL_SHELL_OLD="""function installShellAssets(html,lang){
  let out=html.replace(/<html lang=\"[^\"]+\">/,`<html lang=\"${lang}\">`);
  if(!out.includes('/store/manifest.webmanifest')) out=out.replace('</head>','<link rel=\"manifest\" href=\"/store/manifest.webmanifest\"><script src=\"/store/assets/store.js\" defer></script></head>');
  return out;
}
function htmlResponse(request,html,lang=localeFor(request),extra={}){return response(installShellAssets(html,lang),200,'text/html; charset=utf-8',{'Content-Language':lang,'Vary':'Save-Data, Accept-Language',...extra})}"""
INSTALL_SHELL_NEW="""function installSurface(pathname){return ['/store/install','/store/update','/store/repair','/store/reinstall'].includes(pathname)}
function escapeInstallTarget(value){return String(value).replace(/[&\"<>]/g,c=>({'&':'&amp;','\"':'&quot;','<':'&lt;','>':'&gt;'}[c]))}
function installControlButtons(html){
  const carrier=/(?:intent:\/\/app\/chemistry[^\"]*|sidestore:\/\/install\?[^\"]*|https:\/\/payments\.mftintelligence\.com\/chemistry\/install)/;
  return html.replace(/<a class=\"([^\"]+)\" href=\"([^\"]+)\">([\\s\\S]*?)<\\/a>/g,(whole,klass,target,label)=>carrier.test(target)?`<button type=\"button\" class=\"${klass}\" data-musitu-install-target=\"${escapeInstallTarget(target)}\">${label}</button>`:whole);
}
function installShellAssets(html,lang,request){
  const pathname=new URL(request.url).pathname;
  let out=html.replace(/<html lang=\"[^\"]+\">/,`<html lang=\"${lang}\">`);
  if(installSurface(pathname)) out=installControlButtons(out);
  const manifest=installSurface(pathname)?'/chemistry/app/manifest.webmanifest':'/store/manifest.webmanifest';
  if(!out.includes('rel=\"manifest\"')) out=out.replace('</head>',`<link rel=\"manifest\" href=\"${manifest}\"><script src=\"/store/assets/store.js\" defer></script></head>`);
  return out;
}
function htmlResponse(request,html,lang=localeFor(request),extra={}){return response(installShellAssets(html,lang,request),200,'text/html; charset=utf-8',{'Content-Language':lang,'Vary':'Save-Data, Accept-Language',...extra})}"""


def sha256(raw:bytes)->str:
    return hashlib.sha256(raw).hexdigest()


def replace_once(text:str,old:str,new:str,label:str)->str:
    count=text.count(old)
    if count!=1:
        raise RuntimeError(f"{label}: expected exactly one live occurrence, observed {count}")
    return text.replace(old,new,1)


def main()->None:
    for name in MODULES:
        path=BASELINE/name
        if not path.is_file():
            raise RuntimeError(f"missing exact live baseline module: {name}")

    if sha256((BASELINE/'render.mjs').read_bytes())!=EXPECTED_BASELINE_RENDER_SHA:
        raise RuntimeError('current live render is not the verified browser-first renderer')

    if CANDIDATE.exists():
        shutil.rmtree(CANDIDATE)
    CANDIDATE.mkdir(parents=True)
    for name in MODULES:
        shutil.copyfile(BASELINE/name,CANDIDATE/name)

    worker_path=CANDIDATE/'worker.mjs'
    worker=worker_path.read_text(encoding='utf-8')
    live_only_tokens=(
        'const MACHINE_ENDPOINT_INFO=',
        'function machineDataResponse(',
        "'/store/android/repo/index-v1.jar'",
        "'/store/bootstrap/MUSITU_Store_1.0.2.apk'",
        'Open MUSITU instantly in your browser.',
        'Browser-first verified MUSITU software distribution.',
        'href="/store/open">Open app</a>',
        "case '/store/open': r=Response.redirect(CATALOG.apps[0].releases[0].web.appURL,302);",
    )
    for token in live_only_tokens:
        if token not in worker:
            raise RuntimeError(f"current production behavior missing before patch: {token}")

    worker=replace_once(worker,INSTALL_CONTROLLER_OLD,INSTALL_CONTROLLER_NEW,'install controller')
    worker=replace_once(worker,INSTALL_SHELL_OLD,INSTALL_SHELL_NEW,'install surface transform')
    worker_path.write_text(worker,encoding='utf-8')

    final_worker=worker_path.read_text(encoding='utf-8')
    required=(
        'beforeinstallprompt',
        'data-musitu-install-target',
        '/chemistry/app/manifest.webmanifest',
        'function installControlButtons(',
        'function musituChemistryManifestActive()',
        'window.location.assign(target)',
        'window.location.assign(MUSITU_PWA_HELP)',
    )
    for token in (*live_only_tokens,*required):
        if token not in final_worker:
            raise RuntimeError(f"candidate missing required behavior: {token}")

    changed=[]
    for name in MODULES:
        before=(BASELINE/name).read_bytes(); after=(CANDIDATE/name).read_bytes()
        if before!=after: changed.append(name)
    if changed!=['worker.mjs']:
        raise RuntimeError(f"install-button fix must be worker-only, observed {changed}")

    candidate_worker_sha=sha256((CANDIDATE/'worker.mjs').read_bytes())
    if candidate_worker_sha!=EXPECTED_CANDIDATE_WORKER_SHA:
        raise RuntimeError(f"candidate worker hash drift: {candidate_worker_sha} != {EXPECTED_CANDIDATE_WORKER_SHA}")

    report={
        'schema':'musitu.store.install_button.live_candidate.v1',
        'result':'PASS_WORKER_ONLY_INSTALL_BUTTON_CANDIDATE',
        'changed_modules':changed,
        'protected_modules':['render.mjs','assets.mjs','generated-data.mjs'],
        'candidate_worker_sha256':candidate_worker_sha,
        'modules':{},
    }
    for name in MODULES:
        before=(BASELINE/name).read_bytes(); after=(CANDIDATE/name).read_bytes()
        report['modules'][name]={
            'baseline_sha256':sha256(before),
            'candidate_sha256':sha256(after),
            'baseline_bytes':len(before),
            'candidate_bytes':len(after),
            'changed':before!=after,
        }
    REPORT.parent.mkdir(parents=True,exist_ok=True)
    REPORT.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2,sort_keys=True))


if __name__=='__main__':
    main()
