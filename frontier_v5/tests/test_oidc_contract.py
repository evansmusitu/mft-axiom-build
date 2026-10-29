#!/usr/bin/env python3
"""Red/green OIDC Core + Discovery contract for Frontier v5.

The private key material below is fixture-only test data generated solely for
this repository contract. It is not and must never become a production key.
"""
from __future__ import annotations

import base64
import json

from frontier_v5.runtime.oidc import (
    OIDCError,
    OIDCProvider,
    RSAKey,
    verify_id_token,
)

ISSUER = "https://auth-frontier.example"
CLIENT_ID = "https://client.example/.well-known/musitu-cimd.json"
NONCE = "nonce_frontier_contract_20260907"
NOW = 1_789_000_000

# Fixture-only 2048-bit RSA keys. Never deploy these values.
K1 = RSAKey(
    kid="fixture-rs256-1",
    n=int("d392e82cc6162055faae7ba9ed699b1631d15e2cb83a8cb6f89a4dc6a2cd90a6ce1eef02b09db542e388d1378bf10e6dfaa1e06dd2e1e36a78e69a3c58dd820ba92c69e55585a0a3c15150d7047b60a32ca5adfeaf532c4d338d2ab0093b910b8ebbddb5d3d38b7996a355a7b25fd0254c11bb70daf34f856deb9f0415d2424335b46277bb9e4e335d4be095d909158de62c2b7c845845739f322ff10c4c7a7b387cea19e55701f707efad4ee418ababdc4e08809084518dffd18a9eec5089eb4e22421f9b6705e1a9735a1ddddd7b83ba404dabadaa1dfe2ed7bdb6938edcd40fe80571a445902036568a24123a49590c61e25cced95dc3adec9c7e77047be3", 16),
    e=65537,
    d=int("48506e0adfa9b063b2caf079a42bf45621b0edff5af8a81fe1d8dbbc88e8ba08496b49462217c55c9768ac19d03b143382f6d13eb8557ce5676d6a4a36157fdd7c7531bcb0fe7b697d29cdf7b0107b774a4b56ad363fb764abba145d16cac548ae0088471d9fb08c5e7075565c2163835bfcb3945f41ca6c50a5b8342d413064295debb94b14a3432ca5d64045e1760d4e5030e191b19346da9470b1614084a17b88e01e8ba7ad37a251cd0840277df0bfb2d1d29ba56e329e25244ac926310099249ef183739b1ce037eb2c72fb5e3f3621cb4fe5d5bdda9bd479584772ede61fb7dba69494f83cb70fd45db8ce314f1361371c1658bb35fdb381501e195801", 16),
)
K2 = RSAKey(
    kid="fixture-rs256-2",
    n=int("ea5e2890fe53f8b09a949892cf677c6bf00a61057762164f4b7041b1b5159374d993da618b7b87f90335f8f5b0d91b2b4ef44696ef451c42b89f972c2a00104da2795ed2a227e0a0489b9147567f211e857034c3d43423e06d64e26bde0a7d5220be6ad3b8882e3826c1ab88441a3f8f83784786096bdd774d70fec548d326feb60832aafa5361c11711197ca1ed69560510ddc64685b3e73c8072e58166144eb5eb4cb0acce857e62b4462a8d2d6aee38518c368b3679097a2089837f629ce22da96613ce7352817c77ea0bd10f4e5d6bb40fec1ec4f800895e62360478b7cb0adc02556753a09762a1b2a246c74380c6d178ad08c42447bfe12b98bdd28f21", 16),
    e=65537,
    d=int("1caafcda5389d0fb454554ee6c5953c25e3fdec34ce99e21ffefd0d15c7db1a652f0ff7efc1155be1372f82b9180d50e749f73bd05b295f4e161801be25d54a132751730bbae160f752236609c077bf5204c6bdfe266a856ccfad0a97225255434f625da1511ef5966003dabb2ece5067885ef75c9543ce8597c2f65d17526a9388d46390ca491230b022547bf5da4d3456f5ebef16c0a355920d5991418c3897115e5f1e1155f5c8c5fd48b01add344be70562155fba18338eb36c86c1305dc8b3530282b027158d0aaa3dedf6af0490df07dadd965d84f1ca52c7ae9e3032c8e0481c3ada7db59005ada8cfb9172aed4ea32260c9b40b4d991fa415a94341", 16),
)


def expect_error(fn, contains: str = "") -> None:
    try:
        fn()
    except OIDCError as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"expected {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError("expected OIDCError")


def b64json(part: str) -> dict:
    padded = part + "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(padded).decode())


def provider(active=K1, verification=(K1, K2)) -> OIDCProvider:
    return OIDCProvider(
        issuer=ISSUER,
        authorization_endpoint=ISSUER + "/oauth/authorize",
        token_endpoint=ISSUER + "/oauth/token",
        userinfo_endpoint=ISSUER + "/oauth/userinfo",
        jwks_uri=ISSUER + "/.well-known/jwks.json",
        signing_key=active,
        verification_keys=verification,
    )


