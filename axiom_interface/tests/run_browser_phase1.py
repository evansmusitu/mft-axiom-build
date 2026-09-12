from __future__ import annotations

import contextlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "tests" / "visual_layout_baseline.json"
ARTIFACT_DIR = Path(os.environ.get("AXIOM_BROWSER_ARTIFACT_DIR", "/tmp/axiom-interface-phase1"))
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass


def rounded_box(locator):
    box = locator.bounding_box()
    if box is None:
        return None
    return {k: round(v, 1) for k, v in box.items()}


def snapshot(page, width: int, height: int):
    page.set_viewport_size({"width": width, "height": height})
    page.wait_for_timeout(80)
    values = {"viewport": [width, height]}
    selectors = {
        "shell": ".app-shell",
        "global": ".global-rail",
        "project": ".project-rail",
        "main": "#main-workspace",
        "proof": "#proof-drawer",
        "composer": "#composer",
    }
    for key, selector in selectors.items():
        loc = page.locator(selector)
        displayed = loc.is_visible()
        box = rounded_box(loc) if displayed else None
        in_viewport = False if box is None else (box['x'] < width and box['x'] + box['width'] > 0 and box['y'] < height and box['y'] + box['height'] > 0)
        values[key] = {"displayed": displayed, "in_viewport": in_viewport, "box": box}
    values["body_style"] = page.evaluate("""() => { const s=getComputedStyle(document.body); return {backgroundColor:s.backgroundColor,color:s.color,fontFamily:s.fontFamily}; }""")
    return values


def main() -> None:
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/index.html#/home"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
            requests: list[str] = []
            page = context.new_page()
            page.on("request", lambda req: requests.append(req.url))
            page.goto(url, wait_until="networkidle")

            # Accessible landmarks and names.
            assert page.get_by_role("navigation", name="Global").is_visible()
            assert page.get_by_role("navigation", name="Project").is_visible()
            assert page.get_by_role("complementary", name="Proof Drawer").is_visible()
            assert page.get_by_role("form", name="Universal composer").is_visible()
            assert page.locator(".skip-link").get_attribute("href") == "#main-workspace"

            # Keyboard-only path and tab semantics.
            page.keyboard.press("Control+K")
            assert page.locator("#composer-input").evaluate("el => el === document.activeElement")
            page.locator("#tab-sources").focus()
            page.keyboard.press("ArrowRight")
            assert page.locator("#tab-claims").get_attribute("aria-selected") == "true"
            assert page.locator("#panel-claims").is_visible()

            # Composer creates preview, never action.
            page.locator("#composer-input").fill("Prepare an evidence-linked product brief")
            page.get_by_role("button", name="Build").click()
            page.get_by_role("button", name="Preview plan").click()
            assert page.get_by_text("Not executed", exact=True).is_visible()
            assert "No consequential tool or external system has been invoked" in page.locator("#run-preview").inner_text()
            assert len(page.evaluate("window.AxiomUI.getTrace()")) > 0

            # Reliability/recovery surface verifies every required field structurally.
            page.evaluate("""window.AxiomUI.reportError({errorId:'AXIOM-TEST-500',component:'Research',impact:'Preview paused',succeeded:'Draft preserved',failed:'Source refresh',dataLost:'No',retryState:'Safe',recovery:'Retry source refresh',supportTrace:'#proof-drawer'})""")
            error = page.locator("#error-region")
            assert error.is_visible()
            assert error.locator("h3").inner_text() == "AXIOM-TEST-500 · Research"
            observed_fields = error.locator(".error-grid > div").evaluate_all("""nodes => Object.fromEntries(nodes.map(node => [node.querySelector('strong').textContent.trim(), node.querySelector('span').textContent.trim()]))""")
            expected_fields = {
                "Impact": "Preview paused",
                "What succeeded": "Draft preserved",
                "What failed": "Source refresh",
                "Data lost": "No",
                "Retry state": "Safe",
                "Recovery": "Retry source refresh",
            }
            assert observed_fields == expected_fields, {"expected": expected_fields, "observed": observed_fields}
            error.get_by_role("button", name="Retry").click()
            assert error.is_hidden()

            # Offline/recovery state remains understandable without color.
            context.set_offline(True)
            page.wait_for_timeout(80)
            assert "Offline:" in page.locator("#network-banner").inner_text()
            context.set_offline(False)
            page.wait_for_timeout(80)

            desktop = snapshot(page, 1440, 1000)
            page.screenshot(path=str(ARTIFACT_DIR / "desktop.png"), full_page=True)
            tablet = snapshot(page, 1024, 900)
            page.screenshot(path=str(ARTIFACT_DIR / "tablet.png"), full_page=True)
            mobile = snapshot(page, 390, 844)
            assert mobile["project"]["displayed"] is False
            assert mobile["global"]["in_viewport"] is True
            assert mobile["proof"]["in_viewport"] is False
            page.get_by_role("button", name="Proof").click()
            assert page.get_by_role("complementary", name="Proof Drawer").is_visible()
            page.screenshot(path=str(ARTIFACT_DIR / "mobile.png"), full_page=True)

            page.evaluate("document.documentElement.dataset.theme='high-contrast'")
            assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()") == "#000"
            page.screenshot(path=str(ARTIFACT_DIR / "high-contrast.png"), full_page=True)

            # Same-origin resource boundary: no third-party runtime calls.
            foreign = [r for r in requests if not r.startswith(f"http://127.0.0.1:{server.server_port}/")]
            assert not foreign, foreign

            observed = {"schema":"musitu.axiom.interface.visual-layout.v1","desktop":desktop,"tablet":tablet,"mobile":mobile}
            baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
            assert baseline["schema"] == "musitu.axiom.interface.visual-layout-baseline.v1"
            for name in ("desktop", "tablet", "mobile"):
                expected = baseline[name]
                actual = observed[name]
                for region, expected_state in expected["regions"].items():
                    for field, expected_value in expected_state.items():
                        assert actual[region][field] == expected_value, (name, region, field, expected_value, actual[region][field])
            d = observed["desktop"]
            assert d["global"]["box"]["x"] < d["project"]["box"]["x"] < d["main"]["box"]["x"] < d["proof"]["box"]["x"]
            assert d["main"]["box"]["width"] >= baseline["desktop"]["min_main_width"]
            t = observed["tablet"]
            assert t["main"]["box"]["width"] >= baseline["tablet"]["min_main_width"]
            m = observed["mobile"]
            assert m["main"]["box"]["width"] >= baseline["mobile"]["min_main_width"]

            # Persist machine-readable browser evidence.
            (ARTIFACT_DIR / "browser-evidence.json").write_text(json.dumps({
                "schema":"musitu.axiom.interface.phase1-browser-evidence.v1",
                "status":"PASS",
                "same_origin_requests":len(requests),
                "foreign_requests":foreign,
                "visual_layout":observed,
                "screenshots":["desktop.png","tablet.png","mobile.png","high-contrast.png"],
                "private_chain_of_thought_exposed":False,
                "consequential_action_executed":False
            }, indent=2, sort_keys=True)+"\n", encoding="utf-8")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_INTERFACE_PHASE1_BROWSER_PASS")


if __name__ == "__main__":
    main()
