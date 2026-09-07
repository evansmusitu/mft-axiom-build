#!/usr/bin/env python3
"""Hardened public facade for the MUSITU Axiom Frontier v5 full-stack adapters.

The implementation body is preserved in ``fullstack_base``. This facade adds
fail-closed network policy, DNS/IP validation, DNS-rebinding-resistant transport
pinning, and redirect/request validation without weakening the already verified
artifact, persistence, multimodal, evaluation, or specialist adapters.

Private-network browsing remains disabled by default and must be explicitly
opted into only by isolated test/development callers.
"""
from __future__ import annotations

from typing import Iterable, Mapping
import http.client
import ipaddress
import socket
import ssl
import urllib.parse

from . import fullstack_base as _base
from .fabric import AuthorizationError, FrontierError

# Preserve the complete prior module surface, including private helpers used by
# internal callers, then override only the hardened network adapters below.
for _name in dir(_base):
    if not _name.startswith("__"):
        globals()[_name] = getattr(_base, _name)


def _validate_url_shape(url: str, allowed_hosts: frozenset[str], *, allow_private: bool = False) -> tuple[str, int, urllib.parse.ParseResult]:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").casefold()
    permitted_schemes = {"http", "https"} if allow_private else {"https"}
    if parsed.scheme not in permitted_schemes or host not in allowed_hosts:
        raise AuthorizationError("network target not allowlisted")
    if parsed.username or parsed.password:
        raise AuthorizationError("userinfo in network URL is prohibited")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise AuthorizationError("network URL port is invalid") from exc
    return host, port, parsed


