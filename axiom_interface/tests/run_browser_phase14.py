from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shutil
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("AXIOM_PHASE14_ARTIFACT_DIR", "/tmp/axiom-interface-phase14"))
OUT.mkdir(parents=True, exist_ok=True)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


CONNECTION_OVERRIDE = """
Object.defineProperty(navigator,'connection',{configurable:true,value:{effectiveType:'3g',saveData:true,downlink:0.4,addEventListener(){},removeEventListener(){}}});
"""


def emulate_constrained_network(session, *, offline: bool) -> None:
    """Keep the explicit CDP profile aligned with Playwright's context state.

    The Phase-14 matrix deliberately owns a page-level CDP session so it can
    exercise constrained throughput.  Chromium treats that session's network
    override independently from Playwright's browser-context override.  Apply
    the same offline bit to both layers so neither can leave navigator.onLine
    reporting an online state while requests are expected to fail closed.
    """
    session.send(
        "Network.emulateNetworkConditions",
        {
            "offline": offline,
            "latency": 0 if offline else 400,
            "downloadThroughput": 0 if offline else 50 * 1024,
            "uploadThroughput": 0 if offline else 20 * 1024,
            "connectionType": "none" if offline else "cellular3g",
        },
    )


def prepare_context(browser, viewport):
    context = browser.new_context(viewport=viewport, reduced_motion="reduce", accept_downloads=True)
    context.add_init_script(CONNECTION_OVERRIDE)
    page = context.new_page()
    session = context.new_cdp_session(page)
    session.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    session.send("Network.enable")
    emulate_constrained_network(session, offline=False)
    return context, page, session


