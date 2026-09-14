#!/usr/bin/env python3
"""Minimal exact-live patch for MUSITU Chemistry -> Paynow browser handoff.

The checkout form posts only to MUSITU. The server then returns a 303 to the
already-generated Paynow browser URL. Chrome applies the document's form-action
policy to that redirect chain, so a self-only policy blocks the Paynow hop.
This patch preserves every commerce behavior and only permits the exact Paynow
HTTPS origin as an additional form-navigation destination.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

EXPECTED_LIVE_SHA256 = "a2da15a78e6d685fe644d22fdc6f68a02e3dad3f7b3e263d360082e13afee4a5"
OLD = "form-action 'self'"
NEW = "form-action 'self' https://www.paynow.co.zw"

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
    if text.count(OLD) != 1:
        raise SystemExit(f"expected exactly one self-only form-action policy, found {text.count(OLD)}")
    if NEW in text:
        raise SystemExit("Paynow form-action origin already present; refusing double patch")
    for token in REQUIRED_PRESERVED:
        if token not in text:
            raise SystemExit(f"required existing commerce behavior missing before patch: {token}")
    out = text.replace(OLD, NEW, 1)
    if out.count(NEW) != 1 or OLD in out.replace(NEW, "", 1):
        raise SystemExit("CSP handoff patch did not converge exactly")
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
    print("CHANGED_SEMANTIC=form-action allow exact https://www.paynow.co.zw")


if __name__ == "__main__":
    main()
