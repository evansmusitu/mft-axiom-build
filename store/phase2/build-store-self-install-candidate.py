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
REPORT=Path(os.environ.get("STORE_SELF_INSTALL_BUILD_REPORT","/tmp/musitu-store-self-install-candidate.json"))

EXPECTED_BASELINE={
    "assets.mjs":os.environ.get("EXPECTED_BROWSER_FIRST_ASSETS_SHA","443e558c297d700bedc706ea56647c97162709e5178b80acd63d478054bba4b4"),
    "generated-data.mjs":os.environ.get("EXPECTED_BROWSER_FIRST_GENERATED_DATA_SHA","27ab78a914019cb44844de51bd0f4be46dc53bdf4b928a8dff7944228ccce063"),
    "render.mjs":os.environ.get("EXPECTED_BROWSER_FIRST_RENDER_SHA","d4d0b6aef8b1a8d887449c7be60c75190123e7fbb3183e4faf42d10f69be492c"),
    "worker.mjs":os.environ.get("EXPECTED_INSTALL_BUTTON_WORKER_SHA","60fcba26dc4d104c6bb9cb0567c66c8e98d38b217c89217b89625947b9062782"),
}
EXPECTED_CANDIDATE=os.environ.get("EXPECTED_STORE_SELF_INSTALL_WORKER_SHA","").strip()

