#!/usr/bin/env python3
from pathlib import Path
import sys

from browser_machine_presentation import apply_to_worker as apply_browser_machine_presentation

worker = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("store/phase1/web-surface/worker.mjs")
text = worker.read_text(encoding="utf-8")

old_csp = "'Content-Security-Policy':\"default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; manifest-src 'self'\","
new_csp = "'Content-Security-Policy':\"default-src 'none'; style-src 'self'; script-src 'self'; worker-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; manifest-src 'self'; upgrade-insecure-requests\","
old_headers = "'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',\n  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()'"
new_headers = "'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',\n  'Cross-Origin-Opener-Policy':'same-origin','X-Permitted-Cross-Domain-Policies':'none',\n  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()'"

has_new_csp = new_csp in text
has_new_headers = new_headers in text
if has_new_csp != has_new_headers:
    raise SystemExit("partial Phase-2 security hardening detected")

if not has_new_csp:
    if text.count(old_csp) != 1:
        raise SystemExit(f"expected exactly one baseline CSP block, found {text.count(old_csp)}")
    if text.count(old_headers) != 1:
        raise SystemExit(f"expected exactly one baseline security-header block, found {text.count(old_headers)}")
    text = text.replace(old_csp, new_csp, 1).replace(old_headers, new_headers, 1)
    worker.write_text(text, encoding="utf-8")

apply_browser_machine_presentation(worker)

post = worker.read_text(encoding="utf-8")
required = [
    "worker-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "upgrade-insecure-requests",
    "'Cross-Origin-Opener-Policy':'same-origin'",
    "'X-Permitted-Cross-Domain-Policies':'none'",
    "const MACHINE_ENDPOINT_INFO={",
    "machineDataResponse",
]
for token in required:
    if token not in post:
        raise SystemExit(f"hardening token missing after transform: {token}")
for forbidden in ["unsafe-inline", "unsafe-eval", "*;"]:
    if forbidden in post.split("const SECURITY={", 1)[1].split("};", 1)[0]:
        raise SystemExit(f"forbidden SECURITY token present: {forbidden}")

print("MUSITU_STORE_PHASE2_SECURITY_AND_BROWSER_PRESENTATION_APPLIED")
