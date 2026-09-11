#!/usr/bin/env python3
"""Patch the exact live MUSITU Chemistry Worker with a temporary Paynow simple-link fallback.

The merchant email is supplied only at build/deploy time through PAYNOW_MERCHANT_EMAIL.
It is intentionally not committed to the public repository.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

EXPECTED_LIVE_SHA256 = "7e3b9b188a9e69399e120f0a36b90bc63ac37e5bae87a2b731e67b565ee3573c"
MARKER = "MUSITU_DIRECT_PAYNOW_FALLBACK_V1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def patch(source: str, merchant_email: str) -> str:
    if MARKER in source:
        raise SystemExit("direct Paynow fallback marker already present")
    if not merchant_email or "@" not in merchant_email or any(c in merchant_email for c in "\r\n\0"):
        raise SystemExit("invalid PAYNOW_MERCHANT_EMAIL")

    merchant_js = json.dumps(merchant_email, ensure_ascii=True)

    plans_anchor = """const PLANS=Object.freeze({
  term:{amount_cents:499,seats:1,months:4,label:'Term'},
  annual:{amount_cents:999,seats:1,months:12,label:'Annual'},
  lifetime:{amount_cents:1999,seats:1,months:null,label:'Lifetime'},
  family:{amount_cents:2499,seats:4,months:12,label:'Family'},
  tutor:{amount_cents:3900,seats:10,months:12,label:'Tutor'},
  school:{amount_cents:null,seats:null,months:12,label:'School'}
});
"""
    plans_replacement = plans_anchor + f"""
// {MARKER}
const DIRECT_PAYNOW_FALLBACK_ACTIVE=true;
const DIRECT_PAYNOW_MERCHANT_EMAIL={merchant_js};
function directPaynowUrl(reference,amountCents){{
  const ref=String(reference||'').trim();
  if(!/^MC-[A-Z0-9-]+$/.test(ref))throw new Error('invalid_direct_payment_reference');
  const cents=Number(amountCents);
  if(!Number.isInteger(cents)||cents<1)throw new Error('invalid_direct_payment_amount');
  const args=`search=${{encodeURIComponent(DIRECT_PAYNOW_MERCHANT_EMAIL)}}&amount=${{encodeURIComponent(money(cents))}}&reference=${{encodeURIComponent(ref)}}&l=1`;
  const q=encodeURIComponent(btoa(args));
  return `https://www.paynow.co.zw/payment/link/?q=${{q}}`;
}}
"""
    source = replace_once(source, plans_anchor, plans_replacement, "plan/direct-link insertion")

    create_anchor = """  try{const p=await initiateProvider(env,reference,q);await env.CHEMISTRY_DB.prepare("UPDATE chemistry_orders SET status='pending',browser_url=?2,poll_url=?3,updated_at=?4 WHERE reference=?1").bind(reference,p.browserurl,p.pollurl,nowIso()).run();return {reference,clientSecret,browserUrl:p.browserurl,q}}catch(e){await env.CHEMISTRY_DB.prepare("UPDATE chemistry_orders SET status='initiation_failed',updated_at=?2 WHERE reference=?1").bind(reference,nowIso()).run();throw e}
"""
    create_replacement = """  if(DIRECT_PAYNOW_FALLBACK_ACTIVE){const browserUrl=directPaynowUrl(reference,q.amount_cents);await env.CHEMISTRY_DB.prepare("UPDATE chemistry_orders SET status='direct_pending',browser_url=?2,poll_url=NULL,updated_at=?3 WHERE reference=?1").bind(reference,browserUrl,nowIso()).run();return {reference,clientSecret,browserUrl,q,directFallback:true}}
  try{const p=await initiateProvider(env,reference,q);await env.CHEMISTRY_DB.prepare("UPDATE chemistry_orders SET status='pending',browser_url=?2,poll_url=?3,updated_at=?4 WHERE reference=?1").bind(reference,p.browserurl,p.pollurl,nowIso()).run();return {reference,clientSecret,browserUrl:p.browserurl,q,directFallback:false}}catch(e){await env.CHEMISTRY_DB.prepare("UPDATE chemistry_orders SET status='initiation_failed',updated_at=?2 WHERE reference=?1").bind(reference,nowIso()).run();throw e}
