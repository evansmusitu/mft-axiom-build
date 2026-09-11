import email
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CF_API = os.environ["CF_API"]
ACCOUNT_ID = os.environ["ACCOUNT_ID"]
ZONE_ID = os.environ["ZONE_ID"]
BILLING_WORKER = os.environ.get("BILLING_WORKER", "mft-axiom-billing-ingress")
BILLING_ROUTE = os.environ.get("BILLING_ROUTE", "payments.mftintelligence.com/billing/*")
PAYMENTS_BASE = os.environ.get("PAYMENTS_BASE", "https://payments.mftintelligence.com")
CF_HEADERS = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "User-Agent": "MUSITU-Axiom-Billing-Return-UI-Hotfix/1.0",
}

MARKER = "MUSITU_AXIOM_PAYMENT_RETURN_UI_V1"
OLD_ROUTE = 'if(p==="/billing/return"&&req.method==="GET")return out(200,{ok:true,reference:u.searchParams.get("reference"),message:"Payment return received. Settlement is verified independently by MUSITU Axiom; query checkout status with your API key."});'
NEW_ROUTE = 'if(p==="/billing/return"&&req.method==="GET")return paymentReturn(u);'
EXPORT_ANCHOR = "export default{async fetch(req,env){"

HELPER = r'''
// MUSITU_AXIOM_PAYMENT_RETURN_UI_V1
const RETURN_HTML_HEADERS={
  "content-type":"text/html; charset=utf-8",
  "cache-control":"no-store, no-cache, must-revalidate",
  "pragma":"no-cache",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "x-frame-options":"DENY",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function paymentReturn(u){
  const raw=(u.searchParams.get("reference")||"").slice(0,120);
  const reference=escapeHtml(raw||"Not provided");
  const body=`<!doctype html><!--MUSITU_AXIOM_PAYMENT_RETURN_UI_V1--><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07110a"><title>MUSITU Axiom · Payment return</title><style>
  :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 0,#16311d 0,#0b170e 34%,#050906 72%);color:#f4f8f4;padding:24px}.card{width:min(100%,560px);background:rgba(13,25,16,.96);border:1px solid #2d4e35;border-radius:26px;padding:30px;box-shadow:0 24px 70px rgba(0,0,0,.45)}.brand{font-size:13px;font-weight:800;letter-spacing:.16em;color:#8ed39d;text-transform:uppercase}.icon{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;margin:22px 0 18px;background:#153b20;border:1px solid #377e47;font-size:30px;font-weight:900;color:#a8efb7}h1{font-size:clamp(28px,7vw,42px);line-height:1.05;margin:0 0 14px;letter-spacing:-.035em}.lead{font-size:17px;line-height:1.6;color:#c6d4c9;margin:0 0 22px}.status{padding:16px 18px;border-radius:16px;background:#0b1510;border:1px solid #263b2b;margin:0 0 18px}.status strong{display:block;color:#f4f8f4;margin-bottom:6px}.status span{display:block;color:#9fb0a3;font-size:14px;line-height:1.5}.ref{margin-top:18px;padding-top:18px;border-top:1px solid #243229}.ref-label{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#799080;margin-bottom:7px}.ref-value{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.55;color:#d9e8dc;word-break:break-all}.foot{margin:20px 0 0;color:#829186;font-size:13px;line-height:1.55}@media(max-width:420px){body{padding:14px}.card{padding:24px 20px;border-radius:22px}}
  </style></head><body><main class="card" aria-labelledby="title"><div class="brand">MUSITU Axiom</div><div class="icon" aria-hidden="true">✓</div><h1 id="title">Payment return received</h1><p class="lead">Your browser has returned safely from Paynow.</p><section class="status"><strong>Verification is in progress</strong><span>MUSITU Axiom verifies settlement independently before activating access. This return page cannot grant access by itself.</span><div class="ref"><div class="ref-label">Payment reference</div><div class="ref-value">${reference}</div></div></section><p class="foot">You can close this tab and return to the MUSITU Axiom app or session where you started checkout. Your access will update only after verified settlement.</p></main></body></html>`;
  return new Response(body,{status:200,headers:RETURN_HTML_HEADERS});
}
'''.strip()


def request(url, method="GET", headers=None, body=None, timeout=45):
    req = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()


