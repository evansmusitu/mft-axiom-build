#!/usr/bin/env python3
"""Hardened public facade for the MUSITU Axiom Frontier v5 full-stack adapters.

The implementation body is preserved byte-for-byte in ``fullstack_base``.
This facade adds fail-closed browser network preflight without weakening the
already verified research, artifact, persistence, multimodal, evaluation, or
specialist adapters. Private-network browsing is disabled by default and must
be explicitly opted into by isolated test/development callers.
"""
from __future__ import annotations

from typing import Iterable
import urllib.parse

from . import fullstack_base as _base
from .fabric import AuthorizationError

# Preserve the complete prior module surface, including private helpers used by
# internal callers, then override only the browser adapter below.
for _name in dir(_base):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_base, _name)


class PlaywrightBrowserAdapter(_base.PlaywrightBrowserAdapter):
    """Browser adapter with fail-closed DNS/IP preflight.

    Production/default callers may browse only allowlisted HTTPS hosts that
    resolve exclusively to globally routable addresses. ``allow_private`` is
    an explicit escape hatch for isolated local fixtures only; it is never
    enabled implicitly from environment or hostname shape.
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


__all__ = list(_base.__all__)
