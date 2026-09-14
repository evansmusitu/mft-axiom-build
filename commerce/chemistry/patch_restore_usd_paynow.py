#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib
from pathlib import Path

EXPECTED='9461afb5c86667574ea3e10bfdffdd22788db3e19ee28915f5d0f44b1808a830'

REPLACEMENTS=(
("const DIRECT_PAYNOW_FALLBACK_ACTIVE=true;","const DIRECT_PAYNOW_FALLBACK_ACTIVE=false;"),
("You will leave MUSITU for the Paynow payment step. Keep the MUSITU order reference shown by Paynow and your Paynow receipt/reference. Payment credentials are entered with Paynow, not into MUSITU or this storefront. During the temporary direct-payment fallback, Premium remains locked until MUSITU independently verifies settlement.",
 "You will leave MUSITU for the secure Paynow payment step. Payment credentials are entered with Paynow, not into MUSITU or this storefront. Premium is issued only after MUSITU independently verifies Paynow settlement."),
("<li>If payment is pending, do not create repeated payments. Premium stays locked until settlement is independently verified.</li><li><strong>Temporary direct Paynow route:</strong> keep both the MUSITU order reference and the Paynow receipt/reference. If activation is not automatic, send those references through MUSITU support so settlement can be verified before a signed licence is issued.</li>",
 "<li>If payment is pending, do not create repeated payments. Premium stays locked until settlement is independently verified.</li>"),
("direct_paynow_entitlement_mode:'manual_verified_settlement_only'","direct_paynow_entitlement_mode:'provider_verified_settlement_only'"),
)

REQUIRED=(
"async function initiateProvider(env,reference,q)",
"/internal/paynow/sign-initiate-chemistry",
"/internal/paynow/initiate",
"return new Response(null,{status:303,headers:{location:created.browserUrl",
"currency:'USD'",
"'USD','initiating'",
"https://www.paynow.co.zw",
"form-action 'self' https://www.paynow.co.zw",
)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',required=True);ap.add_argument('--output',required=True);args=ap.parse_args()
    raw=Path(args.input).read_bytes(); got=hashlib.sha256(raw).hexdigest()
    if got!=EXPECTED: raise SystemExit(f'live Worker SHA mismatch {got}')
    text=raw.decode('utf-8')
    for old,new in REPLACEMENTS:
        if text.count(old)!=1: raise SystemExit(f'expected one anchor, found {text.count(old)}: {old[:70]}')
        text=text.replace(old,new,1)
    for token in REQUIRED:
        if token not in text: raise SystemExit('required secure Paynow behavior missing: '+token)
    if 'DIRECT_PAYNOW_FALLBACK_ACTIVE=true' in text: raise SystemExit('direct fallback still active')
    out=text.encode('utf-8'); Path(args.output).write_bytes(out)
    print('MUSITU_RESTORE_USD_PAYNOW_PATCH=PASS')
    print('INPUT_SHA256='+got)
    print('OUTPUT_SHA256='+hashlib.sha256(out).hexdigest())
    print('OUTPUT_BYTES='+str(len(out)))
    print('DIRECT_PAYNOW_FALLBACK_ACTIVE=FALSE')
    print('SECURE_PROVIDER_PATH_PRESERVED=TRUE')
    print('PRICING_CHANGED=FALSE')

if __name__=='__main__': main()
