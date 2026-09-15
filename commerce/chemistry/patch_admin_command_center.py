#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib
from pathlib import Path

EXPECTED_LIVE_SHA256 = "d6ad30d11205a0bfaff008aeb3e9ae46075518186e7c717ba82b5a9e6c3bc567"
MODULE_ANCHOR = "async function createOrder(env,{plan,holder,email,deviceId,seatsInput})"
ROUTE_ANCHOR = "if(req.method==='POST'&&p==='/chemistry/checkout/start')return checkoutPost(req,env)"
ROUTE_INSERT = "if(p==='/chemistry/admin'||p.startsWith('/chemistry/admin/'))return adminRouterV2(req,env);"
DEFAULT_MODULES = (
    'commerce/chemistry/admin_command_center_module.mjs',
    'commerce/chemistry/admin_command_center_ui_v2.mjs',
)

PRESERVE = (
    "const DIRECT_PAYNOW_FALLBACK_ACTIVE=false;",
    "currency:'USD'",
    "'USD','initiating'",
    "/internal/paynow/sign-initiate-chemistry",
    "/internal/paynow/initiate",
    "return new Response(null,{status:303,headers:{location:created.browserUrl",
    "form-action 'self' https://www.paynow.co.zw",
    "/chemistry/webhooks/paynow",
    "/chemistry/claim",
    "/chemistry/install",
    "/chemistry/app",
)

REQUIRED_ADMIN = (
    "async function adminRouter(req,env)",
    "async function adminRouterV2(req,env)",
    "async function adminCashSale(req,env,ctx)",
    "async function adminPaynowOrder(req,env,ctx)",
    "async function adminTransferDevice(req,env,ctx)",
    "async function adminRefund(req,env,ctx)",
    "async function adminCreateUser(req,env,ctx)",
    "async function adminOrder360(req,env,ctx)",
    "async function adminFinance(req,env,ctx)",
    "async function adminAuditVerify(env,ctx)",
    "CHEMISTRY_ADMIN_OWNER_TOKEN",
    "chemistry_admin_audit",
    "chemistry_cash_sessions",
    "chemistry_payments",
    "chemistry_receipts",
    "Customer 360",
    "Cash Desk",
    "Finance & Reconciliation",
    "Team & Roles",
)

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def combined_modules(paths=DEFAULT_MODULES) -> str:
    return ''.join(Path(p).read_text(encoding='utf-8').strip()+"\n\n" for p in paths)

def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--allow-sha',default=EXPECTED_LIVE_SHA256)
    args=ap.parse_args()
    raw=Path(args.input).read_bytes(); got=sha(raw)
    if got!=args.allow_sha: raise SystemExit(f'input live Worker SHA mismatch: {got} != {args.allow_sha}')
    text=raw.decode('utf-8')
    modules=combined_modules()
    if text.count(MODULE_ANCHOR)!=1: raise SystemExit(f'module anchor count {text.count(MODULE_ANCHOR)}')
    if text.count(ROUTE_ANCHOR)!=1: raise SystemExit(f'route anchor count {text.count(ROUTE_ANCHOR)}')
    if ROUTE_INSERT in text or 'async function adminRouter(req,env)' in text or 'async function adminRouterV2(req,env)' in text: raise SystemExit('admin command center already present')
    for token in PRESERVE:
        if token not in text: raise SystemExit('required existing behavior missing: '+token)
    for token in REQUIRED_ADMIN:
        if token not in modules: raise SystemExit('required admin behavior missing: '+token)
    candidate=text.replace(MODULE_ANCHOR,modules+MODULE_ANCHOR,1)
    candidate=candidate.replace(ROUTE_ANCHOR,ROUTE_INSERT+ROUTE_ANCHOR,1)
    for token in PRESERVE:
        if token not in candidate: raise SystemExit('existing behavior changed unexpectedly: '+token)
    if candidate.count(ROUTE_INSERT)!=1: raise SystemExit('admin route insertion mismatch')
    if candidate.count('async function adminRouter(req,env)')!=1 or candidate.count('async function adminRouterV2(req,env)')!=1: raise SystemExit('admin module insertion mismatch')
    out=candidate.encode('utf-8');Path(args.output).write_bytes(out)
    print('MUSITU_ADMIN_COMMAND_CENTER_PATCH=PASS')
    print('INPUT_SHA256='+got)
    print('OUTPUT_SHA256='+sha(out))
    print('OUTPUT_BYTES='+str(len(out)))
    print('PUBLIC_COMMERCE_PRESERVED=TRUE')
    print('SECURE_USD_PAYNOW_PRESERVED=TRUE')
    print('ADMIN_ROUTE_ADDED=TRUE')
    print('ADMIN_OPERATOR_UI=V2')

if __name__=='__main__': main()