def _resolve_public_addresses(host: str, port: int) -> tuple[str, ...]:
    """Resolve once and return only globally routable addresses.

    The returned tuple is the security decision. Callers must bind the actual
    transport to these literal IPs rather than resolving ``host`` again.
    """
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        try:
            resolved = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise AuthorizationError("network host DNS resolution failed") from exc
        raw_addresses = [str(info[4][0]).split("%", 1)[0] for info in resolved if info[4]]
        if not raw_addresses:
            raise AuthorizationError("network host DNS resolution returned no addresses")
    else:
        raw_addresses = [str(literal)]

    addresses: list[str] = []
    seen: set[str] = set()
    for address in raw_addresses:
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError as exc:
            raise AuthorizationError("network host resolved to invalid IP address") from exc
        if not parsed.is_global:
            raise AuthorizationError("network host resolves to non-public address")
        normalized = str(parsed)
        if normalized not in seen:
            seen.add(normalized)
            addresses.append(normalized)
    if not addresses:
        raise AuthorizationError("network host has no permitted address")
    return tuple(addresses)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS connection whose TCP peer is chosen only from prevalidated IPs.

    TLS still uses the original hostname for SNI and certificate hostname
    verification. DNS is never consulted inside ``connect``.
    """

    def __init__(self, host: str, port: int, addresses: Iterable[str], timeout: int | float) -> None:
        context = ssl.create_default_context()
        super().__init__(host, port=port, timeout=timeout, context=context)
        self._pinned_addresses = tuple(str(x) for x in addresses)
        if not self._pinned_addresses:
            raise AuthorizationError("pinned HTTPS connection requires an address")

    def connect(self) -> None:
        last_error: BaseException | None = None
        for address in self._pinned_addresses:
            sock: socket.socket | None = None
            try:
                parsed = ipaddress.ip_address(address)
                family = socket.AF_INET6 if parsed.version == 6 else socket.AF_INET
                sock = socket.socket(family, socket.SOCK_STREAM)
                sock.settimeout(self.timeout)
                endpoint = (address, self.port, 0, 0) if family == socket.AF_INET6 else (address, self.port)
                sock.connect(endpoint)
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
                return
            except BaseException as exc:  # fail over only across already-validated literal IPs
                last_error = exc
                if sock is not None:
                    try:
                        sock.close()
                    except OSError:
                        pass
        if last_error is None:
            raise OSError("no pinned HTTPS address available")
        raise last_error


class LiveResearchAdapter(_base.LiveResearchAdapter):
    """Research adapter with fail-closed redirects and DNS-pinned HTTPS."""

    MAX_REDIRECTS = 5
    _PROHIBITED_REQUEST_HEADERS = frozenset({
        "authorization", "cookie", "proxy-authorization", "host",
        "connection", "content-length", "transfer-encoding",
    })

    def _resolve_target(self, url: str, pins: dict[tuple[str, int], tuple[str, ...]]) -> tuple[str, int, urllib.parse.ParseResult, tuple[str, ...]]:
        host, port, parsed = _validate_url_shape(url, self.allowed_hosts)
        key = (host, port)
        addresses = pins.get(key)
        if addresses is None:
            addresses = _resolve_public_addresses(host, port)
            pins[key] = addresses
        return host, port, parsed, addresses

    def _check_url(self, url: str) -> str:
        # Compatibility path for callers that explicitly ask for validation.
        # ``fetch`` uses its own per-request pin cache so an approved hostname is
        # never re-resolved during that retrieval chain.
        host, port, _ = _validate_url_shape(url, self.allowed_hosts)
        _resolve_public_addresses(host, port)
        return host

    def fetch(self, url: str, headers: Mapping[str, str] | None = None) -> _base.RetrievalSnapshot:
        request_headers = {
            "Accept": "application/json,text/plain,text/html,*/*;q=0.5",
            "User-Agent": "MUSITU-Axiom-Frontier-Research/5.0",
        }
        if headers:
            for key, value in headers.items():
                folded = str(key).casefold()
                if folded in self._PROHIBITED_REQUEST_HEADERS:
                    raise AuthorizationError("security-sensitive research header prohibited")
                request_headers[str(key)] = str(value)

        original_url = str(url)
        current_url = original_url
        pins: dict[tuple[str, int], tuple[str, ...]] = {}
        original_host: str | None = None

        for redirect_count in range(self.MAX_REDIRECTS + 1):
            host, port, parsed, addresses = self._resolve_target(current_url, pins)
            if original_host is None:
                original_host = host
            target = parsed.path or "/"
            if parsed.params:
                target += ";" + parsed.params
            if parsed.query:
                target += "?" + parsed.query

            connection = _PinnedHTTPSConnection(host, port, addresses, self.timeout)
            try:
                connection.request("GET", target, headers=request_headers)
                response = connection.getresponse()
                status = int(response.status)

                if status in {301, 302, 303, 307, 308}:
                    location = response.getheader("Location")
                    if not location:
                        raise FrontierError("research redirect missing Location")
                    if redirect_count >= self.MAX_REDIRECTS:
                        raise FrontierError("research redirect limit exceeded")
                    # Resolve/validate the next hop before any connection to it.
                    current_url = urllib.parse.urljoin(current_url, str(location))
                    self._resolve_target(current_url, pins)
                    continue

                ctype = str(response.getheader("Content-Type", "application/octet-stream") or "application/octet-stream").split(";", 1)[0].strip().lower()
                body = response.read(self.max_bytes + 1)
            except AuthorizationError:
                raise
            except FrontierError:
                raise
            except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
                raise FrontierError("research transport failure") from exc
            finally:
                try:
                    connection.close()
                except OSError:
                    pass

            if status != 200:
                raise FrontierError(f"research HTTP {status}")
            if len(body) > self.max_bytes:
                raise FrontierError("research response exceeds byte limit")

            flags: tuple[str, ...] = ()
            if ctype.startswith("text/") or ctype in {"application/json", "application/xml", "application/xhtml+xml"}:
                flags = _base.RetrievedContentFirewall.scan(body.decode("utf-8", "replace"))
            return _base.RetrievalSnapshot(
                url=original_url,
                final_url=current_url,
                retrieved_at=_base._utcnow(),
                status=status,
                content_type=ctype,
                byte_length=len(body),
                sha256=_base._sha_bytes(body),
                source_host=original_host or host,
                instruction_authority="retrieved-content-data-only",
                injection_flags=flags,
                content=body,
            )

        raise FrontierError("research redirect limit exceeded")


class PlaywrightBrowserAdapter(_base.PlaywrightBrowserAdapter):
    """Browser adapter with frozen DNS answers for the entire browser session.

    Production/default callers may browse only allowlisted HTTPS hosts that
    resolve exclusively to globally routable addresses. All allowed hosts are
    resolved once before Chromium starts, and Chromium is launched with host
    resolver rules mapping those hostnames to the validated literal addresses.
    Route guards validate URL authority without triggering any second DNS query.

    ``allow_private`` is an explicit escape hatch for isolated local fixtures
    only; it is never enabled implicitly from environment or hostname shape.
    """

    def __init__(
        self,
        allowed_hosts: Iterable[str],
        headless: bool = True,
        allow_private: bool = False,
    ) -> None:
        super().__init__(allowed_hosts, headless=headless)
        self.allow_private = bool(allow_private)

    def _shape_only(self, url: str) -> tuple[str, int, urllib.parse.ParseResult]:
        return _validate_url_shape(url, self.allowed_hosts, allow_private=self.allow_private)

    def _allow(self, url: str) -> None:
        host, port, _ = self._shape_only(url)
        if not self.allow_private:
            _resolve_public_addresses(host, port)

    @staticmethod
    def _chromium_ip(addresses: tuple[str, ...]) -> str:
        # Prefer IPv4 for the widest Chromium resolver-rule compatibility.
        for address in addresses:
            if ipaddress.ip_address(address).version == 4:
                return address
        address = addresses[0]
        return f"[{address}]" if ipaddress.ip_address(address).version == 6 else address

    def _freeze_resolver_rules(self) -> tuple[dict[str, tuple[str, ...]], list[str]]:
        pins: dict[str, tuple[str, ...]] = {}
        rules: list[str] = []
        for host in sorted(self.allowed_hosts):
            # Browser production policy currently permits HTTPS. Resolve at 443
            # once; routing to an alternate public port still reuses the same
            # frozen hostname->IP decision.
            addresses = _resolve_public_addresses(host, 443)
            pins[host] = addresses
            rules.append(f"MAP {host} {self._chromium_ip(addresses)}")
        if not rules:
            raise AuthorizationError("browser allowed-host set is empty")
        return pins, ["--host-resolver-rules=" + ",".join(rules)]

    def run(
        self,
        url: str,
        screenshot_path: str | _base.Path | None = None,
        click_selector: str | None = None,
        expect_text: str | None = None,
    ) -> _base.BrowserResult:
        self._shape_only(url)
        if self.allow_private:
            pinned_hosts = set(self.allowed_hosts)
            launch_args: list[str] = []
        else:
            pins, launch_args = self._freeze_resolver_rules()
            pinned_hosts = set(pins)

        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            raise FrontierError("playwright runtime unavailable") from exc

        shot_hash = None
        blocked: list[AuthorizationError] = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=self.headless, args=launch_args)
            page = browser.new_page()

            def guard(route) -> None:
                try:
                    host, _, _ = self._shape_only(route.request.url)
                    if host not in pinned_hosts:
                        raise AuthorizationError("browser request host is not pinned")
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

            final_host, _, _ = self._shape_only(page.url)
            if final_host not in pinned_hosts:
                browser.close()
                raise AuthorizationError("browser final URL host is not pinned")
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
