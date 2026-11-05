#!/usr/bin/env python3
from __future__ import annotations

import socket
from unittest.mock import patch

import frontier_v5.runtime.fullstack as fullstack
from frontier_v5.runtime.fabric import AuthorizationError
from frontier_v5.runtime.fullstack import LiveResearchAdapter


PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]


class _RedirectResponse:
    status = 302

    def getheader(self, name: str, default=None):
        if name.casefold() == "location":
            return "https://127.0.0.1/private"
        if name.casefold() == "content-type":
            return "text/plain"
        return default

    def read(self, _limit):
        return b""


class _FakePinnedConnection:
    hosts: list[str] = []
    private_target_reached = False

    def __init__(self, host, port, addresses, timeout):
        self.host = str(host)
        self.port = int(port)
        self.addresses = tuple(addresses)
        self.timeout = timeout
        type(self).hosts.append(self.host)
        if self.host == "127.0.0.1":
            type(self).private_target_reached = True

    def request(self, method, target, headers=None):
        assert method == "GET"
        assert self.host == "example.com", "private redirect target reached network connection boundary"

    def getresponse(self):
        return _RedirectResponse()

    def close(self):
        return None


def expect_error(fn, exc=Exception):
    try:
        fn()
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")


def main() -> None:
    adapter = LiveResearchAdapter({"example.com"})
    _FakePinnedConnection.hosts.clear()
    _FakePinnedConnection.private_target_reached = False

    # The allowlisted public hostname is resolved and pinned once. The redirect
    # points at loopback, which is not in the allowlist and must be rejected
    # before MUSITU constructs any connection for that target.
    with patch("socket.getaddrinfo", return_value=PUBLIC) as dns, patch.object(
        fullstack, "_PinnedHTTPSConnection", _FakePinnedConnection
    ):
        expect_error(lambda: adapter.fetch("https://example.com/start"), AuthorizationError)

    assert dns.call_count == 1, "redirect validation unexpectedly re-resolved the public hostname"
    assert _FakePinnedConnection.hosts == ["example.com"]
    assert not _FakePinnedConnection.private_target_reached, (
        "redirect target was contacted before MUSITU rejected the private URL"
    )
    print("MUSITU_AXIOM_FRONTIER_RESEARCH_REDIRECT_PREFLIGHT_PASS")


if __name__ == "__main__":
    main()