def cf(path, method="GET", obj=None, expected=None):
    headers = dict(CF_HEADERS)
    body = None
    if obj is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    status, response_headers, raw = request(CF_API + path, method, headers, body)
    if expected is not None:
        if status not in expected:
            raise RuntimeError(f"Cloudflare HTTP {status} {path}: {raw[:400].decode('utf-8','ignore')}")
    elif not 200 <= status < 300:
        raise RuntimeError(f"Cloudflare HTTP {status} {path}: {raw[:400].decode('utf-8','ignore')}")
    try:
        parsed = json.loads(raw or b"{}")
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("success") is False:
        raise RuntimeError(f"Cloudflare success=false {path}: {str(parsed.get('errors'))[:400]}")
    return status, response_headers, raw, parsed


def extract_module(raw, content_type, needle):
    if "multipart/" not in (content_type or "").lower():
        return raw
    message = email.message_from_bytes((f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw)
    matches = []
    for part in message.walk():
        if part.is_multipart():
            continue
        data = part.get_payload(decode=True) or b""
        if needle.encode() in data:
            matches.append(data)
    if len(matches) != 1:
        raise RuntimeError(f"expected one executable billing module for {needle}, got {len(matches)}")
    return matches[0]


def read_worker():
    _, headers, raw, _ = cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(BILLING_WORKER, safe='')}")
    return extract_module(raw, headers.get("content-type", ""), "/billing/return")


def multipart(metadata, source):
    boundary = "----MUSITU" + secrets.token_hex(16)
    chunks = []

    def add(value):
        chunks.append(value.encode() if isinstance(value, str) else value)

    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(metadata, separators=(",", ":")))
    add("\r\n")
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
    add(source)
    add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(chunks)


def upload_source(source):
    boundary, body = multipart({"main_module": "index.mjs"}, source)
    headers = dict(CF_HEADERS)
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    status, _, raw = request(
        f"{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(BILLING_WORKER, safe='')}/content",
        "PUT",
        headers,
        body,
    )
    if not 200 <= status < 300:
        raise RuntimeError(f"content upload HTTP {status}: {raw[:500].decode('utf-8','ignore')}")


def syntax_check(source):
    path = Path("billing-return-ui-candidate.mjs")
    path.write_bytes(source)
    subprocess.run(["node", "--check", str(path)], check=True, stdout=subprocess.DEVNULL)


def route_invariant():
    _, _, _, payload = cf(f"/zones/{ZONE_ID}/workers/routes")
    exact = [
        row
        for row in (payload or {}).get("result") or []
        if isinstance(row, dict) and row.get("pattern") == BILLING_ROUTE and row.get("script") == BILLING_WORKER
    ]
    if len(exact) != 1:
        raise RuntimeError("billing route invariant failed")


def binding_signature():
    _, _, _, payload = cf(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(BILLING_WORKER, safe='')}/settings")
    result = (payload or {}).get("result") or {}
    bindings = result.get("bindings") or []
    return sorted((str(item.get("name")), str(item.get("type"))) for item in bindings if isinstance(item, dict))


