#!/usr/bin/env python3
from __future__ import annotations

import email
import email.policy
import hashlib
import json
import os
import pathlib
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.cloudflare.com/client/v4"
AID = os.environ["ACCOUNT_ID"]
ZID = os.environ["ZONE_ID"]
ZONE = os.environ["ZONE_NAME"]
HOST = os.environ["PAYMENTS_HOST"]
ORIGIN = os.environ["PAYMENTS_ORIGIN"]
WORKER = os.environ["STORE_WORKER"]
ROUTE = os.environ["STORE_ROUTE"]
BUCKET = os.environ["STORE_BUCKET"]
BASE = "https://" + HOST
BASELINE = pathlib.Path(os.environ["BASELINE_MODULE_ROOT"])
CANDIDATE = pathlib.Path(os.environ["CANDIDATE_MODULE_ROOT"])
EVIDENCE = pathlib.Path(os.environ.get("PHASE2_DEPLOY_EVIDENCE", "/tmp/musitu-store-phase2-deploy-evidence"))
EVIDENCE.mkdir(parents=True, exist_ok=True)

SEALED_MAIN = os.environ["SEALED_MAIN"]
PHASE1_HEAD = os.environ["PHASE1_HEAD"]
PHASE2_HEAD = os.environ["PHASE2_HEAD"]
CATALOG_SHA = os.environ["CATALOG_SHA"]
CATALOG_SIG_SHA = os.environ["CATALOG_SIG_SHA"]
STORE_SHA = os.environ["STORE_SHA"]
STORE_BYTES = int(os.environ["STORE_BYTES"])
CANDIDATE_WORKER_SHA = os.environ["CANDIDATE_WORKER_SHA"]

AUTH = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "Accept": "application/json",
    "User-Agent": "MUSITU-Store-Phase2-Standards-Hardening/1.0",
}

