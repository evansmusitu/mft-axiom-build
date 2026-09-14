#!/usr/bin/env python3
"""Minimal exact-live patch for MUSITU Chemistry -> Paynow browser handoff.

The live V3 checkout form posts only to MUSITU. checkoutPost then returns a 303
to the already-generated Paynow browser URL. Chrome applies the initiating
document's form-action policy to that redirect chain, so the storefront's
self-only policy blocks the Paynow hop.

This patch changes only STOREFRONT_PUBLIC_HEADERS. The legacy/simple HTML helper
keeps form-action 'self'. Pricing, order creation, Paynow URL generation,
entitlement, webhooks, and all non-CSP behavior remain byte-identical.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

EXPECTED_LIVE_SHA256 = "a2da15a78e6d685fe644d22fdc6f68a02e3dad3f7b3e263d360082e13afee4a5"
OLD_STOREFRONT_CSP = "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
NEW_STOREFRONT_CSP = "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://www.paynow.co.zw"
LEGACY_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

REQUIRED_PRESERVED = (
    "MUSITU_DIRECT_PAYNOW_FALLBACK_V1",
    "DIRECT_PAYNOW_FALLBACK_ACTIVE=true",
    "https://www.paynow.co.zw/payment/link/?q=",
    "status='direct_pending'",
    "if(req.method==='POST'&&p==='/chemistry/checkout/start')return checkoutPost(req,env)",
    "return new Response(null,{status:303,headers:{location:created.browserUrl",
    "manual_verified_settlement_only",
    "Premium remains locked until MUSITU independently verifies settlement",
    "/chemistry/webhooks/paynow",
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def patch(text: str) -> str:
    if text.count(OLD_STOREFRONT_CSP) != 1:
        raise SystemExit(f"expected exactly one live storefront CSP anchor, found {text.count(OLD_STOREFRONT_CSP)}")
    if text.count(LEGACY_CSP) != 1:
        raise SystemExit(f"legacy CSP identity drift: found {text.count(LEGACY_CSP)}")
    if NEW_STOREFRONT_CSP in text:
        raise SystemExit("Paynow storefront form-action origin already present; refusing double patch")
    for token in REQUIRED_PRESERVED:
        if token not in text:
            raise SystemExit(f"required existing commerce behavior missing before patch: {token}")
    out = text.replace(OLD_STOREFRONT_CSP, NEW_STOREFRONT_CSP, 1)
    if out.count(NEW_STOREFRONT_CSP) != 1:
        raise SystemExit("storefront CSP handoff patch did not converge exactly")
    if out.count(LEGACY_CSP) != 1:
        raise SystemExit("legacy/simple CSP changed unexpectedly")
    for token in REQUIRED_PRESERVED:
        if token not in out:
            raise SystemExit(f"commerce behavior changed unexpectedly: {token}")
    if out.count("https://www.paynow.co.zw") != text.count("https://www.paynow.co.zw") + 1:
        raise SystemExit("unexpected Paynow-origin delta")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--allow-sha", default=EXPECTED_LIVE_SHA256)
    args = ap.parse_args()
    raw = Path(args.input).read_bytes()
    got = sha256(raw)
    if got != args.allow_sha:
        raise SystemExit(f"input live Worker SHA mismatch: {got} != {args.allow_sha}")
    out = patch(raw.decode("utf-8")).encode("utf-8")
    Path(args.output).write_bytes(out)
    print("MUSITU_PAYNOW_HANDOFF_CSP_PATCH=PASS")
    print("INPUT_SHA256=" + got)
    print("OUTPUT_SHA256=" + sha256(out))
    print("OUTPUT_BYTES=" + str(len(out)))
    print("CHANGED_SEMANTIC=STOREFRONT_PUBLIC_HEADERS form-action adds exact https://www.paynow.co.zw")
    print("LEGACY_CSP_PRESERVED=TRUE")


if __name__ == "__main__":
    main()
