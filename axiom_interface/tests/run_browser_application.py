from __future__ import annotations

from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import threading
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("AXIOM_BROWSER_APPLICATION_ARTIFACT_DIR", "/tmp/axiom-browser-application"))
OUT.mkdir(parents=True, exist_ok=True)


class AppHandler(BaseHTTPRequestHandler):
    request_paths: list[str] = []

    def log_message(self, *_args) -> None:
        pass

    def _send(self, status: int, body: bytes, content_type: str, **headers: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Disposition", "inline")
        for name, value in headers.items():
            self.send_header(name.replace("_", "-"), value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        self.__class__.request_paths.append(path)
        if path == "/.well-known/axiom-session":
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            authenticated = cookies.get("axiom_session") and cookies["axiom_session"].value == "authenticated"
            if not authenticated:
                payload = {"schema": "musitu.axiom.browser-session.v1", "authenticated": False}
                self._send(HTTPStatus.UNAUTHORIZED, json.dumps(payload).encode(), "application/json", Cache_Control="no-store")
                return
            payload = {
                "schema": "musitu.axiom.browser-session.v1",
                "authenticated": True,
                "subject": "user-browser-test",
                "display_name": "Axiom Test User",
                "session_id": "session-browser-test",
                "assurance": "TEST_SAME_ORIGIN_COOKIE",
                "expires_at": "2099-01-01T00:00:00Z",
            }
            self._send(HTTPStatus.OK, json.dumps(payload).encode(), "application/json", Cache_Control="no-store")
            return
        relative = path.lstrip("/")
        if path in ("/", "/index.html"):
            relative = "index.html"
        candidate = (ROOT / relative).resolve()
        try:
            candidate.relative_to(ROOT.resolve())
        except ValueError:
            self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain")
            return
        if not candidate.is_file():
            self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain")
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix == ".webmanifest":
            content_type = "application/manifest+json"
        self._send(HTTPStatus.OK, candidate.read_bytes(), content_type, Cache_Control="no-cache")


def session_state(page) -> dict:
    page.wait_for_function("()=>Boolean(window.AxiomBrowserSessionReady)")
    return page.evaluate("()=>window.AxiomBrowserSessionReady.then(()=>window.AxiomBrowserSession.getState())")


def main() -> None:
    AppHandler.request_paths = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    downloads: list[str] = []
    foreign: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=os.environ.get("AXIOM_CHROMIUM_EXECUTABLE") or shutil.which("chromium") or None,
            )
            guest_context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce", accept_downloads=False)
            guest = guest_context.new_page()
            guest.on("download", lambda download: downloads.append(download.suggested_filename))
            guest.on("request", lambda request: foreign.append(request.url) if not request.url.startswith(origin + "/") else None)
            response = guest.goto(origin + "/", wait_until="domcontentloaded")
            assert response is not None and response.ok
            assert response.headers.get("content-disposition") == "inline"
            guest.wait_for_function("()=>Boolean(window.AxiomBrowserApplication)")
            assert guest.url == origin + "/#/home", guest.url
            assert guest.locator("#app-shell").is_visible()
            assert guest.get_by_role("form", name="Universal composer").is_visible()
            guest_state = session_state(guest)
            assert guest_state["mode"] == "GUEST_BROWSER_WORKSPACE"
            assert guest_state["authenticated"] is False
            assert guest.get_by_role("button", name="Account: Guest workspace").is_visible()

            guest.goto(origin + "/#/projects", wait_until="domcontentloaded")
            guest.wait_for_function("()=>document.querySelector('#workspace-title')?.textContent==='Projects'")
            assert guest.locator("#workspace-title").inner_text() == "Projects"
            guest.reload(wait_until="domcontentloaded")
            guest.wait_for_function("()=>document.querySelector('#workspace-title')?.textContent==='Projects'")
            assert guest.url == origin + "/#/projects"
            assert guest.locator("#workspace-title").inner_text() == "Projects"

            guest.goto(origin + "/index.html#/research", wait_until="domcontentloaded")
            guest.wait_for_function("()=>document.querySelector('#workspace-title')?.textContent==='Research'")
            assert guest.url == origin + "/#/research", guest.url
            assert guest.locator("#workspace-title").inner_text() == "Research"

            guest.goto(origin + "/#/settings", wait_until="domcontentloaded")
            guest.wait_for_function("()=>Boolean(window.AxiomPwaHardeningBootstrap)")
            guest.evaluate("()=>window.AxiomPwaHardeningBootstrap")
            guest.locator("#pwa-native-space").wait_for(state="visible")
            open_link = guest.locator("#pwa-open-browser")
            assert open_link.get_attribute("download") is None
            assert open_link.get_attribute("href") == "./#/home"
            assert guest.get_by_role("button", name="Install Axiom web app").is_disabled()
            assert "No verified native distribution link" in guest.locator("#pwa-native-install-state").inner_text()
            open_link.click()
            assert guest.url == origin + "/#/home"
            assert downloads == []

            guest.set_viewport_size({"width": 390, "height": 844})
            guest.wait_for_timeout(100)
            assert guest.locator("#app-shell").is_visible()
            assert guest.locator("#composer").is_visible()
            body_width = guest.evaluate("()=>document.body.scrollWidth")
            assert body_width <= 390, body_width
            guest.screenshot(path=str(OUT / "browser-application-mobile.png"), full_page=True)
            guest_context.close()

            authenticated_context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
            authenticated_context.add_cookies([{"name": "axiom_session", "value": "authenticated", "url": origin, "httpOnly": True, "sameSite": "Lax"}])
            authenticated = authenticated_context.new_page()
            authenticated.goto(origin + "/#/home", wait_until="domcontentloaded")
            first = session_state(authenticated)
            assert first["authenticated"] is True
            assert first["mode"] == "AUTHENTICATED_SAME_ORIGIN_SESSION"
            assert first["displayName"] == "Axiom Test User"
            assert authenticated.get_by_role("button", name="Account: Axiom Test User").is_visible()
            authenticated.reload(wait_until="domcontentloaded")
            restored = session_state(authenticated)
            assert restored["authenticated"] is True
            assert restored["sessionId"] == first["sessionId"] == "session-browser-test"
            storage = authenticated.evaluate("()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})")
            forbidden = re.compile(r"(?:access|refresh)[_-]?token|authorization|api[_-]?key|password|private[_-]?key", re.I)
            assert not [key for key in storage["local"] + storage["session"] if forbidden.search(key)]
            authenticated.screenshot(path=str(OUT / "browser-application-authenticated-desktop.png"), full_page=True)
            authenticated_context.close()
            browser.close()

        contract = json.loads((ROOT / "browser-app.json").read_text(encoding="utf-8"))
        manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
        assert contract["deployment"]["entry_url"] == "./#/home"
        assert manifest["start_url"] == "./#/home"
        assert downloads == []
        assert foreign == []
        evidence = {
            "schema": "musitu.axiom.browser-application-evidence.v1",
            "status": "IMPLEMENTATION_PASS_NOT_DEPLOYED",
            "canonical_app_path": "/",
            "entry_url": "./#/home",
            "root_inline_html_verified": True,
            "download_absent": True,
            "guest_launch_verified": True,
            "authenticated_cookie_session_verified": True,
            "authenticated_refresh_restore_verified": True,
            "hash_deep_link_verified": True,
            "deep_link_refresh_verified": True,
            "legacy_index_normalized_without_reload": True,
            "desktop_viewport_verified": True,
            "mobile_viewport_verified": True,
            "pwa_entry_verified": True,
            "native_paths_separate": True,
            "redirect_loop_absent": True,
            "foreign_requests": foreign,
            "production_deployment_claimed": False,
            "production_identity_integration_claimed": False,
            "request_paths": AppHandler.request_paths,
            "screenshots": ["browser-application-mobile.png", "browser-application-authenticated-desktop.png"],
        }
        (OUT / "browser-application-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    finally:
        server.shutdown()
        server.server_close()
    print("MUSITU_AXIOM_BROWSER_APPLICATION_IMPLEMENTATION_PASS_NOT_DEPLOYED")


if __name__ == "__main__":
    main()
