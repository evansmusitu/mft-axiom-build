#!/usr/bin/env python3
"""Red/green contract for MCP Client ID Metadata Documents (CIMD).

The test is isolated from production OAuth. It proves metadata-document
validation and mode selection only; it never changes the sealed v4/DCR path.
"""
from __future__ import annotations

import json

from frontier_v5.runtime.cimd import (
    CIMDError,
    CIMDFetchResult,
    CIMDResolver,
    validate_client_metadata_url,
)


def expect_error(fn, contains: str = "") -> None:
    try:
        fn()
    except CIMDError as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"expected {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError("expected CIMDError")


def document(client_id: str, redirects: list[str] | None = None) -> dict:
    return {
        "client_id": client_id,
        "client_name": "MUSITU Frontier CIMD Fixture",
        "redirect_uris": redirects or ["https://chatgpt.com/connector/oauth/musitu-frontier-cimd"],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "web",
    }


def main() -> None:
    client_id = "https://client.example/.well-known/musitu-cimd.json"
    redirect = "https://chatgpt.com/connector/oauth/musitu-frontier-cimd"
    calls: list[str] = []

    def fetcher(url: str) -> CIMDFetchResult:
        calls.append(url)
        body = json.dumps(document(client_id), sort_keys=True).encode()
        return CIMDFetchResult(
            final_url=url,
            content_type="application/json; charset=utf-8",
            body=body,
        )

    resolver = CIMDResolver(fetcher, max_bytes=64_000)

    # Modern authorization metadata selects CIMD and skips DCR. The URL is the
    # client_id; there is no client secret.
    out = resolver.resolve(
        client_id=client_id,
        redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    )
    assert out["mode"] == "CIMD"
    assert out["client_id"] == client_id
    assert out["client_secret"] is None
    assert out["metadata"]["client_id"] == client_id
    assert out["metadata"]["client_name"] == "MUSITU Frontier CIMD Fixture"
    assert out["document_sha256"]
    assert calls == [client_id]

    # If the authorization server does not advertise CIMD support, this layer
    # returns an explicit DCR fallback requirement without performing network
    # access or silently registering anything.
    calls.clear()
    fallback = resolver.resolve(
        client_id=client_id,
        redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": False},
    )
    assert fallback == {"mode": "DCR_REQUIRED", "client_id": None, "client_secret": None}
    assert calls == []

    # A malformed support flag must fail rather than truthy-cast into CIMD.
    expect_error(lambda: resolver.resolve(
        client_id=client_id,
        redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": "true"},
    ), "supported")

    # URL validation occurs before fetch. Stable client IDs are HTTPS, have a
    # non-root path, and contain no query, fragment, userinfo, or dot segments.
    for bad in (
        "http://client.example/cimd.json",
        "https://client.example/",
        "https://user:pass@client.example/cimd.json",
        "https://client.example/cimd.json?tenant=a",
        "https://client.example/cimd.json#fragment",
        "https://client.example/a/../cimd.json",
        "https://client.example/a/./cimd.json",
    ):
        expect_error(lambda bad=bad: validate_client_metadata_url(bad), "client metadata URL")

    # The fetched identity document may not redirect: its URL is the OAuth
    # client identifier, so redirect ambiguity is rejected.
    redirected = CIMDResolver(
        lambda url: CIMDFetchResult(
            final_url="https://other.example/cimd.json",
            content_type="application/json",
            body=json.dumps(document(client_id)).encode(),
        )
    )
    expect_error(lambda: redirected.resolve(
        client_id=client_id,
        redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "redirect")

    # The document must bind itself exactly to the client_id URL and must cover
    # the exact redirect URI used in the authorization request.
    wrong_id = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url,
        content_type="application/json",
        body=json.dumps(document("https://client.example/wrong.json")).encode(),
    ))
    expect_error(lambda: wrong_id.resolve(
        client_id=client_id,
        redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "client_id")

    wrong_redirect = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url,
        content_type="application/json",
        body=json.dumps(document(client_id, ["https://example.com/callback"])).encode(),
    ))
    expect_error(lambda: wrong_redirect.resolve(
        client_id=client_id,
        redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "redirect_uri")

    # Loopback HTTP redirects remain valid for native-app metadata, while
    # arbitrary cleartext remote redirects fail closed.
    native_redirect = "http://127.0.0.1:8765/callback"
    native_doc = document(client_id, [native_redirect])
    native_doc["application_type"] = "native"
    native = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url,
        content_type="application/json",
        body=json.dumps(native_doc).encode(),
    ))
    assert native.resolve(
        client_id=client_id,
        redirect_uri=native_redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    )["mode"] == "CIMD"

    cleartext = document(client_id, ["http://remote.example/callback"])
    bad_redirect = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url,
        content_type="application/json",
        body=json.dumps(cleartext).encode(),
    ))
    expect_error(lambda: bad_redirect.resolve(
        client_id=client_id,
        redirect_uri="http://remote.example/callback",
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "redirect_uri")

    # Fetch response handling is bounded and strict.
    wrong_type = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url, content_type="text/html", body=b"{}"
    ))
    expect_error(lambda: wrong_type.resolve(
        client_id=client_id, redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "content type")

    oversized = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url, content_type="application/json", body=b"x" * 100
    ), max_bytes=32)
    expect_error(lambda: oversized.resolve(
        client_id=client_id, redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "size")

    malformed_json = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url, content_type="application/json", body=b"{not json"
    ))
    expect_error(lambda: malformed_json.resolve(
        client_id=client_id, redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "JSON")

    # CIMD is a public metadata mechanism; embedding a client_secret would
    # create false secret semantics and is rejected.
    secret_doc = document(client_id)
    secret_doc["client_secret"] = "do-not-accept"
    embedded_secret = CIMDResolver(lambda url: CIMDFetchResult(
        final_url=url, content_type="application/json", body=json.dumps(secret_doc).encode()
    ))
    expect_error(lambda: embedded_secret.resolve(
        client_id=client_id, redirect_uri=redirect,
        authorization_server_metadata={"client_id_metadata_document_supported": True},
    ), "client_secret")

    print("MUSITU_AXIOM_FRONTIER_CIMD_CONTRACT_PASS")


if __name__ == "__main__":
    main()
