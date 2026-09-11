#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys

MARKER = "const MACHINE_ENDPOINT_INFO={"
ANCHOR = "function releaseTruth(raw,type='application/json; charset=utf-8'){return response(raw,200,type,{'Cache-Control':'no-store'})}\n"

PRESENTATION_BLOCK = r'''const MACHINE_ENDPOINT_INFO={
  '/store/catalog.json':{title:'Verified MUSITU catalog',description:'Signed release catalog used by MUSITU Store clients and verification tools.',detail:'Catalog revision '+CATALOG.revision+' · '+CATALOG.apps[0].name+' '+CATALOG.apps[0].releases[0].version},
  '/store/catalog.sig':{title:'Catalog signature',description:'Detached signature used to verify that the release catalog has not been altered.',detail:'Verification data is intentionally machine-readable.'},
  '/store/ios/source.json':{title:'iOS SideStore source',description:'Machine-readable source feed used by supported iOS installation tooling.',detail:'SideStore and compatible clients can continue to fetch this URL directly.'},
  '/store/web/adapter.json':{title:'Web adapter metadata',description:'Machine-readable metadata for the MUSITU browser and PWA carrier.',detail:'This endpoint is intended for software integration.'},
  '/store/android/repo/index-v1.json':{title:'Android repository index',description:'Machine-readable Android repository metadata for compatible installers.',detail:'Android repository clients continue to receive the original JSON bytes.'},
  '/store/apps/chemistry/sbom.json':{title:'Chemistry software bill of materials',description:'Machine-readable component inventory for MUSITU Chemistry.',detail:'Use the raw endpoint for automated SBOM processing.'},
  '/store/apps/chemistry/dependencies.json':{title:'Chemistry dependency manifest',description:'Machine-readable dependency and provenance information for MUSITU Chemistry.',detail:'Use the raw endpoint for automated dependency verification.'},
  '/store/release/channels.json':{title:'Release channels',description:'Machine-readable stable, beta, canary and emergency channel state.',detail:'Release automation continues to receive the original JSON bytes.'},
  '/store/release/rollback-control.json':{title:'Rollback control',description:'Machine-readable signed rollback policy and authorization state.',detail:'Rollback remains fail-closed; this browser view does not change release policy.'},
  '/store/bootstrap/release.json':{title:'Store bootstrap release',description:'Machine-readable MUSITU Store bootstrap identity and integrity metadata.',detail:'Installers continue to receive the original JSON bytes.'},
  '/store/locales.json':{title:'Supported Store languages',description:'Machine-readable locale support metadata for MUSITU Store.',detail:'Language-aware clients continue to receive the original JSON bytes.'}
};
function machineEsc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function wantsHumanMachinePage(request,u){
  const raw=(u.searchParams.get('raw')||'').toLowerCase();
  if(raw==='1'||raw==='true') return false;
  if(request.method!=='GET') return false;
  const accept=(request.headers.get('accept')||'').toLowerCase();
  const mode=(request.headers.get('sec-fetch-mode')||'').toLowerCase();
  const dest=(request.headers.get('sec-fetch-dest')||'').toLowerCase();
  return mode==='navigate'||dest==='document'||accept.includes('text/html');
}
function machineRawResponse(raw,type,mode){
  const cache=mode==='release'?'no-store':'public, max-age=300';
  return response(raw,200,type,{'Cache-Control':cache,'Vary':'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest'});
}
function machineDataResponse(request,u,raw,type='application/json; charset=utf-8',mode='exact'){
  if(!wantsHumanMachinePage(request,u)) return machineRawResponse(raw,type,mode);
  const info=MACHINE_ENDPOINT_INFO[u.pathname]||{title:'Machine-readable Store data',description:'This endpoint is intended for MUSITU software and verification tools.',detail:'The original machine-readable representation remains available.'};
  const rawHref=u.pathname+'?raw=1';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${machineEsc(info.title)} · MUSITU Store</title><meta name="description" content="Readable browser view for a MUSITU Store machine endpoint."><link rel="stylesheet" href="/store/assets/store.css"></head><body><a class="skip-link" href="#main">Skip to main content</a><main id="main" tabindex="-1" class="page"><div class="wrap"><div class="breadcrumbs"><a href="/store">MUSITU Store</a> / Developer data</div><span class="eyebrow">Machine-readable endpoint</span><h1>${machineEsc(info.title)}</h1><p class="lead">${machineEsc(info.description)}</p><div class="notice"><strong>Readable browser view.</strong> MUSITU clients still receive the original machine-readable data. Raw code is hidden during normal browser navigation so customers are not dropped into an implementation payload.</div><section class="section"><div class="panel"><p><strong>Endpoint</strong> <code>${machineEsc(u.pathname)}</code></p><p><strong>Media type</strong> <code>${machineEsc(type.split(';')[0])}</code></p><p>${machineEsc(info.detail)}</p></div></section><div class="actions"><a class="button" href="/store">Back to MUSITU Store</a><a class="button secondary" href="${machineEsc(rawHref)}">Open raw data</a></div></div></main></body></html>`;
  return htmlResponse(request,html,localeFor(request),{'Cache-Control':'no-store','Vary':'Accept, Sec-Fetch-Mode, Sec-Fetch-Dest, Save-Data, Accept-Language'});
}
'''

