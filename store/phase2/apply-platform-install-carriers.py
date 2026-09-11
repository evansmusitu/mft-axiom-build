#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply-platform-install-carriers.py <live-worker.mjs>")
    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        "import {renderHome,renderApp,renderInstall,renderSearch,renderDeveloper,renderReleases,renderStatus,renderLifecycle} from './render.mjs';",
        "import {renderHome,renderApp,renderInstall,renderSearch,renderDeveloper,renderReleases,renderStatus,renderLifecycle,primaryInstallHref} from './render.mjs';",
        "render import",
    )
    text = replace_once(text, "function liteHome(lang){", "function liteHome(lang,request){", "liteHome signature")
    text = replace_once(
        text,
        '<a class="button" href="/store/install">Install</a><a class="button secondary" href="/store/apps/chemistry">Details</a>',
        '<a class="button" href="${primaryInstallHref(request,\'install\')}">Install</a><a class="button secondary" href="/store/apps/chemistry">Details</a>',
        "liteHome install button",
    )
    text = replace_once(text, "liteHome(lang),lang", "liteHome(lang,request),lang", "liteHome call")
    text = replace_once(text, "renderApp())", "renderApp(request))", "app request context")
    text = replace_once(text, "renderLifecycle('update'))", "renderLifecycle(request,'update'))", "update request context")
    text = replace_once(text, "renderLifecycle('repair'))", "renderLifecycle(request,'repair'))", "repair request context")
    text = replace_once(text, "renderLifecycle('reinstall'))", "renderLifecycle(request,'reinstall'))", "reinstall request context")
    text = replace_once(text, "renderLifecycle('rollback'))", "renderLifecycle(request,'rollback'))", "rollback request context")
    text = replace_once(text, "renderLifecycle('transfer-device'))", "renderLifecycle(request,'transfer-device'))", "transfer request context")
    text = replace_once(
        text,
        "renderSearch(u.searchParams.get('q')||''))",
        "renderSearch(request,u.searchParams.get('q')||''))",
        "search request context",
    )

    required = (
        "primaryInstallHref",
        "renderApp(request)",
        "renderLifecycle(request,'update')",
        "renderLifecycle(request,'repair')",
        "renderLifecycle(request,'reinstall')",
        "renderSearch(request,u.searchParams.get('q')||'')",
        "liteHome(lang,request)",
    )
    for token in required:
        if token not in text:
            raise SystemExit(f"post-transform invariant missing: {token}")

    path.write_text(text, encoding="utf-8")
    print("MUSITU_STORE_PLATFORM_CARRIER_WORKER_TRANSFORM=PASS")


if __name__ == "__main__":
    main()
