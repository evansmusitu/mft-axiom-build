#!/usr/bin/env python3
from __future__ import annotations

import socket
from unittest.mock import patch

from frontier_v5.runtime.fabric import AuthorizationError
from frontier_v5.runtime.fullstack import PlaywrightBrowserAdapter


def expect_error(fn, exc=Exception):
    try:
        fn()
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")


def main():
    browser = PlaywrightBrowserAdapter({"example.com"})
    private_resolution = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443)),
        (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", 443, 0, 0)),
    ]
    with patch("socket.getaddrinfo", return_value=private_resolution):
        expect_error(lambda: browser._allow("https://example.com"), AuthorizationError)

    print("MUSITU_AXIOM_FRONTIER_BROWSER_NETWORK_PREFLIGHT_PASS")


if __name__ == "__main__":
    main()