REPLACEMENTS = {
    "case '/store/catalog.json': r=releaseTruth(CATALOG_RAW); break;": "case '/store/catalog.json': r=machineDataResponse(request,u,CATALOG_RAW,'application/json; charset=utf-8','release'); break;",
    "case '/store/catalog.sig': r=releaseTruth(CATALOG_SIG_RAW,'text/plain; charset=utf-8'); break;": "case '/store/catalog.sig': r=machineDataResponse(request,u,CATALOG_SIG_RAW,'text/plain; charset=utf-8','release'); break;",
    "case '/store/ios/source.json': r=exact(IOS_SOURCE_RAW); break;": "case '/store/ios/source.json': r=machineDataResponse(request,u,IOS_SOURCE_RAW); break;",
    "case '/store/web/adapter.json': r=exact(WEB_ADAPTER_RAW); break;": "case '/store/web/adapter.json': r=machineDataResponse(request,u,WEB_ADAPTER_RAW); break;",
    "case '/store/android/repo/index-v1.json': r=exact(FDROID_INDEX_RAW); break;": "case '/store/android/repo/index-v1.json': r=machineDataResponse(request,u,FDROID_INDEX_RAW); break;",
    "case '/store/apps/chemistry/sbom.json': r=exact(SBOM_RAW); break;": "case '/store/apps/chemistry/sbom.json': r=machineDataResponse(request,u,SBOM_RAW); break;",
    "case '/store/apps/chemistry/dependencies.json': r=exact(DEPENDENCIES_RAW); break;": "case '/store/apps/chemistry/dependencies.json': r=machineDataResponse(request,u,DEPENDENCIES_RAW); break;",
    "case '/store/release/channels.json': r=exact(CHANNELS_RAW); break;": "case '/store/release/channels.json': r=machineDataResponse(request,u,CHANNELS_RAW); break;",
    "case '/store/release/rollback-control.json': r=exact(ROLLBACK_RAW); break;": "case '/store/release/rollback-control.json': r=machineDataResponse(request,u,ROLLBACK_RAW); break;",
    "case '/store/bootstrap/release.json': r=exact(BOOTSTRAP_RAW); break;": "case '/store/bootstrap/release.json': r=machineDataResponse(request,u,BOOTSTRAP_RAW); break;",
    "case '/store/locales.json': r=exact(JSON.stringify(LOCALES)+'\\n'); break;": "case '/store/locales.json': r=machineDataResponse(request,u,JSON.stringify(LOCALES)+'\\n'); break;",
}


def transform_text(text: str) -> str:
    if MARKER not in text:
        if text.count(ANCHOR) != 1:
            raise ValueError(f"expected exactly one machine presentation anchor, found {text.count(ANCHOR)}")
        text = text.replace(ANCHOR, ANCHOR + PRESENTATION_BLOCK, 1)
        for old, new in REPLACEMENTS.items():
            if text.count(old) != 1:
                raise ValueError(f"expected exactly one machine route before transform: {old}")
            text = text.replace(old, new, 1)
    else:
        for new in REPLACEMENTS.values():
            if new not in text:
                raise ValueError(f"presentation marker exists but transformed route is missing: {new}")
    return text


def apply_to_worker(worker: Path) -> None:
    text = worker.read_text(encoding="utf-8")
    transformed = transform_text(text)
    worker.write_text(transformed, encoding="utf-8")
    post = worker.read_text(encoding="utf-8")
    required = [MARKER, "wantsHumanMachinePage", "machineDataResponse", "Readable browser view.", "?raw=1"]
    for token in required:
        if token not in post:
            raise ValueError(f"browser machine presentation token missing after transform: {token}")
    for old in REPLACEMENTS:
        if old in post:
            raise ValueError(f"raw browser route survived presentation transform: {old}")


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("store/phase1/web-surface/worker.mjs")
    apply_to_worker(path)
    print("MUSITU_STORE_BROWSER_MACHINE_PRESENTATION_APPLIED")
