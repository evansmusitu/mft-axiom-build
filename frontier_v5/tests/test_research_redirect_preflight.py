#!/usr/bin/env python3
from __future__ import annotations

from email.message import Message
from io import BytesIO
import socket
import urllib.parse
import urllib.request
import urllib.response
from unittest.mock import patch

from frontier_v5.runtime.fabric import AuthorizationError
from frontier_v5.runtime.fullstack import LiveResearchAdapter


class _ResponseBody(BytesIO):
    def __init__(self, body: bytes, message: str) -> None:
        super().__init__(body)
        self.msg = message


def _response(url: str, code: int, headers: Message, body: bytes = b""):
    return urllib.response.addinfourl(
        _ResponseBody(body, "Found" if code in {301, 302, 303, 307, 308} else "OK"),
        headers,
        url,
        code=code,
    )


class RedirectingHTTPSHandler(urllib.request.HTTPSHandler):
    """Deterministic transport: public allowlisted URL redirects to loopback."""

    def __init__(self) -> None:
        super().__init__()
        self.private_target_reached = False

    def https_open(self, req):
        host = (urllib.parse.urlparse(req.full_url).hostname or "").casefold()
        if host == "example.com":
            headers = Message()
            headers["Location"] = "https://127.0.0.1/private"
            return _response(req.full_url, 302, headers)
        if host == "127.0.0.1":
            self.private_target_reached = True
            headers = Message()
            headers["Content-Type"] = "text/plain"
            return _response(req.full_url, 200, headers, b"private")
        raise AssertionError(f"unexpected host: {host}")


def expect_error(fn, exc=Exception):
    try:
        fn()
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")


def main() -> None:
    adapter = LiveResearchAdapter({"example.com"})
    transport = RedirectingHTTPSHandler()
    original_build_opener = urllib.request.build_opener

    def build_safe_opener(*handlers):
        # Production may add its own redirect validator. Keep the deterministic
        # transport as the HTTPS boundary so no real network is touched.
        return original_build_opener(*handlers, transport)

    initial_opener = original_build_opener(transport)

    def resolution(host, port, *args, **kwargs):
        if host == "example.com":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]
        if host == "127.0.0.1":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]
        raise AssertionError(f"unexpected DNS lookup: {host}")

    with patch("socket.getaddrinfo", side_effect=resolution), patch(
        "urllib.request._opener", initial_opener
    ), patch("urllib.request.build_opener", side_effect=build_safe_opener):
        expect_error(lambda: adapter.fetch("https://example.com/start"), AuthorizationError)

    assert not transport.private_target_reached, (
        "redirect target was contacted before MUSITU validated the redirect URL"
    )
    print("MUSITU_AXIOM_FRONTIER_RESEARCH_REDIRECT_PREFLIGHT_PASS")


if __name__ == "__main__":
    main()
