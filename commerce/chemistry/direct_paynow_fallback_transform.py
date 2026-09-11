#!/usr/bin/env python3
"""Minimal, fail-closed transform for the live MUSITU Chemistry checkout.

This transform is intentionally applied to an exact captured live Worker module,
not to a reconstructed/stale Worker. It adds a Paynow registered-member payment
fallback for fixed-price plans while preserving the existing automated checkout
and the verified-settlement entitlement boundary.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

DIRECT_URL = "https://www.paynow.co.zw/Payment/Find?search=evansmusitu5%40gmail.com"
MERCHANT_EMAIL = "evansmusitu5@gmail.com"
FALLBACK_MARKER = "data-direct-paynow-fallback"

FUNCTION_MARKER = "function renderCheckout({planId,planLabel,price,scope,deviceId='',isSchool=false}={}){\n"
FUNCTION_INSERT = r"""  const directPaynowUrl='https://www.paynow.co.zw/Payment/Find?search=evansmusitu5%40gmail.com';
  const directPlan=String(planId||'PLAN').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,20)||'PLAN';
  const directPayReference=`MUSITU-DIRECT-${directPlan}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase()}`;
  const directSupportUrl=`https://wa.me/263781572008?text=${encodeURIComponent(`MUSITU direct Paynow payment\nMUSITU reference: ${directPayReference}\nPaynow transaction reference: `)}`;
  const directPayFallback=isSchool?`<div class="notice" data-direct-paynow-fallback="school-contact"><strong>Direct Paynow fallback for School orders</strong><br>School pricing depends on the final seat count, so do not guess an amount. Use the normal checkout above or contact MUSITU support for a verified exact quote.</div>`:`<div class="notice" data-direct-paynow-fallback="fixed-price"><h3>Pay directly on Paynow</h3><p>If the automated checkout is unavailable, you can pay this fixed-price plan through Paynow's registered-member payment page.</p><dl><div><dt>Merchant account</dt><dd>evansmusitu5@gmail.com</dd></div><div><dt>Amount</dt><dd>${esc(price)}</dd></div><div><dt>MUSITU payment reference</dt><dd><code>${esc(directPayReference)}</code></dd></div></dl><ol><li>Open the Paynow direct-payment page below and confirm the merchant details before paying.</li><li>Enter the exact amount shown above.</li><li>Use the exact MUSITU payment reference shown above in Paynow's payment reference / description field.</li><li>After payment, send both the Paynow transaction reference and this MUSITU payment reference to MUSITU support for verification.</li></ol><p><a class="button secondary" href="${esc(directPaynowUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Pay directly on Paynow</a></p><p><a href="${esc(directSupportUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Send payment references to MUSITU support</a></p><p class="security-note"><strong>Verification boundary:</strong> direct Paynow payment does not automatically unlock Premium. MUSITU keeps Premium locked until settlement is independently verified. Do not pay twice.</p></div>`;
"""

BODY_MARKER = '</form><p class="microcopy">You will leave MUSITU for the payment-provider step. Payment credentials are entered with the provider, not into MUSITU or this storefront.</p></section></div>'
BODY_REPLACEMENT = '</form><p class="microcopy">You will leave MUSITU for the payment-provider step. Payment credentials are entered with the provider, not into MUSITU or this storefront.</p>${directPayFallback}</section></div>'


def transform(source: str) -> str:
    if FALLBACK_MARKER in source or DIRECT_URL in source:
        raise ValueError("direct Paynow fallback already present; refusing double patch")
    if source.count(FUNCTION_MARKER) != 1:
        raise ValueError(f"renderCheckout marker mismatch: {source.count(FUNCTION_MARKER)}")
    if source.count(BODY_MARKER) != 1:
        raise ValueError(f"checkout body marker mismatch: {source.count(BODY_MARKER)}")
    out = source.replace(FUNCTION_MARKER, FUNCTION_MARKER + FUNCTION_INSERT, 1)
    out = out.replace(BODY_MARKER, BODY_REPLACEMENT, 1)
    required = {
        "fallback marker": FALLBACK_MARKER,
        "direct URL": DIRECT_URL,
        "merchant email": MERCHANT_EMAIL,
        "unique reference prefix": "MUSITU-DIRECT-",
        "manual verification boundary": "does not automatically unlock Premium",
        "duplicate-payment warning": "Do not pay twice.",
        "school variable-price boundary": "School pricing depends on the final seat count",
    }
    missing = [name for name, token in required.items() if token not in out]
    if missing:
        raise ValueError("transformed source missing: " + ", ".join(missing))
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} INPUT OUTPUT", file=sys.stderr)
        return 2
    src = Path(argv[1])
    dst = Path(argv[2])
    raw = src.read_bytes()
    text = raw.decode("utf-8")
    out = transform(text).encode("utf-8")
    dst.write_bytes(out)
    print("BASE_SHA256=" + hashlib.sha256(raw).hexdigest())
    print("CANDIDATE_SHA256=" + hashlib.sha256(out).hexdigest())
    print("CANDIDATE_BYTES=" + str(len(out)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