def main() -> None:
    p = provider()

    # Discovery must advertise only features actually implemented by this
    # candidate and must provide the standard OIDC issuer/JWKS/token metadata.
    d = p.discovery()
    assert d["issuer"] == ISSUER
    assert d["authorization_endpoint"].startswith(ISSUER + "/")
    assert d["token_endpoint"].startswith(ISSUER + "/")
    assert d["userinfo_endpoint"].startswith(ISSUER + "/")
    assert d["jwks_uri"] == ISSUER + "/.well-known/jwks.json"
    assert d["response_types_supported"] == ["code"]
    assert d["grant_types_supported"] == ["authorization_code", "refresh_token"]
    assert d["subject_types_supported"] == ["public"]
    assert d["id_token_signing_alg_values_supported"] == ["RS256"]
    assert "openid" in d["scopes_supported"] and "email" in d["scopes_supported"]
    assert d["code_challenge_methods_supported"] == ["S256"]

    # JWKS contains public verification material only and supports rotation.
    jwks = p.jwks()
    assert {k["kid"] for k in jwks["keys"]} == {K1.kid, K2.kid}
    assert all(k["kty"] == "RSA" and k["alg"] == "RS256" and k["use"] == "sig" for k in jwks["keys"])
    assert all("d" not in k for k in jwks["keys"])

    token = p.issue_id_token(
        subject="customer-fixture-123",
        client_id=CLIENT_ID,
        nonce=NONCE,
        now=NOW,
        lifetime_seconds=300,
        extra_claims={"email": "fixture@example.invalid", "email_verified": True},
    )
    header, claims, signature = token.split(".")
    assert b64json(header) == {"alg": "RS256", "kid": K1.kid, "typ": "JWT"}
    decoded = b64json(claims)
    assert decoded["iss"] == ISSUER
    assert decoded["sub"] == "customer-fixture-123"
    assert decoded["aud"] == CLIENT_ID
    assert decoded["nonce"] == NONCE
    assert decoded["iat"] == NOW and decoded["exp"] == NOW + 300
    assert signature

    verified = verify_id_token(
        token,
        jwks=jwks,
        expected_issuer=ISSUER,
        expected_audience=CLIENT_ID,
        expected_nonce=NONCE,
        now=NOW + 1,
    )
    assert verified["sub"] == "customer-fixture-123"
    assert verified["email_verified"] is True

    # Key rotation: new tokens use K2, while old K1 tokens continue verifying
    # until K1 is intentionally removed from the published verification set.
    rotated = provider(active=K2, verification=(K2, K1))
    token2 = rotated.issue_id_token(
        subject="customer-fixture-123", client_id=CLIENT_ID, nonce=NONCE,
        now=NOW + 10, lifetime_seconds=300,
    )
    assert b64json(token2.split(".")[0])["kid"] == K2.kid
    assert verify_id_token(token2, jwks=rotated.jwks(), expected_issuer=ISSUER,
                           expected_audience=CLIENT_ID, expected_nonce=NONCE, now=NOW + 11)["sub"]
    assert verify_id_token(token, jwks=rotated.jwks(), expected_issuer=ISSUER,
                           expected_audience=CLIENT_ID, expected_nonce=NONCE, now=NOW + 11)["sub"]
    expect_error(lambda: verify_id_token(token, jwks=provider(active=K2, verification=(K2,)).jwks(),
                                         expected_issuer=ISSUER, expected_audience=CLIENT_ID,
                                         expected_nonce=NONCE, now=NOW + 11), "kid")

    # Fail closed on the core identity-binding attacks.
    expect_error(lambda: verify_id_token(token, jwks=jwks, expected_issuer="https://evil.example",
                                         expected_audience=CLIENT_ID, expected_nonce=NONCE,
                                         now=NOW + 1), "issuer")
    expect_error(lambda: verify_id_token(token, jwks=jwks, expected_issuer=ISSUER,
                                         expected_audience="other-client", expected_nonce=NONCE,
                                         now=NOW + 1), "audience")
    expect_error(lambda: verify_id_token(token, jwks=jwks, expected_issuer=ISSUER,
                                         expected_audience=CLIENT_ID, expected_nonce="wrong",
                                         now=NOW + 1), "nonce")
    expect_error(lambda: verify_id_token(token, jwks=jwks, expected_issuer=ISSUER,
                                         expected_audience=CLIENT_ID, expected_nonce=NONCE,
                                         now=NOW + 301), "expired")

    # Signature/header tampering must not parse as a valid identity token.
    h, c, s = token.split(".")
    tampered_claims = dict(b64json(c)); tampered_claims["sub"] = "attacker"
    raw = json.dumps(tampered_claims, sort_keys=True, separators=(",", ":")).encode()
    tampered_c = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    expect_error(lambda: verify_id_token(h + "." + tampered_c + "." + s, jwks=jwks,
                                         expected_issuer=ISSUER, expected_audience=CLIENT_ID,
                                         expected_nonce=NONCE, now=NOW + 1), "signature")

    none_header = base64.urlsafe_b64encode(json.dumps({"alg":"none","kid":K1.kid,"typ":"JWT"}, separators=(",", ":")).encode()).rstrip(b"=").decode()
    expect_error(lambda: verify_id_token(none_header + "." + c + ".", jwks=jwks,
                                         expected_issuer=ISSUER, expected_audience=CLIENT_ID,
                                         expected_nonce=NONCE, now=NOW + 1), "alg")

    # Token creation must not allow caller claims to overwrite security-bound
    # issuer/audience/time/subject/nonce values.
    for forbidden in ("iss", "aud", "sub", "exp", "iat", "nonce"):
        expect_error(lambda forbidden=forbidden: p.issue_id_token(
            subject="fixture", client_id=CLIENT_ID, nonce=NONCE, now=NOW,
            extra_claims={forbidden: "attacker"},
        ), "reserved")

    # Constructor rejects dishonest or unsafe endpoint metadata.
    expect_error(lambda: OIDCProvider(
        issuer=ISSUER,
        authorization_endpoint="http://auth-frontier.example/oauth/authorize",
        token_endpoint=ISSUER + "/oauth/token",
        userinfo_endpoint=ISSUER + "/oauth/userinfo",
        jwks_uri=ISSUER + "/jwks",
        signing_key=K1,
        verification_keys=(K1,),
    ), "HTTPS")

    print("MUSITU_AXIOM_FRONTIER_OIDC_CONTRACT_PASS")


if __name__ == "__main__":
    main()