def public(path, method="GET", body=None, headers=None):
    h = {"Accept": "application/json", "User-Agent": "MUSITU-Axiom-Billing-Return-UI-Probe/1.0"}
    h.update(headers or {})
    status, response_headers, raw = request(PAYMENTS_BASE + path, method, h, body, 30)
    return {
        "status": status,
        "content_type": response_headers.get("content-type", ""),
        "cache_control": response_headers.get("cache-control", ""),
        "x_content_type_options": response_headers.get("x-content-type-options", ""),
        "content_security_policy": response_headers.get("content-security-policy", ""),
        "body": raw.decode("utf-8", "replace"),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def machine_snapshot():
    return {
        "catalog": public("/billing/catalog"),
        "checkout_noauth": public(
            "/billing/checkout",
            "POST",
            b"{}",
            {"Content-Type": "application/json"},
        ),
        "not_found": public("/billing/this-route-does-not-exist"),
        "webhook_wrong_media": public(
            "/billing/webhooks/paynow",
            "POST",
            b"{}",
            {"Content-Type": "application/json"},
        ),
    }


def compact_probe(probe):
    return {
        "status": probe["status"],
        "content_type": probe["content_type"],
        "cache_control": probe["cache_control"],
        "sha256": probe["sha256"],
    }


def assert_machine_equal(expected, actual, label):
    if expected.keys() != actual.keys():
        raise RuntimeError(f"{label}: machine probe keys changed")
    for name in expected:
        a, b = expected[name], actual[name]
        if (a["status"], a["content_type"], a["cache_control"], a["body"]) != (
            b["status"],
            b["content_type"],
            b["cache_control"],
            b["body"],
        ):
            raise RuntimeError(f"{label}: machine endpoint changed: {name}")


def verify_return_ui(reference):
    probe = public("/billing/return?reference=" + urllib.parse.quote(reference, safe=""))
    if probe["status"] != 200:
        raise RuntimeError(f"return UI HTTP {probe['status']}")
    if not probe["content_type"].lower().startswith("text/html"):
        raise RuntimeError("return UI is not HTML")
    body = probe["body"]
    for token in (
        MARKER,
        "MUSITU Axiom",
        "Payment return received",
        "Verification is in progress",
        "This return page cannot grant access by itself.",
        reference,
    ):
        if token not in body:
            raise RuntimeError(f"return UI token missing: {token}")
    if body.lstrip().startswith("{") or '"ok":true' in body:
        raise RuntimeError("return UI still exposes raw JSON")
    if "no-store" not in probe["cache_control"].lower():
        raise RuntimeError("return UI cache policy is not no-store")
    if probe["x_content_type_options"].lower() != "nosniff":
        raise RuntimeError("return UI nosniff header absent")
    csp = probe["content_security_policy"].lower()
    if "default-src 'none'" not in csp or "frame-ancestors 'none'" not in csp:
        raise RuntimeError("return UI CSP invariant failed")
    return probe


def wait_until(check, label, attempts=18, sleep_seconds=5):
    last = None
    for _ in range(attempts):
        try:
            return check()
        except Exception as exc:
            last = exc
            time.sleep(sleep_seconds)
    raise RuntimeError(f"{label} did not converge: {last}")


def build_candidate(baseline):
    text = baseline.decode("utf-8")
    if MARKER in text:
        return baseline, "already_applied"
    if text.count(OLD_ROUTE) != 1:
        raise RuntimeError(f"expected exactly one legacy return route, found {text.count(OLD_ROUTE)}")
    if text.count(EXPORT_ANCHOR) != 1:
        raise RuntimeError(f"expected exactly one export anchor, found {text.count(EXPORT_ANCHOR)}")
    if "MUSITU Axiom Billing Ingress" not in text or "/billing/webhooks/paynow" not in text or "/billing/catalog" not in text:
        raise RuntimeError("billing source identity invariant failed")
    patched = text.replace(OLD_ROUTE, NEW_ROUTE, 1)
    patched = patched.replace(EXPORT_ANCHOR, HELPER + "\n" + EXPORT_ANCHOR, 1)
    if patched.count(MARKER) != 1 or patched.count(NEW_ROUTE) != 1 or OLD_ROUTE in patched:
        raise RuntimeError("candidate transform invariant failed")
    return patched.encode("utf-8"), "mutate"


def write_evidence(evidence):
    blob = (json.dumps(evidence, indent=2, sort_keys=True) + "\n").encode()
    Path("billing-return-ui-hotfix-evidence.json").write_bytes(blob)
    digest = hashlib.sha256(blob).hexdigest()
    Path("billing-return-ui-hotfix-evidence.sha256").write_text(
        digest + "  billing-return-ui-hotfix-evidence.json\n", encoding="utf-8"
    )
    return digest


baseline = None
candidate = None
mutated = False
try:
    route_invariant()
    initial_bindings = binding_signature()
    baseline = read_worker()
    baseline_sha = hashlib.sha256(baseline).hexdigest()
    candidate, mode = build_candidate(baseline)
    candidate_sha = hashlib.sha256(candidate).hexdigest()
    syntax_check(candidate)

    reference = "AXIOM-RETURN-UI-PROBE-20260911"

    if mode == "already_applied":
        final_return = wait_until(lambda: verify_return_ui(reference), "already-applied return UI")
        final_machine = machine_snapshot()
        if binding_signature() != initial_bindings:
            raise RuntimeError("binding signature changed during verification")
        evidence = {
            "schema": "musitu.axiom.billing_return_ui_hotfix.v1",
            "status": "ALREADY_APPLIED_VERIFIED",
            "worker": BILLING_WORKER,
            "route": BILLING_ROUTE,
            "baseline_sha256": baseline_sha,
            "candidate_sha256": candidate_sha,
            "source_mutated_this_run": False,
            "return_ui": compact_probe(final_return),
            "machine_endpoints": {k: compact_probe(v) for k, v in final_machine.items()},
            "bindings_preserved": True,
            "payment_transaction_created": False,
            "money_moved": False,
            "database_mutated": False,
            "secret_values_published": False,
            "gate": "AXIOM_BILLING_RETURN_UI_PASS",
        }
        evidence_sha = write_evidence(evidence)
        print(json.dumps({"gate": evidence["gate"], "mode": mode, "evidence_sha256": evidence_sha}, sort_keys=True))
        sys.exit(0)

    baseline_machine = machine_snapshot()
    baseline_return = public("/billing/return?reference=" + urllib.parse.quote(reference, safe=""))
    if baseline_return["status"] != 200 or not baseline_return["content_type"].lower().startswith("application/json"):
        raise RuntimeError("legacy return endpoint is not the expected JSON baseline")
    if '"Payment return received.' not in baseline_return["body"]:
        raise RuntimeError("legacy return JSON identity mismatch")

    upload_source(candidate)
    mutated = True
    if read_worker() != candidate:
        raise RuntimeError("candidate worker readback mismatch")
    if binding_signature() != initial_bindings:
        raise RuntimeError("binding signature changed after candidate deploy")
    candidate_return = wait_until(lambda: verify_return_ui(reference), "candidate return UI")
    candidate_machine = machine_snapshot()
    assert_machine_equal(baseline_machine, candidate_machine, "candidate")

    # Rollback drill: prove that the exact captured production module can be restored.
    upload_source(baseline)
    if read_worker() != baseline:
        raise RuntimeError("rollback worker readback mismatch")
    if binding_signature() != initial_bindings:
        raise RuntimeError("binding signature changed after rollback")

    def rollback_public_check():
        current = public("/billing/return?reference=" + urllib.parse.quote(reference, safe=""))
        if (current["status"], current["content_type"], current["body"]) != (
            baseline_return["status"],
            baseline_return["content_type"],
            baseline_return["body"],
        ):
            raise RuntimeError("legacy return response not yet restored")
        return current

    rollback_return = wait_until(rollback_public_check, "rollback public baseline")
    rollback_machine = machine_snapshot()
    assert_machine_equal(baseline_machine, rollback_machine, "rollback")

    # Final redeploy of the verified candidate.
    upload_source(candidate)
    if read_worker() != candidate:
        raise RuntimeError("final candidate worker readback mismatch")
    if binding_signature() != initial_bindings:
        raise RuntimeError("binding signature changed after final redeploy")
    final_return = wait_until(lambda: verify_return_ui(reference), "final return UI")
    final_machine = machine_snapshot()
    assert_machine_equal(baseline_machine, final_machine, "final")

    evidence = {
        "schema": "musitu.axiom.billing_return_ui_hotfix.v1",
        "status": "PASS_DEPLOY_ROLLBACK_REDEPLOY_VERIFIED",
        "worker": BILLING_WORKER,
        "route": BILLING_ROUTE,
        "baseline_sha256": baseline_sha,
        "candidate_sha256": candidate_sha,
        "source_mutated_this_run": True,
        "change_scope": "GET /billing/return browser presentation only",
        "return_before": compact_probe(baseline_return),
        "return_candidate": compact_probe(candidate_return),
        "return_rollback": compact_probe(rollback_return),
        "return_final": compact_probe(final_return),
        "machine_endpoints_before": {k: compact_probe(v) for k, v in baseline_machine.items()},
        "machine_endpoints_final": {k: compact_probe(v) for k, v in final_machine.items()},
        "machine_endpoints_preserved": True,
        "bindings_preserved": True,
        "rollback_performed": True,
        "rollback_verified": True,
        "final_candidate_redeployed": True,
        "payment_transaction_created": False,
        "money_moved": False,
        "database_mutated": False,
        "secret_values_published": False,
        "settlement_semantics_preserved": True,
        "gate": "AXIOM_BILLING_RETURN_UI_PASS",
    }
    evidence_sha = write_evidence(evidence)
    mutated = False
    print(
        json.dumps(
            {
                "gate": evidence["gate"],
                "mode": mode,
                "baseline_sha256": baseline_sha,
                "candidate_sha256": candidate_sha,
                "evidence_sha256": evidence_sha,
            },
            sort_keys=True,
        )
    )
except Exception as exc:
    if mutated and baseline is not None:
        try:
            upload_source(baseline)
            restored = read_worker() == baseline
            print(json.dumps({"emergency_rollback": restored}, sort_keys=True), file=sys.stderr)
        except Exception as rollback_exc:
            print(f"EMERGENCY_ROLLBACK_FAILED {type(rollback_exc).__name__}: {rollback_exc}", file=sys.stderr)
    print(f"FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
    sys.exit(1)