state = {
    "initial_snapshot_verified": False,
    "candidate_deployed_once": False,
    "rollback_drill_performed": False,
    "rollback_drill_verified": False,
    "candidate_redeployed_final": False,
    "emergency_rollback_performed": False,
    "final_state_verified": False,
}
checks: dict[str, object] = {}
snapshot_body: bytes | None = None
snapshot_content_type: str | None = None


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def req(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: int = 120):
    q = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    try:
        with urllib.request.urlopen(q, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def cf(path: str):
    code, _, raw = req(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError(f"Cloudflare GET {path} HTTP {code}: {raw[:300].decode('utf-8','ignore')}")
    obj = json.loads(raw or b"{}")
    if obj.get("success") is not True:
        raise RuntimeError("Cloudflare success=false " + path)
    return obj.get("result")


def pub(path: str, accept: str = "*/*"):
    sep = "&" if "?" in path else "?"
    return req(
        BASE + path + sep + "musitu_phase2_probe=" + str(time.time_ns()),
        "GET",
        {
            "Accept": accept,
            "User-Agent": "MUSITU-Store-Phase2-Production-Probe/1.0",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )


def verify_topology():
    zones = cf("/zones?name=" + urllib.parse.quote(ZONE) + "&status=active") or []
    if len(zones) != 1 or zones[0].get("id") != ZID or (zones[0].get("account") or {}).get("id") != AID:
        raise RuntimeError("canonical zone/account mismatch")
    domains = cf(f"/accounts/{AID}/workers/domains") or []
    matches = [d for d in domains if isinstance(d, dict) and d.get("hostname") == HOST]
    if len(matches) != 1 or matches[0].get("service") != ORIGIN:
        raise RuntimeError("payments Custom Domain owner drift")
    routes = cf(f"/zones/{ZID}/workers/routes") or []
    exact = [r for r in routes if isinstance(r, dict) and r.get("pattern") == ROUTE]
    if len(exact) != 1 or exact[0].get("script") != WORKER:
        raise RuntimeError("Store route drift")
    settings = cf(f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/settings") or {}
    bindings = {x.get("name"): x for x in settings.get("bindings") or [] if isinstance(x, dict)}
    if set(bindings) != {"STORE_RELEASES", "STORE_RUNTIME_PUBLICATION_STATE"}:
        raise RuntimeError("Store binding set drift")
    if bindings["STORE_RELEASES"].get("type") != "r2_bucket" or bindings["STORE_RELEASES"].get("bucket_name") != BUCKET:
        raise RuntimeError("Store R2 binding drift")
    if bindings["STORE_RUNTIME_PUBLICATION_STATE"].get("type") != "plain_text" or bindings["STORE_RUNTIME_PUBLICATION_STATE"].get("text") != "production":
        raise RuntimeError("Store runtime-state binding drift")
    sub = cf(f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/subdomain") or {}
    if sub.get("enabled") is not False or sub.get("previews_enabled") is not False:
        raise RuntimeError("Store workers.dev exposure drift")


def parse_worker_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    if "multipart/" not in content_type.lower():
        raise RuntimeError("live Worker is not multipart modules")
    raw = ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + body
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    parts: dict[str, bytes] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition") or part.get_filename()
        if name:
            payload = part.get_payload(decode=True)
            if payload is not None:
                parts[str(name)] = payload
    return parts


def snapshot_live_worker_and_verify_baseline():
    global snapshot_body, snapshot_content_type
    path = f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, headers, body = req(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError("failed to snapshot live Store Worker")
    ctype = headers.get("Content-Type") or headers.get("content-type")
    if not ctype:
        raise RuntimeError("live Store Worker snapshot missing Content-Type")
    parts = parse_worker_multipart(ctype, body)
    names = {"worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs"}
    actual = {k: v for k, v in parts.items() if k in names}
    if set(actual) != names:
        raise RuntimeError("live Worker module set mismatch: " + repr(sorted(parts)))
    module_hashes = {}
    for name in sorted(names):
        expected = (BASELINE / name).read_bytes()
        if actual[name] != expected:
            raise RuntimeError("live Worker module drift before Phase 2: " + name)
        module_hashes[name] = sha(actual[name])
    snapshot_body = body
    snapshot_content_type = ctype
    state["initial_snapshot_verified"] = True
    checks["initial_snapshot_sha256"] = sha(body)
    checks["initial_module_sha256"] = module_hashes


def worker_metadata():
    return {
        "main_module": "worker.mjs",
        "compatibility_date": "2026-09-09",
        "bindings": [
            {"type": "r2_bucket", "name": "STORE_RELEASES", "bucket_name": BUCKET},
            {"type": "plain_text", "name": "STORE_RUNTIME_PUBLICATION_STATE", "text": "production"},
        ],
    }


def multipart_modules(module_root: pathlib.Path):
    boundary = "----MUSITUPHASE2" + secrets.token_hex(18)
    out: list[bytes] = []

    def add(value: str | bytes):
        out.append(value.encode() if isinstance(value, str) else value)

    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(worker_metadata(), separators=(",", ":")))
    add("\r\n")
    for name in ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs"):
        data = (module_root / name).read_bytes()
        add(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\nContent-Type: application/javascript+module\r\n\r\n')
        add(data)
        add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(out)


def upload_candidate():
    boundary, body = multipart_modules(CANDIDATE)
    headers = dict(AUTH)
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    path = f"{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, _, raw = req(path, "PUT", headers, body, 180)
    if not 200 <= code < 300:
        raise RuntimeError("Store Worker upload HTTP " + str(code) + " " + raw[:400].decode("utf-8", "ignore"))


def restore_snapshot():
    if snapshot_body is None or snapshot_content_type is None:
        raise RuntimeError("rollback Worker snapshot unavailable")
    headers = dict(AUTH)
    headers["Content-Type"] = snapshot_content_type
    path = f"{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, _, raw = req(path, "PUT", headers, snapshot_body, 180)
    if not 200 <= code < 300:
        raise RuntimeError("rollback Worker restore HTTP " + str(code) + " " + raw[:400].decode("utf-8", "ignore"))


def verify_release_identity():
    code, _, catalog = pub("/store/catalog.json", "application/json")
    if code != 200 or sha(catalog) != CATALOG_SHA:
        raise RuntimeError("catalog identity drift")
    code, _, sig = pub("/store/catalog.sig", "text/plain")
    if code != 200 or sha(sig) != CATALOG_SIG_SHA:
        raise RuntimeError("catalog signature drift")
    code, _, apk = pub("/store/bootstrap/MUSITU_Store_1.0.2.apk", "application/vnd.android.package-archive")
    if code != 200 or len(apk) != STORE_BYTES or sha(apk) != STORE_SHA:
        raise RuntimeError("Store APK identity drift")
    code, _, health_raw = pub("/store/healthz", "application/json")
    health = json.loads(health_raw or b"{}") if code == 200 else {}
    if not (
        health.get("ok") is True
        and health.get("runtime_publication_state") == "production"
        and health.get("catalog_revision") == 3
        and health.get("fresh_device_phase1_complete") is False
    ):
        raise RuntimeError("Store health invariant drift")


def verify_hardened_public_state():
    verify_topology()
    verify_release_identity()
    consecutive = 0
    observations = []
    for attempt in range(45):
        code, headers, body = pub("/store", "text/html")
        csp = headers.get("Content-Security-Policy") or headers.get("content-security-policy") or ""
        exact = (
            code == 200
            and b"MUSITU" in body
            and "worker-src 'self'" in csp
            and "font-src 'self'" in csp
            and "object-src 'none'" in csp
            and "frame-src 'none'" in csp
            and "upgrade-insecure-requests" in csp
            and "unsafe-inline" not in csp
            and "unsafe-eval" not in csp
            and (headers.get("Cross-Origin-Opener-Policy") or headers.get("cross-origin-opener-policy")) == "same-origin"
            and (headers.get("X-Permitted-Cross-Domain-Policies") or headers.get("x-permitted-cross-domain-policies")) == "none"
        )
        observations.append({"attempt": attempt + 1, "http": code, "hardened": exact, "cf_ray": headers.get("CF-Ray")})
        consecutive = consecutive + 1 if exact else 0
        if consecutive >= 3:
            break
        time.sleep(2)
    checks["hardened_convergence"] = {"consecutive": consecutive, "last": observations[-10:]}
    if consecutive < 3:
        raise RuntimeError("hardened Store headers did not converge")
    code, _, lite = pub("/store?lite=1", "text/html")
    if code != 200 or b"Low-bandwidth mode" not in lite:
        raise RuntimeError("low-bandwidth mode drift after hardening")
    code, _, offline = pub("/store/offline", "text/html")
    if code != 200 or b"Offline" not in offline:
        raise RuntimeError("offline route drift after hardening")


def verify_baseline_restored():
    verify_topology()
    verify_release_identity()
    path = f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}"
    code, headers, body = req(API + path, "GET", AUTH)
    if code != 200:
        raise RuntimeError("failed to read Worker after rollback drill")
    ctype = headers.get("Content-Type") or headers.get("content-type") or ""
    parts = parse_worker_multipart(ctype, body)
    for name in ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs"):
        if parts.get(name) != (BASELINE / name).read_bytes():
            raise RuntimeError("rollback drill module mismatch: " + name)


def verify_candidate_bytes():
    worker = (CANDIDATE / "worker.mjs").read_bytes()
    if sha(worker) != CANDIDATE_WORKER_SHA:
        raise RuntimeError("candidate worker hash mismatch")
    for name in ("render.mjs", "assets.mjs", "generated-data.mjs"):
        if (CANDIDATE / name).read_bytes() != (BASELINE / name).read_bytes():
            raise RuntimeError("unexpected non-worker module delta: " + name)
    checks["candidate_worker_sha256"] = sha(worker)


def write_evidence(gate: str, error: str | None = None):
    out = {
        "schema": "musitu.store.phase2.worker_only_deployment.v1",
        "gate": gate,
        "sealed_main": SEALED_MAIN,
        "phase1_head": PHASE1_HEAD,
        "phase2_head": PHASE2_HEAD,
        "store_version": "1.0.2",
        "catalog_revision": 3,
        "catalog_sha256": CATALOG_SHA,
        "catalog_signature_sha256": CATALOG_SIG_SHA,
        "store_apk_sha256": STORE_SHA,
        "store_apk_bytes": STORE_BYTES,
        "candidate_worker_sha256": CANDIDATE_WORKER_SHA,
        "production_scope": "Cloudflare Store Worker modules only; no R2/catalog/APK/commerce/licence mutation",
        "rollback_drill": "live snapshot restore verified, then hardened candidate re-deployed",
        "state": state,
        "checks": checks,
        "error": error,
    }
    raw = (json.dumps(out, indent=2, sort_keys=True) + "\n").encode()
    (EVIDENCE / "deployment.json").write_bytes(raw)
    (EVIDENCE / "deployment.sha256").write_text(sha(raw) + "  deployment.json\n")
    return out


def emergency_rollback():
    if snapshot_body is None:
        return
    restore_snapshot()
    state["emergency_rollback_performed"] = True
    verify_baseline_restored()


def main():
    verify_topology()
    verify_release_identity()
    verify_candidate_bytes()
    snapshot_live_worker_and_verify_baseline()
    try:
        upload_candidate()
        state["candidate_deployed_once"] = True
        verify_hardened_public_state()

        restore_snapshot()
        state["rollback_drill_performed"] = True
        verify_baseline_restored()
        state["rollback_drill_verified"] = True

        upload_candidate()
        state["candidate_redeployed_final"] = True
        verify_hardened_public_state()
        state["final_state_verified"] = True

        out = write_evidence("MUSITU_STORE_PHASE2_WORKER_DEPLOY_AND_ROLLBACK_PASS")
        print(json.dumps(out, sort_keys=True))
    except Exception as exc:
        original = repr(exc)
        rollback_error = None
        try:
            emergency_rollback()
        except Exception as rollback_exc:
            rollback_error = repr(rollback_exc)
        msg = original if rollback_error is None else original + " | EMERGENCY_ROLLBACK_ERROR=" + rollback_error
        out = write_evidence("MUSITU_STORE_PHASE2_WORKER_DEPLOY_FAIL", msg)
        print(json.dumps(out, sort_keys=True))
        raise RuntimeError(msg) from exc


if __name__ == "__main__":
    main()
