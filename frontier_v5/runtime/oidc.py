#!/usr/bin/env python3
"""Isolated OpenID Connect identity primitives for MUSITU Axiom Frontier v5.

The module implements the cryptographic and metadata portion of an OIDC
candidate using only the Python standard library: standards-shaped discovery,
public JWKS publication, RS256 ID-token issuance, verification, nonce/audience/
issuer/time binding, and key rotation. It is deliberately NOT wired into the
sealed production OAuth worker.

Production promotion requires separate endpoint integration, live HTTPS/JWKS
verification, enterprise-domain tests, and key material held by an approved
secret/KMS boundary. Repository fixture keys must never be used in production.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
import base64
import hashlib
import hmac
import json
import urllib.parse


_RS256_DIGEST_INFO_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")
_RESERVED_ID_TOKEN_CLAIMS = frozenset({"iss", "sub", "aud", "exp", "iat", "nonce"})


class OIDCError(RuntimeError):
    """Raised for fail-closed OIDC metadata or token validation errors."""


def _nonempty(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OIDCError(f"{name} must be a non-empty string")
    return value.strip()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str, name: str) -> bytes:
    if not isinstance(text, str) or not text:
        raise OIDCError(f"{name} must be non-empty base64url")
    try:
        return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)
    except Exception as exc:
        raise OIDCError(f"{name} is invalid base64url") from exc


def _int_bytes(value: int) -> bytes:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise OIDCError("RSA integer must be positive")
    return value.to_bytes((value.bit_length() + 7) // 8, "big")


def _json_b64(value: Mapping[str, Any]) -> str:
    raw = json.dumps(dict(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return _b64url(raw)


def _parse_json_segment(segment: str, name: str) -> Mapping[str, Any]:
    try:
        value = json.loads(_b64url_decode(segment, name).decode("utf-8", "strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OIDCError(f"{name} is not valid UTF-8 JSON") from exc
    if not isinstance(value, Mapping):
        raise OIDCError(f"{name} must decode to an object")
    return value


def _validate_https_url(url: str, name: str, *, issuer: str | None = None) -> str:
    text = _nonempty(url, name)
    try:
        parsed = urllib.parse.urlsplit(text)
    except ValueError as exc:
        raise OIDCError(f"{name} is invalid") from exc
    if parsed.scheme != "https" or not parsed.hostname:
        raise OIDCError(f"{name} must be an absolute HTTPS URL")
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise OIDCError(f"{name} must not contain userinfo or fragment")
    if issuer is not None:
        base = urllib.parse.urlsplit(issuer)
        # For this isolated MUSITU candidate, keeping identity endpoints on the
        # same secure authority reduces metadata substitution risk. A future
        # cross-origin design would require a separate reviewed trust policy.
        if (parsed.scheme, parsed.hostname, parsed.port) != (base.scheme, base.hostname, base.port):
            raise OIDCError(f"{name} must use the issuer HTTPS authority")
    return text


@dataclass(frozen=True)
class RSAKey:
    """Minimal RSA signing/verification key container.

    ``d`` is optional so public-only verification keys can be represented.
    """

    kid: str
    n: int
    e: int = 65537
    d: int | None = None

    def __post_init__(self) -> None:
        _nonempty(self.kid, "kid")
        if isinstance(self.n, bool) or not isinstance(self.n, int) or self.n <= 0:
            raise OIDCError("RSA modulus must be positive")
        if isinstance(self.e, bool) or not isinstance(self.e, int) or self.e <= 2 or self.e % 2 == 0:
            raise OIDCError("RSA public exponent must be an odd integer > 2")
        if self.n.bit_length() < 2048:
            raise OIDCError("RSA modulus must be at least 2048 bits")
        if self.d is not None and (isinstance(self.d, bool) or not isinstance(self.d, int) or self.d <= 0):
            raise OIDCError("RSA private exponent must be positive")

    @property
    def byte_length(self) -> int:
        return (self.n.bit_length() + 7) // 8

    def public_jwk(self) -> dict[str, str]:
        return {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": self.kid,
            "n": _b64url(_int_bytes(self.n)),
            "e": _b64url(_int_bytes(self.e)),
        }

    @classmethod
    def from_public_jwk(cls, raw: Mapping[str, Any]) -> "RSAKey":
        if not isinstance(raw, Mapping):
            raise OIDCError("JWK must be an object")
        if raw.get("kty") != "RSA" or raw.get("alg") != "RS256" or raw.get("use") not in (None, "sig"):
            raise OIDCError("JWK is not an RS256 signing key")
        kid = _nonempty(raw.get("kid"), "JWK kid")
        try:
            n = int.from_bytes(_b64url_decode(_nonempty(raw.get("n"), "JWK n"), "JWK n"), "big")
            e = int.from_bytes(_b64url_decode(_nonempty(raw.get("e"), "JWK e"), "JWK e"), "big")
        except ValueError as exc:
            raise OIDCError("JWK RSA integer is invalid") from exc
        return cls(kid=kid, n=n, e=e)


def _rs256_sign(signing_input: bytes, key: RSAKey) -> bytes:
    if key.d is None:
        raise OIDCError("RS256 signing requires private key material")
    digest_info = _RS256_DIGEST_INFO_PREFIX + hashlib.sha256(signing_input).digest()
    k = key.byte_length
    padding_len = k - len(digest_info) - 3
    if padding_len < 8:
        raise OIDCError("RSA modulus is too small for RS256")
    encoded = b"\x00\x01" + (b"\xff" * padding_len) + b"\x00" + digest_info
    signature_int = pow(int.from_bytes(encoded, "big"), key.d, key.n)
    return signature_int.to_bytes(k, "big")


def _rs256_verify(signing_input: bytes, signature: bytes, key: RSAKey) -> bool:
    if len(signature) != key.byte_length:
        return False
    recovered_int = pow(int.from_bytes(signature, "big"), key.e, key.n)
    recovered = recovered_int.to_bytes(key.byte_length, "big")
    digest_info = _RS256_DIGEST_INFO_PREFIX + hashlib.sha256(signing_input).digest()
    padding_len = key.byte_length - len(digest_info) - 3
    if padding_len < 8:
        return False
    expected = b"\x00\x01" + (b"\xff" * padding_len) + b"\x00" + digest_info
    return hmac.compare_digest(recovered, expected)


class OIDCProvider:
    """Standards-shaped OIDC identity candidate over an existing OAuth code flow."""

    def __init__(
        self,
        *,
        issuer: str,
        authorization_endpoint: str,
        token_endpoint: str,
        userinfo_endpoint: str,
        jwks_uri: str,
        signing_key: RSAKey,
        verification_keys: Sequence[RSAKey],
    ) -> None:
        self.issuer = _validate_https_url(issuer, "issuer")
        parsed_issuer = urllib.parse.urlsplit(self.issuer)
        if parsed_issuer.query or parsed_issuer.fragment:
            raise OIDCError("issuer must not contain query or fragment")
        self.authorization_endpoint = _validate_https_url(
            authorization_endpoint, "authorization_endpoint", issuer=self.issuer
        )
        self.token_endpoint = _validate_https_url(token_endpoint, "token_endpoint", issuer=self.issuer)
        self.userinfo_endpoint = _validate_https_url(userinfo_endpoint, "userinfo_endpoint", issuer=self.issuer)
        self.jwks_uri = _validate_https_url(jwks_uri, "jwks_uri", issuer=self.issuer)
        if not isinstance(signing_key, RSAKey) or signing_key.d is None:
            raise OIDCError("signing_key must contain an RSA private exponent")
        if isinstance(verification_keys, (str, bytes, bytearray)) or not isinstance(verification_keys, Sequence):
            raise OIDCError("verification_keys must be a sequence")
        keys = list(verification_keys)
        if not keys:
            raise OIDCError("verification_keys cannot be empty")
        by_kid: dict[str, RSAKey] = {}
        for key in keys:
            if not isinstance(key, RSAKey):
                raise OIDCError("verification_keys must contain RSAKey values")
            if key.kid in by_kid:
                raise OIDCError("verification key kids must be unique")
            by_kid[key.kid] = key
        if signing_key.kid not in by_kid:
            raise OIDCError("active signing key must be published in verification_keys")
        published = by_kid[signing_key.kid]
        if (published.n, published.e) != (signing_key.n, signing_key.e):
            raise OIDCError("active signing key does not match published verification key")
        self.signing_key = signing_key
        self._verification_keys = by_kid

    def discovery(self) -> dict[str, Any]:
        """Return truthful metadata for the isolated code-flow identity candidate."""
        return {
            "issuer": self.issuer,
            "authorization_endpoint": self.authorization_endpoint,
            "token_endpoint": self.token_endpoint,
            "userinfo_endpoint": self.userinfo_endpoint,
            "jwks_uri": self.jwks_uri,
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "scopes_supported": ["openid", "email"],
            "claims_supported": ["iss", "sub", "aud", "exp", "iat", "nonce", "email", "email_verified"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
        }

    def jwks(self) -> dict[str, list[dict[str, str]]]:
        return {
            "keys": [self._verification_keys[kid].public_jwk() for kid in sorted(self._verification_keys)]
        }

    def issue_id_token(
        self,
        *,
        subject: str,
        client_id: str,
        nonce: str | None,
        now: int,
        lifetime_seconds: int = 300,
        extra_claims: Mapping[str, Any] | None = None,
    ) -> str:
        subject = _nonempty(subject, "subject")
        client_id = _nonempty(client_id, "client_id")
        if nonce is not None:
            nonce = _nonempty(nonce, "nonce")
        if isinstance(now, bool) or not isinstance(now, int) or now < 0:
            raise OIDCError("now must be a non-negative integer timestamp")
        if isinstance(lifetime_seconds, bool) or not isinstance(lifetime_seconds, int) or not 1 <= lifetime_seconds <= 3600:
            raise OIDCError("ID token lifetime must be within 1..3600 seconds")
        extras = dict(extra_claims or {})
        overlap = sorted(_RESERVED_ID_TOKEN_CLAIMS.intersection(extras))
        if overlap:
            raise OIDCError("extra claims may not override reserved ID token claims: " + ",".join(overlap))

        header = {"alg": "RS256", "kid": self.signing_key.kid, "typ": "JWT"}
        claims: dict[str, Any] = {
            "iss": self.issuer,
            "sub": subject,
            "aud": client_id,
            "iat": now,
            "exp": now + lifetime_seconds,
        }
        if nonce is not None:
            claims["nonce"] = nonce
        claims.update(extras)
        encoded_header = _json_b64(header)
        encoded_claims = _json_b64(claims)
        signing_input = (encoded_header + "." + encoded_claims).encode("ascii")
        signature = _rs256_sign(signing_input, self.signing_key)
        return encoded_header + "." + encoded_claims + "." + _b64url(signature)


def verify_id_token(
    token: str,
    *,
    jwks: Mapping[str, Any],
    expected_issuer: str,
    expected_audience: str,
    expected_nonce: str | None,
    now: int,
    clock_skew_seconds: int = 60,
) -> dict[str, Any]:
    """Verify one RS256 OIDC ID token against a caller-supplied JWKS."""
    token = _nonempty(token, "ID token")
    parts = token.split(".")
    if len(parts) != 3 or not parts[0] or not parts[1]:
        raise OIDCError("ID token must be a three-part JWT")
    encoded_header, encoded_claims, encoded_signature = parts
    header = _parse_json_segment(encoded_header, "ID token header")
    claims = _parse_json_segment(encoded_claims, "ID token claims")

    # Classify and reject algorithm confusion before inspecting signature
    # presence. This makes `alg=none` an explicit algorithm-policy failure.
    if header.get("alg") != "RS256":
        raise OIDCError("ID token alg must be RS256")
    if not encoded_signature:
        raise OIDCError("ID token must be a signed JWT")
    kid = _nonempty(header.get("kid"), "ID token kid")

    if not isinstance(jwks, Mapping):
        raise OIDCError("JWKS must be an object")
    raw_keys = jwks.get("keys")
    if isinstance(raw_keys, (str, bytes, bytearray)) or not isinstance(raw_keys, Sequence):
        raise OIDCError("JWKS keys must be an array")
    matches = [raw for raw in raw_keys if isinstance(raw, Mapping) and raw.get("kid") == kid]
    if len(matches) != 1:
        raise OIDCError("ID token kid is unknown or ambiguous")
    key = RSAKey.from_public_jwk(matches[0])
    signature = _b64url_decode(encoded_signature, "ID token signature")
    signing_input = (encoded_header + "." + encoded_claims).encode("ascii")
    if not _rs256_verify(signing_input, signature, key):
        raise OIDCError("ID token signature verification failed")

    expected_issuer = _nonempty(expected_issuer, "expected issuer")
    expected_audience = _nonempty(expected_audience, "expected audience")
    if claims.get("iss") != expected_issuer:
        raise OIDCError("ID token issuer mismatch")

    aud = claims.get("aud")
    if isinstance(aud, str):
        audience_ok = aud == expected_audience
    elif isinstance(aud, Sequence) and not isinstance(aud, (str, bytes, bytearray)):
        audiences = list(aud)
        if not audiences or not all(isinstance(x, str) and x for x in audiences):
            raise OIDCError("ID token audience is malformed")
        audience_ok = expected_audience in audiences
        if len(audiences) > 1 and claims.get("azp") != expected_audience:
            raise OIDCError("ID token audience requires matching azp")
    else:
        raise OIDCError("ID token audience is missing or malformed")
    if not audience_ok:
        raise OIDCError("ID token audience mismatch")

    _nonempty(claims.get("sub"), "ID token subject")
    if expected_nonce is not None:
        expected_nonce = _nonempty(expected_nonce, "expected nonce")
        if claims.get("nonce") != expected_nonce:
            raise OIDCError("ID token nonce mismatch")

    if isinstance(now, bool) or not isinstance(now, int) or now < 0:
        raise OIDCError("now must be a non-negative integer timestamp")
    if isinstance(clock_skew_seconds, bool) or not isinstance(clock_skew_seconds, int) or clock_skew_seconds < 0:
        raise OIDCError("clock_skew_seconds must be a non-negative integer")
    exp = claims.get("exp")
    iat = claims.get("iat")
    if isinstance(exp, bool) or not isinstance(exp, int):
        raise OIDCError("ID token exp must be an integer")
    if isinstance(iat, bool) or not isinstance(iat, int):
        raise OIDCError("ID token iat must be an integer")
    if exp <= iat:
        raise OIDCError("ID token exp must be after iat")
    if now >= exp:
        raise OIDCError("ID token expired")
    if iat > now + clock_skew_seconds:
        raise OIDCError("ID token iat is in the future")
    if "nbf" in claims:
        nbf = claims["nbf"]
        if isinstance(nbf, bool) or not isinstance(nbf, int):
            raise OIDCError("ID token nbf must be an integer")
        if now + clock_skew_seconds < nbf:
            raise OIDCError("ID token is not yet valid")

    return dict(claims)


__all__ = ["OIDCError", "OIDCProvider", "RSAKey", "verify_id_token"]
