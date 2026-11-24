#!/usr/bin/env python3
"""Client ID Metadata Document (CIMD) validation for Frontier v5.

This module is an isolated MCP 2026-07-28 authorization candidate. It does not
modify the sealed production OAuth worker and does not perform Dynamic Client
Registration. Network transport is injected so callers can bind CIMD retrieval
to MUSITU's hardened, DNS-pinned HTTPS egress rather than a generic URL opener.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
import hashlib
import ipaddress
import json
import urllib.parse


class CIMDError(RuntimeError):
    """Raised when CIMD identity or authorization metadata fails closed."""


@dataclass(frozen=True)
class CIMDFetchResult:
    """Bounded transport result supplied by an independently hardened fetcher."""

    final_url: str
    content_type: str
    body: bytes

    def __post_init__(self) -> None:
        if not isinstance(self.final_url, str) or not self.final_url:
            raise ValueError("final_url required")
        if not isinstance(self.content_type, str) or not self.content_type:
            raise ValueError("content_type required")
        if not isinstance(self.body, bytes):
            raise ValueError("body must be bytes")


def _nonempty(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CIMDError(f"{name} must be a non-empty string")
    return value.strip()


def _object(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise CIMDError(f"{name} must be an object")
    return value


def _string_list(value: Any, name: str, *, nonempty: bool = True) -> list[str]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise CIMDError(f"{name} must be an array")
    out = [_nonempty(item, name) for item in value]
    if nonempty and not out:
        raise CIMDError(f"{name} must not be empty")
    if len(set(out)) != len(out):
        raise CIMDError(f"{name} must not contain duplicates")
    return out


def validate_client_metadata_url(url: str) -> str:
    """Validate a stable CIMD URL before any network access occurs."""
    text = _nonempty(url, "client metadata URL")
    try:
        parsed = urllib.parse.urlsplit(text)
    except ValueError as exc:
        raise CIMDError("client metadata URL is invalid") from exc

    if parsed.scheme != "https":
        raise CIMDError("client metadata URL must use HTTPS")
    if not parsed.hostname:
        raise CIMDError("client metadata URL requires a host")
    if parsed.username is not None or parsed.password is not None:
        raise CIMDError("client metadata URL must not contain userinfo")
    if parsed.query:
        # The current MCP SDKs reject queries for stable client-id identity,
        # even where the underlying draft only discourages them.
        raise CIMDError("client metadata URL must not contain a query")
    if parsed.fragment:
        raise CIMDError("client metadata URL must not contain a fragment")
    if not parsed.path or parsed.path == "/":
        raise CIMDError("client metadata URL must use a non-root path")

    decoded_path = urllib.parse.unquote(parsed.path)
    if any(segment in {".", ".."} for segment in decoded_path.split("/")):
        raise CIMDError("client metadata URL must not contain dot path segments")

    host = parsed.hostname.casefold()
    if host == "localhost" or host.endswith(".localhost"):
        raise CIMDError("client metadata URL host must be publicly routable")
    try:
        literal = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        pass
    else:
        if not literal.is_global:
            raise CIMDError("client metadata URL IP must be publicly routable")

    # Reject ambiguous default/invalid ports while preserving a canonical URL
    # supplied by the client as its identifier.
    try:
        port = parsed.port
    except ValueError as exc:
        raise CIMDError("client metadata URL has invalid port") from exc
    if port is not None and not (1 <= port <= 65535):
        raise CIMDError("client metadata URL has invalid port")
    return text


def _validate_redirect_uri(uri: str, application_type: str) -> str:
    text = _nonempty(uri, "redirect_uri")
    try:
        parsed = urllib.parse.urlsplit(text)
    except ValueError as exc:
        raise CIMDError("redirect_uri is invalid") from exc
    if not parsed.scheme or not parsed.hostname:
        raise CIMDError("redirect_uri must be an absolute HTTP(S) URI")
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise CIMDError("redirect_uri must not contain userinfo or fragment")

    if parsed.scheme == "https":
        return text
    if parsed.scheme != "http":
        raise CIMDError("redirect_uri must use HTTPS or native-app loopback HTTP")

    host = parsed.hostname.casefold()
    loopback = host == "localhost"
    if not loopback:
        try:
            loopback = ipaddress.ip_address(host.split("%", 1)[0]).is_loopback
        except ValueError:
            loopback = False
    if application_type != "native" or not loopback:
        raise CIMDError("redirect_uri cleartext HTTP is allowed only for native loopback clients")
    return text


def _validate_document(document: Mapping[str, Any], client_id: str, redirect_uri: str) -> dict[str, Any]:
    doc = dict(_object(document, "CIMD document"))
    if _nonempty(doc.get("client_id"), "client_id") != client_id:
        raise CIMDError("CIMD client_id must exactly match the client metadata URL")
    _nonempty(doc.get("client_name"), "client_name")

    if "client_secret" in doc or "client_secret_expires_at" in doc:
        raise CIMDError("CIMD must not embed client_secret material")

    application_type = str(doc.get("application_type") or "web")
    if application_type not in {"web", "native"}:
        raise CIMDError("application_type must be web or native")
    doc["application_type"] = application_type

    redirects = _string_list(doc.get("redirect_uris"), "redirect_uris")
    for uri in redirects:
        _validate_redirect_uri(uri, application_type)
    if redirect_uri not in redirects:
        raise CIMDError("authorization redirect_uri is not registered by the CIMD document")
    # Validate the actual requested redirect too, including native-loopback
    # semantics, rather than relying only on exact string membership.
    _validate_redirect_uri(redirect_uri, application_type)
    doc["redirect_uris"] = redirects

    for field in ("grant_types", "response_types"):
        if field in doc:
            doc[field] = _string_list(doc[field], field)
    if "token_endpoint_auth_method" in doc:
        _nonempty(doc["token_endpoint_auth_method"], "token_endpoint_auth_method")

    return doc


class CIMDResolver:
    """Select CIMD vs explicit DCR fallback and validate a fetched document."""

    def __init__(
        self,
        fetcher: Callable[[str], CIMDFetchResult],
        *,
        max_bytes: int = 64_000,
    ) -> None:
        if not callable(fetcher):
            raise ValueError("fetcher must be callable")
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes <= 0:
            raise ValueError("max_bytes must be a positive integer")
        self.fetcher = fetcher
        self.max_bytes = max_bytes

    def resolve(
        self,
        *,
        client_id: str,
        redirect_uri: str,
        authorization_server_metadata: Mapping[str, Any],
    ) -> dict[str, Any]:
        metadata = _object(authorization_server_metadata, "authorization server metadata")
        supported = metadata.get("client_id_metadata_document_supported", False)
        if type(supported) is not bool:
            raise CIMDError("client_id_metadata_document_supported must be boolean")
        if not supported:
            # Compatibility is explicit: the production layer may continue its
            # already-verified DCR path, but this candidate never performs an
            # implicit registration as a side effect of metadata resolution.
            return {"mode": "DCR_REQUIRED", "client_id": None, "client_secret": None}

        normalized_client_id = validate_client_metadata_url(client_id)
        _nonempty(redirect_uri, "redirect_uri")

        try:
            fetched = self.fetcher(normalized_client_id)
        except CIMDError:
            raise
        except Exception as exc:
            raise CIMDError("CIMD fetch failed") from exc
        if not isinstance(fetched, CIMDFetchResult):
            raise CIMDError("CIMD fetcher returned invalid result")
        if fetched.final_url != normalized_client_id:
            raise CIMDError("CIMD fetch redirect is prohibited because the URL is the client_id")
        if len(fetched.body) > self.max_bytes:
            raise CIMDError("CIMD document exceeds size limit")

        media_type = fetched.content_type.split(";", 1)[0].strip().casefold()
        if media_type != "application/json" and not media_type.endswith("+json"):
            raise CIMDError("CIMD response content type must be JSON")
        try:
            decoded = fetched.body.decode("utf-8", "strict")
            document = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CIMDError("CIMD document is not valid UTF-8 JSON") from exc
        document = _object(document, "CIMD document")
        validated = _validate_document(document, normalized_client_id, redirect_uri)

        return {
            "mode": "CIMD",
            "client_id": normalized_client_id,
            "client_secret": None,
            "metadata": validated,
            "document_sha256": hashlib.sha256(fetched.body).hexdigest(),
        }


__all__ = [
    "CIMDError",
    "CIMDFetchResult",
    "CIMDResolver",
    "validate_client_metadata_url",
]
