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
SOURCE_RENDER=Path(os.environ.get("BROWSER_FIRST_RENDER_SOURCE","store/phase1/web-surface/render.mjs"))
EXPECTED_RENDER_SOURCE_SHA=os.environ.get("EXPECTED_BROWSER_FIRST_RENDER_SHA","d4d0b6aef8b1a8d887449c7be60c75190123e7fbb3183e4faf42d10f69be492c")
REPORT=Path(os.environ.get("BROWSER_FIRST_BUILD_REPORT","/tmp/musitu-store-browser-first-candidate.json"))


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

    render_raw=SOURCE_RENDER.read_bytes()
    render_sha=sha256(render_raw)
    if render_sha!=EXPECTED_RENDER_SOURCE_SHA:
        raise RuntimeError(f"verified browser-first render drift: {render_sha} != {EXPECTED_RENDER_SOURCE_SHA}")

    if CANDIDATE.exists():
        shutil.rmtree(CANDIDATE)
    CANDIDATE.mkdir(parents=True)
    for name in MODULES:
        shutil.copyfile(BASELINE/name,CANDIDATE/name)

    # Production render.mjs is proven byte-identical to the sealed Store base.
    # Replace it with the already-tested browser-first renderer verbatim.
    (CANDIDATE/"render.mjs").write_bytes(render_raw)

    worker_path=CANDIDATE/"worker.mjs"
    worker=worker_path.read_text(encoding="utf-8")
    live_only_tokens=(
        "const MACHINE_ENDPOINT_INFO=",
        "function machineDataResponse(",
        "'/store/android/repo/index-v1.jar'",
        "'/store/bootstrap/MUSITU_Store_1.0.2.apk'",
    )
    for token in live_only_tokens:
        if token not in worker:
            raise RuntimeError(f"current live-only production behavior missing before patch: {token}")

    worker=replace_once(
        worker,
        "import {renderHome,renderApp,renderInstall,renderSearch,renderDeveloper,renderReleases,renderStatus,renderLifecycle,primaryInstallHref} from './render.mjs';",
        "import {renderHome,renderApp,renderInstall,renderSearch,renderDeveloper,renderReleases,renderStatus,renderLifecycle} from './render.mjs';",
        "worker renderer import",
    )
    worker=replace_once(
        worker,
        "const HOME_TITLE={en:'Install MUSITU with release truth you can verify.',sn:'Isa MUSITU nezvokwadi yekuburitswa yaunogona kuongorora.',nd:'Faka i-MUSITU ngeqiniso lokukhutshwa ongalihlola.'};",
        "const HOME_TITLE={en:'Open MUSITU instantly in your browser.',sn:'Vhura MUSITU pakarepo mubrowser yako.',nd:'Vula i-MUSITU khonokho kusiphequluli sakho.'};",
        "localized home title",
    )
    worker=replace_once(
        worker,
        "description:'Verified MUSITU software distribution.'",
        "description:'Browser-first verified MUSITU software distribution.'",
        "PWA manifest description",
    )
    worker=replace_once(
        worker,
        "<div class=\"actions\"><a class=\"button\" href=\"${primaryInstallHref(request,'install')}\">Install</a><a class=\"button secondary\" href=\"/store/apps/chemistry\">Details</a></div>",
        "<div class=\"actions\"><a class=\"button\" href=\"/store/open\">Open app</a><a class=\"button secondary\" href=\"/store/install\">Install options</a><a class=\"button tertiary\" href=\"/store/apps/chemistry\">Details</a></div>",
        "low-bandwidth primary action",
    )
    worker=replace_once(
        worker,
        "renderHome(request).replace('Install MUSITU with release truth you can verify.',HOME_TITLE[lang]||HOME_TITLE.en);",
        "renderHome(request).replace('Open MUSITU instantly in your browser.',HOME_TITLE[lang]||HOME_TITLE.en);",
        "localized rendered-home replacement",
    )
    worker_path.write_text(worker,encoding="utf-8")

    # Fail closed if the production-only browser presentation/release assets were lost.
    final_worker=worker_path.read_text(encoding="utf-8")
    for token in live_only_tokens:
        if token not in final_worker:
            raise RuntimeError(f"candidate lost current live-only production behavior: {token}")
    required_browser_first=(
        "Open MUSITU instantly in your browser.",
        "Browser-first verified MUSITU software distribution.",
        'href="/store/open">Open app</a>',
        'href="/store/install">Install options</a>',
        "case '/store/open': r=Response.redirect(CATALOG.apps[0].releases[0].web.appURL,302);",
    )
    for token in required_browser_first:
        if token not in final_worker:
            raise RuntimeError(f"candidate missing browser-first worker behavior: {token}")

    # Assets and signed/generated live metadata are deliberately not rebuilt or replaced.
    for name in ("assets.mjs","generated-data.mjs"):
        if (CANDIDATE/name).read_bytes()!=(BASELINE/name).read_bytes():
            raise RuntimeError(f"candidate changed protected live module: {name}")

    if (CANDIDATE/"render.mjs").read_bytes()==(BASELINE/"render.mjs").read_bytes():
        raise RuntimeError("candidate render.mjs did not change")
    if (CANDIDATE/"worker.mjs").read_bytes()==(BASELINE/"worker.mjs").read_bytes():
        raise RuntimeError("candidate worker.mjs did not change")

    report={
        "schema":"musitu.store.browser_first.live_candidate.v1",
        "result":"PASS_CANDIDATE_BUILT_FROM_EXACT_LIVE",
        "changed_modules":["render.mjs","worker.mjs"],
        "protected_modules":["assets.mjs","generated-data.mjs"],
        "modules":{},
        "preserved_live_only_tokens":list(live_only_tokens),
    }
    for name in MODULES:
        before=(BASELINE/name).read_bytes(); after=(CANDIDATE/name).read_bytes()
        report["modules"][name]={
            "baseline_sha256":sha256(before),
            "candidate_sha256":sha256(after),
            "baseline_bytes":len(before),
            "candidate_bytes":len(after),
            "changed":before!=after,
        }
    REPORT.parent.mkdir(parents=True,exist_ok=True)
    REPORT.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