"""
    source = replace_once(source, create_anchor, create_replacement, "createOrder fallback")

    checkout_copy_old = """<p class=\"microcopy\">You will leave MUSITU for the payment-provider step. Payment credentials are entered with the provider, not into MUSITU or this storefront.</p>"""
    checkout_copy_new = """<p class=\"microcopy\">You will leave MUSITU for the Paynow payment step. Keep the MUSITU order reference shown by Paynow and your Paynow receipt/reference. Payment credentials are entered with Paynow, not into MUSITU or this storefront. During the temporary direct-payment fallback, Premium remains locked until MUSITU independently verifies settlement.</p>"""
    source = replace_once(source, checkout_copy_old, checkout_copy_new, "checkout direct-payment copy")

    support_old = """<li>If payment is pending, do not create repeated payments. Premium stays locked until settlement is independently verified.</li>"""
    support_new = """<li>If payment is pending, do not create repeated payments. Premium stays locked until settlement is independently verified.</li><li><strong>Temporary direct Paynow route:</strong> keep both the MUSITU order reference and the Paynow receipt/reference. If activation is not automatic, send those references through MUSITU support so settlement can be verified before a signed licence is issued.</li>"""
    source = replace_once(source, support_old, support_new, "support direct-payment copy")

    health_old = """return json({ok:db,service:'MUSITU Chemistry Commerce',version:'1.0.0',provider:'paynow',catalog_configured:true,checkout_enabled:db,licence_key_id:String(env?.CHEMISTRY_LICENSE_KEY_ID||DEFAULT_KEY_ID),raw_paynow_key_present:Boolean(env.PAYNOW_INTEGRATION_KEY),payment_authority_bound:Boolean(env.PAYMENT_AUTHORITY),transport_bound:Boolean(env.PAYNOW_TRANSPORT)},db?200:503)"""
    health_new = """return json({ok:db,service:'MUSITU Chemistry Commerce',version:'1.0.0',provider:'paynow',catalog_configured:true,checkout_enabled:db,direct_paynow_fallback_active:DIRECT_PAYNOW_FALLBACK_ACTIVE,direct_paynow_entitlement_mode:'manual_verified_settlement_only',licence_key_id:String(env?.CHEMISTRY_LICENSE_KEY_ID||DEFAULT_KEY_ID),raw_paynow_key_present:Boolean(env.PAYNOW_INTEGRATION_KEY),payment_authority_bound:Boolean(env.PAYMENT_AUTHORITY),transport_bound:Boolean(env.PAYNOW_TRANSPORT)},db?200:503)"""
    source = replace_once(source, health_old, health_new, "health fallback disclosure")

    test_old = """export const _test={safeProviderUrl,addMonths,sha256Hex,parseForm,checkoutPage};"""
    test_new = """export const _test={safeProviderUrl,addMonths,sha256Hex,parseForm,checkoutPage,directPaynowUrl,DIRECT_PAYNOW_FALLBACK_ACTIVE};"""
    source = replace_once(source, test_old, test_new, "test export")

    required = [
        MARKER,
        "DIRECT_PAYNOW_FALLBACK_ACTIVE=true",
        "status='direct_pending'",
        "https://www.paynow.co.zw/payment/link/?q=",
        "direct_paynow_fallback_active:DIRECT_PAYNOW_FALLBACK_ACTIVE",
        "manual_verified_settlement_only",
        "Premium remains locked until MUSITU independently verifies settlement",
        "initiateProvider(env,reference,q)",
        "/chemistry/webhooks/paynow",
        "payment_authority_bound:Boolean(env.PAYMENT_AUTHORITY)",
    ]
    missing = [x for x in required if x not in source]
    if missing:
        raise SystemExit("patched source missing required markers: " + repr(missing))
    forbidden = ["PAYNOW_INTEGRATION_KEY=", "unsafe_direct_entitlement"]
    hit = [x for x in forbidden if x in source]
    if hit:
        raise SystemExit("patched source contains forbidden markers: " + repr(hit))
    return source


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--allow-sha", default=EXPECTED_LIVE_SHA256)
    args = ap.parse_args()

    raw = Path(args.input).read_bytes()
    got = hashlib.sha256(raw).hexdigest()
    if got != args.allow_sha:
        raise SystemExit(f"input live Worker SHA mismatch: {got}")
    source = raw.decode("utf-8")
    merchant = (os.environ.get("PAYNOW_MERCHANT_EMAIL") or "").strip()
    out = patch(source, merchant).encode("utf-8")
    Path(args.output).write_bytes(out)
    print("DIRECT_PAYNOW_PATCH=PASS")
    print("INPUT_SHA256=" + got)
    print("OUTPUT_SHA256=" + hashlib.sha256(out).hexdigest())
    print("OUTPUT_BYTES=" + str(len(out)))
    print("MERCHANT_EMAIL_PERSISTED_IN_REPOSITORY=FALSE")


if __name__ == "__main__":
    main()