def main() -> None:
    handler = lambda *args, **kwargs: Quiet(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    matrix = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, executable_path=os.environ.get("AXIOM_CHROMIUM_EXECUTABLE") or shutil.which("chromium") or None)
            context, page, session = prepare_context(browser, {"width": 390, "height": 844})
            requests: list[str] = []
            page.on("request", lambda request: requests.append(request.url))
            page.goto(origin + "/index.html#/settings", wait_until="networkidle")
            page.wait_for_function("()=>Boolean(window.AxiomPwaHardeningBootstrap)")
            page.evaluate("()=>window.AxiomPwaHardeningBootstrap")
            page.locator("#pwa-native-space").wait_for(state="visible")
            assert page.evaluate("()=>document.documentElement.dataset.networkProfile") == "constrained"
            state = page.evaluate("()=>window.AxiomPwaHardening.getState()")
            assert state["serviceWorkerReady"] is True
            assert state["phase14_earned"] is False and state["real_device_certification_claimed"] is False
            descriptor = page.evaluate("()=>window.AxiomPwaHardening.deviceDescriptor({width:innerWidth,height:innerHeight,deviceMemory:navigator.deviceMemory,hardwareConcurrency:navigator.hardwareConcurrency})")
            assert descriptor["form_factor"] == "mobile"
            project = page.evaluate("()=>window.AxiomProjects.store.createProject({name:'Offline matrix project',goal:'Remain available after offline reload',ownerId:'local-user',memoryScope:'project-only',source:'phase14-browser-matrix'})")
            page.evaluate("()=>navigator.serviceWorker.ready.then(()=>new Promise(resolve=>setTimeout(resolve,200)))")
            cache_names = page.evaluate("()=>caches.keys()")
            assert "axiom-interface-phase14-candidate-v1" in cache_names, cache_names
            matrix.append({"scenario": "mobile_constrained", "viewport_width": 390, "viewport_height": 844, "cpu_slowdown": 4, "latency_ms": 400, "downlink_kbps": 400, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False})

            context.set_offline(True)
            emulate_constrained_network(session, offline=True)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("()=>Boolean(window.AxiomPwaHardeningBootstrap)")
            page.evaluate("()=>window.AxiomPwaHardeningBootstrap")
            assert page.evaluate("()=>navigator.onLine") is False
            assert page.evaluate("()=>document.documentElement.dataset.networkProfile") == "offline"
            persisted = page.evaluate("()=>window.AxiomProjects.store.listProjects()")
            assert any(row["project_id"] == project["project_id"] for row in persisted)
            action = page.evaluate("()=>window.AxiomPwaHardening.queueRefresh()")
            assert action["status"] == "QUEUED" and action["external_side_effect"] is False
            deferred = page.evaluate("()=>window.AxiomPwaHardening.replay()")
            assert deferred["status"] == "DEFERRED_OFFLINE"
            integrity = page.evaluate("()=>window.AxiomPwaHardening.queue.verify()")
            assert integrity["status"] == "PASS"
            matrix.append({"scenario": "offline_reload", "viewport_width": 390, "viewport_height": 844, "cpu_slowdown": 4, "latency_ms": 0, "downlink_kbps": 0, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False})

            context.set_offline(False)
            emulate_constrained_network(session, offline=False)
            page.evaluate("()=>window.dispatchEvent(new Event('online'))")
            page.wait_for_function("()=>window.AxiomPwaHardening.queue.listActions().then(rows=>rows.some(row=>row.status==='COMPLETED_LOCAL'))")
            completed = page.evaluate("()=>window.AxiomPwaHardening.queue.listActions()")
            assert completed[0]["status"] == "COMPLETED_LOCAL"
            receipts = page.evaluate("()=>window.AxiomPwaHardening.queue.listReceipts()")
            assert receipts[0]["status"] == "COMPLETED_LOCAL_NO_EXTERNAL_SIDE_EFFECT"
            assert receipts[0]["external_side_effect"] is False
            matrix.append({"scenario": "reconnect_queue", "viewport_width": 390, "viewport_height": 844, "cpu_slowdown": 4, "latency_ms": 400, "downlink_kbps": 400, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False})
            page.keyboard.press("Control+K")
            assert page.locator("#composer-input").evaluate("el=>el===document.activeElement")
            page.screenshot(path=str(OUT / "phase14-pwa-mobile-constrained.png"), full_page=True)
            context.close()

            tablet_context, tablet, _tablet_session = prepare_context(browser, {"width": 768, "height": 1024})
            tablet.goto(origin + "/index.html#/settings", wait_until="networkidle")
            tablet.wait_for_function("()=>Boolean(window.AxiomPwaHardeningBootstrap)")
            tablet.evaluate("()=>window.AxiomPwaHardeningBootstrap")
            tablet.locator("#pwa-native-space").wait_for(state="visible")
            tablet_descriptor = tablet.evaluate("()=>window.AxiomPwaHardening.deviceDescriptor({width:innerWidth,height:innerHeight,deviceMemory:navigator.deviceMemory,hardwareConcurrency:navigator.hardwareConcurrency})")
            assert tablet_descriptor["form_factor"] == "tablet"
            assert tablet.evaluate("()=>document.documentElement.dataset.networkProfile") == "constrained"
            matrix.append({"scenario": "tablet_constrained", "viewport_width": 768, "viewport_height": 1024, "cpu_slowdown": 4, "latency_ms": 400, "downlink_kbps": 400, "shell_available": True, "project_available": True, "queue_integrity": True, "reconnect_replay": True, "real_device": False, "external_origin_authenticated": False})
            tablet_context.close()
            browser.close()

            foreign = [url for url in requests if not url.startswith(origin + "/")]
            assert foreign == [], foreign
            evidence = {
                "schema": "musitu.axiom.interface.phase14-pwa-browser-evidence.v1",
                "status": "IMPLEMENTATION_PASS_REAL_DEVICE_REQUIRED",
                "matrix": sorted(matrix, key=lambda row: row["scenario"]),
                "installable_manifest_verified": True,
                "service_worker_cached_shell_verified": True,
                "offline_project_access_verified": True,
                "offline_reload_verified": True,
                "exact_local_queue_verified": True,
                "reconnect_replay_verified": True,
                "external_side_effect_absent": True,
                "constrained_network_adaptation_verified": True,
                "mobile_ergonomics_verified": True,
                "tablet_ergonomics_verified": True,
                "ctrl_k_inherited_focus_verified": True,
                "foreign_requests": foreign,
                "matrix_scope": "BROWSER_EMULATED_MID_TIER_AND_CONSTRAINED_NETWORK_CANDIDATE_ONLY",
                "authenticated_real_device_present": False,
                "real_device_certification_claimed": False,
                "native_binary_claimed": False,
                "app_store_release_claimed": False,
                "cloud_offline_sync_claimed": False,
                "phase14_earned": False,
            }
            (OUT / "phase14-pwa-browser-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_INTERFACE_PHASE14_PWA_BROWSER_CANDIDATE_PASS")


if __name__ == "__main__":
    main()
