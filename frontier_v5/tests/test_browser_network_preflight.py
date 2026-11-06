#!/usr/bin/env python3
from __future__ import annotations

from types import ModuleType
import socket
import sys
from unittest.mock import patch

from frontier_v5.runtime.fabric import AuthorizationError
from frontier_v5.runtime.fullstack import PlaywrightBrowserAdapter


def expect_error(fn, exc=Exception):
    try:
        fn()
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")


class _FakeRoute:
    def __init__(self, url: str) -> None:
        self.request = type("Request", (), {"url": url})()
        self.aborted = False
        self.continued = False

    def abort(self, *args, **kwargs):
        self.aborted = True

    def continue_(self, *args, **kwargs):
        self.continued = True


class _FakeLocator:
    def inner_text(self):
        return "public body"


class _FakePage:
    def __init__(self) -> None:
        self.url = "about:blank"
        self.route_handler = None
        self.private_target_reached = False

    def route(self, _pattern, handler):
        self.route_handler = handler

    def goto(self, url, wait_until=None):
        self.url = url
        # A hostile public document attempts to load a private subresource.
        target = "https://127.0.0.1/private"
        if self.route_handler is None:
            self.private_target_reached = True
        else:
            route = _FakeRoute(target)
            self.route_handler(route)
            if route.continued:
                self.private_target_reached = True
        return None

    def locator(self, _selector):
        return _FakeLocator()

    def title(self):
        return "Public"

    def screenshot(self, *args, **kwargs):
        raise AssertionError("screenshot not requested")

    def click(self, *args, **kwargs):
        return None


class _FakeBrowser:
    def __init__(self, page: _FakePage) -> None:
        self.page = page

    def new_page(self):
        return self.page

    def close(self):
        return None


class _FakeChromium:
    def __init__(self, page: _FakePage) -> None:
        self.page = page
        self.launch_args = []

    def launch(self, headless=True, args=None):
        self.launch_args = list(args or [])
        return _FakeBrowser(self.page)


class _FakePlaywright:
    def __init__(self, page: _FakePage) -> None:
        self.chromium = _FakeChromium(page)


class _FakeSyncPlaywright:
    def __init__(self, page: _FakePage) -> None:
        self.page = page

    def __enter__(self):
        return _FakePlaywright(self.page)

    def __exit__(self, *args):
        return False


def main():
    browser = PlaywrightBrowserAdapter({"example.com"})
    private_resolution = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443)),
        (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", 443, 0, 0)),
    ]
    with patch("socket.getaddrinfo", return_value=private_resolution):
        expect_error(lambda: browser._allow("https://example.com"), AuthorizationError)

    # Browser request guard: a public allowlisted top-level page must not be
    # able to cause a request to a private redirect/subresource target before
    # MUSITU validates the target URL. The run must also fail closed visibly.
    page = _FakePage()
    sync_api = ModuleType("playwright.sync_api")
    sync_api.sync_playwright = lambda: _FakeSyncPlaywright(page)
    package = ModuleType("playwright")
    package.sync_api = sync_api

    def resolution(host, port, *args, **kwargs):
        if host == "example.com":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]
        if host == "127.0.0.1":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]
        raise AssertionError(f"unexpected DNS lookup: {host}")

    with patch("socket.getaddrinfo", side_effect=resolution) as dns, patch.dict(
        sys.modules, {"playwright": package, "playwright.sync_api": sync_api}
    ):
        expect_error(lambda: browser.run("https://example.com/start"), AuthorizationError)

    assert dns.call_count == 1, "browser performed a second DNS lookup after pinning"
    assert not page.private_target_reached, (
        "browser contacted a private subresource before MUSITU validated the request URL"
    )

    print("MUSITU_AXIOM_FRONTIER_BROWSER_NETWORK_PREFLIGHT_PASS")


if __name__ == "__main__":
    main()