STORE_JS_OLD="""const STORE_JS=String.raw`'use strict';
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

STORE_JS_NEW="""const STORE_JS=String.raw`'use strict';
const MUSITU_PWA_INSTALL='https://payments.mftintelligence.com/chemistry/install';
const MUSITU_PWA_HELP='https://payments.mftintelligence.com/chemistry/app/#help';
const MUSITU_STORE_MANIFEST='/store/manifest.webmanifest';
let musituInstallPrompt=null;

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  musituInstallPrompt=event;
});
window.addEventListener('appinstalled',()=>{musituInstallPrompt=null;});

function musituManifestPath(){
  const manifest=document.querySelector('link[rel="manifest"]');
  if(!manifest) return '';
  try{return new URL(manifest.getAttribute('href')||'',location.href).pathname;}
  catch{return '';}
}
function musituChemistryManifestActive(){return musituManifestPath()==='/chemistry/app/manifest.webmanifest';}
function musituStoreManifestActive(){return musituManifestPath()===MUSITU_STORE_MANIFEST;}
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
async function musituInstallStorePwa(){
  if(musituStoreManifestActive() && musituInstallPrompt){
    const prompt=musituInstallPrompt;
    musituInstallPrompt=null;
    await prompt.prompt();
    return;
  }
  const help=document.getElementById('musitu-store-pwa-help');
  if(help){help.hidden=false;help.focus({preventScroll:false});}
}
function musituStoreBootstrapTarget(target){
  return /^\\/store\\/bootstrap\\/MUSITU_Store_[A-Za-z0-9._-]+\\.apk$/.test(target);
}
function musituActivateStoreBootstrap(target){
  if(!musituStoreBootstrapTarget(target)) return;
  const resolved=new URL(target,location.origin);
  if(resolved.origin!==location.origin) return;
  window.location.assign(resolved.href);
}
function musituBindInstallControl(control){
  const target=control.getAttribute('data-musitu-install-target')||'';
  if(!target) return;
  control.addEventListener('click',event=>{
    event.preventDefault();
    void musituActivateInstall(target);
  });
}
function musituBindStoreBootstrap(control){
  const target=control.getAttribute('data-musitu-store-bootstrap-target')||'';
  if(!musituStoreBootstrapTarget(target)) return;
  control.addEventListener('click',event=>{
    event.preventDefault();
    musituActivateStoreBootstrap(target);
  });
}
window.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-musitu-install-target]').forEach(musituBindInstallControl);
  document.querySelectorAll('[data-musitu-store-bootstrap-target]').forEach(musituBindStoreBootstrap);
  document.querySelectorAll('[data-musitu-store-pwa-install]').forEach(control=>control.addEventListener('click',event=>{
    event.preventDefault();
    void musituInstallStorePwa();
  }));
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/store/sw.js',{scope:'/store/'}).catch(()=>{});
  });
}
`;"""

INSTALL_BUTTONS_OLD="""function installControlButtons(html){
  const carrier=/(?:intent:\/\/app\/chemistry[^\"]*|sidestore:\/\/install\?[^\"]*|https:\/\/payments\.mftintelligence\.com\/chemistry\/install)/;
  return html.replace(/<a class=\"([^\"]+)\" href=\"([^\"]+)\">([\\s\\S]*?)<\\/a>/g,(whole,klass,target,label)=>carrier.test(target)?`<button type=\"button\" class=\"${klass}\" data-musitu-install-target=\"${escapeInstallTarget(target)}\">${label}</button>`:whole);
}"""
INSTALL_BUTTONS_NEW="""function installControlButtons(html){
  const carrier=/(?:intent:\/\/app\/chemistry[^\"]*|sidestore:\/\/install\?[^\"]*|https:\/\/payments\.mftintelligence\.com\/chemistry\/install)/;
  const bootstrap=/^\\/store\\/bootstrap\\/MUSITU_Store_[A-Za-z0-9._-]+\\.apk$/;
  return html.replace(/<a class=\"([^\"]+)\" href=\"([^\"]+)\">([\\s\\S]*?)<\\/a>/g,(whole,klass,target,label)=>{
    if(carrier.test(target)) return `<button type=\"button\" class=\"${klass}\" data-musitu-install-target=\"${escapeInstallTarget(target)}\">${label}</button>`;
    if(bootstrap.test(target)) return `<button type=\"button\" class=\"${klass}\" data-musitu-store-bootstrap-target=\"${escapeInstallTarget(target)}\">${label}</button>`;
    return whole;
  });
}"""

SELF_INSTALL_FUNCTION="""
function storeSelfInstallEsc(value){return String(value).replace(/[&\"<>]/g,c=>({'&':'&amp;','\"':'&quot;','<':'&lt;','>':'&gt;'}[c]))}
function storeSelfInstallPage(request){
  let bootstrap={};
  try{bootstrap=JSON.parse(BOOTSTRAP_RAW);}catch{}
  const artifact=String(bootstrap.artifactFile||'MUSITU_Store_1.0.2.apk');
  const target='/store/bootstrap/'+artifact;
  const hash=String(bootstrap.sha256||'');
  const cert=String(bootstrap.signingCertificateSha256||'');
  const html=`<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Install MUSITU Store</title><meta name=\"description\" content=\"Install MUSITU Store as a browser app or use the signed native Android bootstrap.\"><link rel=\"stylesheet\" href=\"/store/assets/store.css\"></head><body><a class=\"skip-link\" href=\"#main\">Skip to main content</a><main id=\"main\" tabindex=\"-1\" class=\"page\"><div class=\"wrap\"><div class=\"breadcrumbs\"><a href=\"/store\">MUSITU Store</a> / Install Store</div><h1>Install MUSITU Store</h1><p class=\"lead\">Use the browser-approved Store app install when available. For native Android package-management features, use the signed one-time native bootstrap; Android still shows its mandatory installer approval.</p><div class=\"actions\"><button type=\"button\" class=\"button\" data-musitu-store-pwa-install>Install MUSITU Store Web App</button><button type=\"button\" class=\"button secondary\" data-musitu-store-bootstrap-target=\"${storeSelfInstallEsc(target)}\">Install native MUSITU Store</button><a class=\"button tertiary\" href=\"/store\">Open Store in browser</a></div><p id=\"musitu-store-pwa-help\" class=\"notice\" tabindex=\"-1\" hidden>If your browser does not expose an install prompt, use its Install app or Add to Home screen command. No APK is required for the Web App path.</p><p class=\"micro\">The native bootstrap is a one-time Android sideload path. The package file is not exposed as a clickable URL on this page; Android requires local package acquisition before its system installer can approve a native install.</p><div class=\"hash\">Bootstrap SHA-256 ${storeSelfInstallEsc(hash)}</div><div class=\"hash\">Store signing certificate ${storeSelfInstallEsc(cert)}</div></div></main></body></html>`;
  return htmlResponse(request,html);
}
"""

ROUTE_OLD="""    case '/store': case '/store/': r=homeResponse(request); break;
    case '/store/apps/chemistry': r=htmlResponse(request,renderApp(request)); break;
    case '/store/install': r=htmlResponse(request,renderInstall(request)); break;"""
ROUTE_NEW="""    case '/store': case '/store/': r=homeResponse(request); break;
    case '/store/apps/chemistry': r=htmlResponse(request,renderApp(request)); break;
    case '/store/self-install': r=storeSelfInstallPage(request); break;
    case '/store/install': r=htmlResponse(request,renderInstall(request)); break;"""


def sha256(raw:bytes)->str:
    return hashlib.sha256(raw).hexdigest()


def replace_once(text:str,old:str,new:str,label:str)->str:
    count=text.count(old)
    if count!=1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, observed {count}")
    return text.replace(old,new,1)


def main()->None:
    for name,expected in EXPECTED_BASELINE.items():
        path=BASELINE/name
        if not path.is_file(): raise RuntimeError(f"missing live baseline module: {name}")
        observed=sha256(path.read_bytes())
        if observed!=expected: raise RuntimeError(f"baseline {name} hash mismatch: {observed} != {expected}")

    if CANDIDATE.exists(): shutil.rmtree(CANDIDATE)
    CANDIDATE.mkdir(parents=True)
    for name in MODULES: shutil.copyfile(BASELINE/name,CANDIDATE/name)

    path=CANDIDATE/'worker.mjs'
    worker=path.read_text(encoding='utf-8')
    for token in ("'/store/bootstrap/MUSITU_Store_1.0.2.apk'",'data-musitu-install-target','/chemistry/app/manifest.webmanifest',"case '/store/open': r=Response.redirect(CATALOG.apps[0].releases[0].web.appURL,302);"):
        if token not in worker: raise RuntimeError(f"current live behavior missing: {token}")

    worker=replace_once(worker,STORE_JS_OLD,STORE_JS_NEW,'Store JS controller')
    worker=replace_once(worker,INSTALL_BUTTONS_OLD,INSTALL_BUTTONS_NEW,'install button transformer')
    worker=replace_once(worker,'\nexport default {async fetch(request,env){',SELF_INSTALL_FUNCTION+'\nexport default {async fetch(request,env){','Store self-install page insertion')
    worker=replace_once(worker,ROUTE_OLD,ROUTE_NEW,'Store self-install route')
    path.write_text(worker,encoding='utf-8')

    required=(
        "case '/store/self-install': r=storeSelfInstallPage(request); break;",
        'data-musitu-store-pwa-install','data-musitu-store-bootstrap-target',
        'function musituInstallStorePwa()','function musituActivateStoreBootstrap(target)',
        'function storeSelfInstallPage(request)','MUSITU_STORE_MANIFEST',
        'beforeinstallprompt','data-musitu-install-target','/chemistry/app/manifest.webmanifest',
        "case '/store/open': r=Response.redirect(CATALOG.apps[0].releases[0].web.appURL,302);",
    )
    final=path.read_text(encoding='utf-8')
    for token in required:
        if token not in final: raise RuntimeError(f"candidate missing required behavior: {token}")

    changed=[name for name in MODULES if (BASELINE/name).read_bytes()!=(CANDIDATE/name).read_bytes()]
    if changed!=['worker.mjs']: raise RuntimeError(f"Store self-install candidate must be worker-only, observed {changed}")
    candidate_sha=sha256(path.read_bytes())
    if EXPECTED_CANDIDATE and candidate_sha!=EXPECTED_CANDIDATE:
        raise RuntimeError(f"candidate worker hash drift: {candidate_sha} != {EXPECTED_CANDIDATE}")

    report={
        'schema':'musitu.store.self_install.candidate.v1',
        'result':'PASS_WORKER_ONLY_STORE_SELF_INSTALL_CANDIDATE',
        'candidate_worker_sha256':candidate_sha,
        'changed_modules':changed,
        'protected_modules':['render.mjs','assets.mjs','generated-data.mjs'],
        'baseline_modules':{n:sha256((BASELINE/n).read_bytes()) for n in MODULES},
        'candidate_modules':{n:sha256((CANDIDATE/n).read_bytes()) for n in MODULES},
    }
    REPORT.parent.mkdir(parents=True,exist_ok=True)
    REPORT.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2,sort_keys=True))

if __name__=='__main__': main()
