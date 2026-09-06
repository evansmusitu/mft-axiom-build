#!/usr/bin/env python3
"""Hardened public facade for the MUSITU Axiom Frontier v5 full-stack adapters.

The implementation body is preserved byte-for-byte in ``fullstack_base``.
This facade adds fail-closed research/browser network preflight without
weakening the already verified artifact, persistence, multimodal, evaluation,
or specialist adapters. Private-network browsing is disabled by default and
must be explicitly opted into by isolated test/development callers.
"""
from __future__ import annotations

from typing import Iterable, Mapping
import urllib.error
import urllib.parse
import urllib.request

from . import fullstack_base as _base
from .fabric import AuthorizationError, FrontierError

# Preserve the complete prior module surface, including private helpers used by
# internal callers, then override only the hardened network adapters below.
for _name in dir(_base):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_base, _name)


class _ValidatedRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Validate every redirect target before urllib is allowed to follow it."""

    def __init__(self, validator) -> None:
        super().__init__()
        self._validator = validator

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self._validator(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class LiveResearchAdapter(_base.LiveResearchAdapter):
    """Research adapter with fail-closed DNS and redirect preflight."""

    def fetch(self, url: str, headers: Mapping[str, str] | None = None) -> _base.RetrievalSnapshot:
        host = self._check_url(url)
        request_headers = {
            "Accept": "application/json,text/plain,text/html,*/*;q=0.5",
            "User-Agent": "MUSITU-Axiom-Frontier-Research/5.0",
        }
        if headers:
            for key, value in headers.items():
                if key.casefold() in {"authorization", "cookie", "proxy-authorization"}:
                    raise AuthorizationError("credential-bearing research header prohibited")
                request_headers[str(key)]] = str(value)

        req = urllib.request.Request(url, headers=request_headers, method="GET")
        opener = urllib.request.build_opener(_ValidatedRedirectHandler(self._check_url))
        try:
            with opener.open(req, timeout=self.timeout) as response:
                final = response.geturl()
                self._check_url(final)
                status = int(response.status)
                ctype = str(response.headers.get("Content-Type") or "application/octet-stream").split(";", 1)[0].strip().lower()
                body = response.read(self.max_bytes + 1)
        except urllib.error.HTTPError as exc:
            raise FrontierError(f"research HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise FrontierError("research transport failure") from exc

        if status != 200:
            raise FrontierError(f"research HTTP {status}")
        if len(body) > self.max_bytes:
            raise FrontierError("research response exceeds byte limit")
        flags: tuple[str, ...] = ()
        if ctype.startswith("text/") or ctype in {"application/json", "application/xml", "application/xhtml+xml"}:
            flags = _base.RetrievedContentFirewall.scan(body.decode("utf-8", "replace"))
        return _base.RetrievalSnapshot(
            url=url,
            final_url=final,
            retrieved_at=_base._utcnow(),
            status=status,
            content_type=ctype,
            byte_length=len(body),
            sha256=_base._sha_bytes(body),
            source_host=host,
            instruction_authority="retrieved-content-data-only",
            injection_flags=flags,
            content=body,
        )


class PlaywrightBrowserAdapter(_base.PlaywrightBrowserAdapter):
    """Browser adapter with fail-closed DNS/IP and request-level preflight.

    Production/default callers may browse only allowlisted HTTPS hosts that
    resolve exclusively to globally routable addresses. Every navigation and
    subresource request is revalidated before Playwright is allowed to continue
    it. ``allow_private`` is an explicit escape hatch for isolated local
    fixtures only; it is never enabled implicitly from environment or hostname
    shape.
    """

    def __init__(
        self,
        allowed_hosts: Iterable[str],
        headless: bool = True,
        allow_private: bool = False,
    ) -> None:
        super().__init__(allowed_hosts, headless=headless)
        self.allow_private = bool(allow_private)

    def _allow(self, url: str) -> None:
        parsed = urllib.parse.urlparse(url)
        host = (parsed.hostname or "").casefold()
        permitted_schemes = {"http", "https"} if self.allow_private else {"https"}
        if parsed.scheme not in permitted_schemes or host not in self.allowed_hosts:
            raise AuthorizationError("browser navigation target not allowlisted")
        if parsed.username or parsed.password:
            raise AuthorizationError("userinfo in browser URL is prohibited")
        try:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
        except ValueError as exc:
            raise AuthorizationError("browser URL port is invalid") from exc
        if not self.allow_private:
            _base.LiveResearchAdapter._require_public_resolution(host, port)

    def run(
        self,
        url: str,
        screenshot_path: str | _base.Path | None = None,
        click_selector: str | None = None,
        expect_text: str | None = None,
    ) -> _base.BrowserResult:
        self._allow(url)
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            raise FrontierError("playwright runtime unavailable") from exc

        shot_hash = None
        blocked: list[AuthorizationError] = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=self.headless)
            page = browser.new_page()

            def guard(route) -> None:
                try:
                    self._allow(route.request.url)
                except AuthorizationError as exc:
                    blocked.append(exc)
                    route.abort()
                    return
                route.continue_()

            page.route("**/*", guard)
            try:
                page.goto(url, wait_until="networkidle")
            except Exception as exc:
                browser.close()
                if blocked:
                    raise blocked[0] from exc
                raise
            if blocked:
                browser.close()
                raise blocked[0]

            self._allow(page.url)
            if click_selector:
                page.click(click_selector)
                if blocked:
                    browser.close()
                    raise blocked[0]
            text = page.locator("body").inner_text()
            if expect_text is not None and expect_text not in text:
                browser.close()
                raise FrontierError("browser expected text not observed")
            if screenshot_path is not None:
                path = _base.Path(screenshot_path)
                path.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(path), full_page=True)
                shot_hash = _base._sha_bytes(path.read_bytes())
            out = _base.BrowserResult(url, page.title(), _base._sha_bytes(text.encode()), shot_hash, page.url)
            browser.close()
            return out


__all__ = list(_base.__all__)
