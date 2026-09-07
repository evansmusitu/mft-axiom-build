#!/usr/bin/env python3
from __future__ import annotations

from types import ModuleType
import socket
import sys
from unittest.mock import patch

import frontier_v5.runtime.fullstack as fullstack
from frontier_v5.runtime.fullstack import LiveResearchAdapter, PlaywrightBrowserAdapter


PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
PRIVATE = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]


class _FakeResponse:
    status = 200
    headers = {"Content-Type": "text/plain; charset=utf-8"}

    def read(self, _limit):
        return b"pinned-public-response"

    def getheader(self, name, default=None):
        return self.headers.get(name, default)


class _FakePinnedConnection:
    instances = []

    def __init__(self, host, port, addresses, timeout):
        self.host = host
        self.port = port
        self.addresses = tuple(addresses)
        self.timeout = timeout
        self.request_args = None
        type(self).instances.append(self)

    def request(self, method, target, headers=None):
        self.request_args = (method, target, dict(headers or {}))

    def getresponse(self):
        return _FakeResponse()

    def close(self):
        return None


class _FakeRoute:
    def __init__(self, url):
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
    def __init__(self):
        self.url = "about:blank"
        self.route_handler = None

    def route(self, _pattern, handler):
        self.route_handler = handler

    def goto(self, url, wait_until=None):
        if self.route_handler is not None:
            route = _FakeRoute(url)
            self.route_handler(route)
            if route.aborted:
                raise RuntimeError("top-level request aborted")
            assert route.continued
        self.url = url

    def locator(self, _selector):
        return _FakeLocator()

    def title(self):
        return "Public"

    def screenshot(self, *args, **kwargs):
        raise AssertionError("screenshot not requested")

    def click(self, *args, **kwargs):
        return None


class _FakeBrowser:
    def __init__(self, page):
        self.page = page

    def new_page(self):
        return self.page

    def close(self):
        return None


class _FakeChromium:
    def __init__(self, page):
        self.page = page
        self.launch_args = None

    def launch(self, headless=True, args=None):
        self.launch_args = list(args or [])
        return _FakeBrowser(self.page)


class _FakePlaywright:
    def __init__(self, page):
        self.chromium = _FakeChromium(page)


class _FakeSyncPlaywright:
    def __init__(self, page, holder):
        self.page = page
        self.holder = holder

    def __enter__(self):
        p = _FakePlaywright(self.page)
        self.holder.append(p)
        return p

    def __exit__(self, *args):
        return False


def main():
    # Research must resolve once, bind the validated public IP into the actual
    # HTTPS connection, and never ask DNS again for the same request.
    dns_answers = [PUBLIC, PRIVATE]
    with patch("socket.getaddrinfo", side_effect=dns_answers) as dns, patch.object(
        fullstack, "_PinnedHTTPSConnection", _FakePinnedConnection
    ):
        snap = LiveResearchAdapter({"example.com"}).fetch("https://example.com/data")
    assert snap.content == b"pinned-public-response"
    assert dns.call_count == 1, "research adapter re-resolved hostname after security validation"
    assert _FakePinnedConnection.instances[-1].addresses == ("93.184.216.34",)
    assert _FakePinnedConnection.instances[-1].host == "example.com"

    # Browser must freeze the validated DNS answer into Chromium's resolver
    # rules. Route guards may validate URL shape/allowlist, but must not perform
    # another DNS lookup that can observe an attacker-controlled rebound.
    page = _FakePage()
    holder = []
    sync_api = ModuleType("playwright.sync_api")
    sync_api.sync_playwright = lambda: _FakeSyncPlaywright(page, holder)
    package = ModuleType("playwright")
    package.sync_api = sync_api

    dns_answers = [PUBLIC, PRIVATE]
    with patch("socket.getaddrinfo", side_effect=dns_answers) as dns, patch.dict(
        sys.modules, {"playwright": package, "playwright.sync_api": sync_api}
    ):
        result = PlaywrightBrowserAdapter({"example.com"}).run("https://example.com/start")
    assert result.final_url == "https://example.com/start"
    assert dns.call_count == 1, "browser re-resolved hostname after pinning"
    args = holder[0].chromium.launch_args
    rules = " ".join(args)
    assert "--host-resolver-rules=" in rules
    assert "MAP example.com 93.184.216.34" in rules

    print("MUSITU_AXIOM_FRONTIER_DNS_REBINDING_PIN_PASS")


if __name__ == "__main__":
    main()
