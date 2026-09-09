from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
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
AUTH = {
    "X-Auth-Email": os.environ["CLOUDFLARE_EMAIL"],
    "X-Auth-Key": os.environ["CLOUDFLARE_GLOBAL_API_KEY"],
    "Accept": "application/json",
    "User-Agent": "MUSITU-Store-v101-Production-Upgrade/1.0",
}
WRANGLER = ["npx", "-y", "wrangler@" + os.environ["WRANGLER_VERSION"]]
ROOT = pathlib.Path.cwd()
CURRENT = ROOT / "store/phase1/web-surface"
ROLLBACK = pathlib.Path("/tmp/store-rollback/store/phase1/web-surface")
NEW_APK = pathlib.Path("/tmp/store-v101/MUSITU_Store_1.0.1.apk")
EVIDENCE = pathlib.Path("/tmp/store-v101-deploy-evidence")
EVIDENCE.mkdir(parents=True, exist_ok=True)
NEW_KEY = "bootstrap/MUSITU_Store_1.0.1.apk"
OLD_KEY = "bootstrap/MUSITU_Store_1.0.0.apk"

OLD_SHA = os.environ["OLD_STORE_SHA"]
OLD_BYTES = int(os.environ["OLD_STORE_BYTES"])
NEW_SHA = os.environ["NEW_STORE_SHA"]
NEW_BYTES = int(os.environ["NEW_STORE_BYTES"])
CHEM_SHA = os.environ["CHEMISTRY_SHA"]
CHEM_BYTES = int(os.environ["CHEMISTRY_BYTES"])
PRIOR_CATALOG_SHA = os.environ["PRIOR_PRODUCTION_CATALOG_SHA"]
SEALED_MAIN = os.environ["SEALED_MAIN"]
ROLLBACK_COMMIT = os.environ["ROLLBACK_COMMIT"]

state = {"new_object_uploaded": False, "worker_updated": False, "rollback_performed": False}
checks: dict[str, object] = {}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def req(url: str, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: int = 90):
    q = urllib.request.Request(url, headers=dict(headers or {}), method=method, data=body)
    try:
        with urllib.request.urlopen(q, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def cf(path: str, method: str = "GET", obj: object | None = None):
    h = dict(AUTH)
    body = None
    if obj is not None:
        h["Content-Type"] = "application/json"
        body = json.dumps(obj, separators=(",", ":")).encode()
    code, _, raw = req(API + path, method, h, body, 90)
    if not 200 <= code < 300:
        raise RuntimeError(f"Cloudflare {method} {path} HTTP {code}: " + raw[:300].decode("utf-8", "ignore"))
    try:
        out = json.loads(raw or b"{}")
    except Exception as exc:
        raise RuntimeError(f"Cloudflare invalid JSON: {method} {path}") from exc
    if isinstance(out, dict) and out.get("success") is False:
        raise RuntimeError("Cloudflare success=false " + path + " " + str(out.get("errors"))[:300])
    return out.get("result") if isinstance(out, dict) else None


def pub(path: str, accept: str = "*/*", ua: str = "MUSITU-Store-v101-Production-Probe/1.0"):
    return req(BASE + path, "GET", {"Accept": accept, "User-Agent": ua}, None, 90)


def wrangler(*args: str, check: bool = True):
    p = subprocess.run(
        WRANGLER + list(args),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
    )
    if check and p.returncode != 0:
        raise RuntimeError("Wrangler command failed: " + " ".join(args) + "\n" + p.stdout[-1200:])
    return p


def multipart_modules(metadata: dict, module_root: pathlib.Path):
    boundary = "----MUSITU" + secrets.token_hex(18)
    out: list[bytes] = []

    def add(value: str | bytes):
        out.append(value.encode() if isinstance(value, str) else value)

    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(metadata, separators=(",", ":")))
    add("\r\n")
    for name in ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs"):
        data = (module_root / name).read_bytes()
        add(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\nContent-Type: application/javascript+module\r\n\r\n')
        add(data)
        add("\r\n")
    add(f"--{boundary}--\r\n")
    return boundary, b"".join(out)


def worker_metadata():
    return {
        "main_module": "worker.mjs",
        "compatibility_date": "2026-09-09",
        "bindings": [
            {"type": "r2_bucket", "name": "STORE_RELEASES", "bucket_name": BUCKET},
            {"type": "plain_text", "name": "STORE_RUNTIME_PUBLICATION_STATE", "text": "production"},
        ],
    }


def upload_worker(module_root: pathlib.Path):
    boundary, body = multipart_modules(worker_metadata(), module_root)
    h = dict(AUTH)
    h["Content-Type"] = "multipart/form-data; boundary=" + boundary
    code, _, raw = req(
        f"{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}",
        "PUT",
        h,
        body,
        120,
    )
    if not 200 <= code < 300:
        raise RuntimeError("Store Worker upload HTTP " + str(code) + " " + raw[:500].decode("utf-8", "ignore"))


def verify_chemistry():
    code, _, raw = pub("/chemistry/healthz", "application/json")
    if code != 200 or json.loads(raw or b"{}").get("ok") is not True:
        raise RuntimeError("Chemistry health invariant failed")
    code, _, _ = pub("/chemistry/catalog", "application/json")
    if code != 200:
        raise RuntimeError("Chemistry catalog invariant failed")
    code, _, raw = pub(
        "/chemistry/download/MUSITU_Chemistry_Mastery_1.3.0.apk",
        "application/vnd.android.package-archive",
    )
    if code != 200 or len(raw) != CHEM_BYTES or sha(raw) != CHEM_SHA:
        raise RuntimeError("Chemistry stable APK invariant failed")


def verify_topology():
    zones = cf("/zones?name=" + urllib.parse.quote(ZONE) + "&status=active") or []
    if len(zones) != 1 or zones[0].get("id") != ZID or (zones[0].get("account") or {}).get("id") != AID:
        raise RuntimeError("canonical zone/account mismatch")
    domains = cf(f"/accounts/{AID}/workers/domains") or []
    dm = [d for d in domains if isinstance(d, dict) and d.get("hostname") == HOST]
    if len(dm) != 1 or dm[0].get("service") != ORIGIN:
        raise RuntimeError("payments Custom Domain owner drift")
    routes = cf(f"/zones/{ZID}/workers/routes") or []
    exact = [r for r in routes if isinstance(r, dict) and r.get("pattern") == ROUTE]
    if len(exact) != 1 or exact[0].get("script") != WORKER:
        raise RuntimeError("Store route drift")
    settings = cf(f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/settings") or {}
    bindings = {x.get("name"): x for x in settings.get("bindings") or [] if isinstance(x, dict)}
    if set(bindings) != {"STORE_RELEASES", "STORE_RUNTIME_PUBLICATION_STATE"}:
        raise RuntimeError("Store binding set drift: " + repr(sorted(bindings)))
    r2 = bindings["STORE_RELEASES"]
    runtime = bindings["STORE_RUNTIME_PUBLICATION_STATE"]
    if r2.get("type") != "r2_bucket" or r2.get("bucket_name") != BUCKET:
        raise RuntimeError("Store R2 binding drift")
    if runtime.get("type") != "plain_text" or runtime.get("text") != "production":
        raise RuntimeError("Store runtime-state binding drift")
    sub = cf(f"/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER, safe='')}/subdomain") or {}
    if sub.get("enabled") is not False or sub.get("previews_enabled") is not False:
        raise RuntimeError("Store workers.dev exposure drift")
    buckets_obj = cf(f"/accounts/{AID}/r2/buckets?name_contains=" + urllib.parse.quote(BUCKET) + "&per_page=100") or {}
    rows = buckets_obj.get("buckets") if isinstance(buckets_obj, dict) else buckets_obj
    if len([b for b in (rows or []) if isinstance(b, dict) and b.get("name") == BUCKET]) != 1:
        raise RuntimeError("Store bucket missing")
    return exact[0].get("id")


def r2_readback(key: str, out: pathlib.Path, expected_bytes: int, expected_sha: str):
    if out.exists():
        out.unlink()
    wrangler("r2", "object", "get", BUCKET + "/" + key, "--remote", "--file", str(out))
    raw = out.read_bytes()
    if len(raw) != expected_bytes or sha(raw) != expected_sha:
        raise RuntimeError("R2 readback mismatch " + key)


def r2_assert_absent(key: str):
    out = EVIDENCE / "absent-probe.bin"
    if out.exists():
        out.unlink()
    p = wrangler("r2", "object", "get", BUCKET + "/" + key, "--remote", "--file", str(out), check=False)
    if p.returncode == 0:
        raise RuntimeError("append-only target unexpectedly exists: " + key)
    if out.exists() and out.stat().st_size:
        raise RuntimeError("absent R2 probe produced bytes")
    if not re.search(r"not found|does not exist|NoSuchKey|404", p.stdout, re.I):
        raise RuntimeError("R2 absence was not proven; probe failed for another reason")


def verify_prior_state():
    route_id = verify_topology()
    code, _, raw = pub("/store/healthz", "application/json")
    if code != 200:
        raise RuntimeError("prior Store health HTTP " + str(code))
    health = json.loads(raw or b"{}")
    if not (
        health.get("ok") is True
        and health.get("runtime_publication_state") == "production"
        and health.get("phase2_authorized") is False
        and health.get("fresh_device_phase1_complete") is False
        and health.get("catalog_revision") == 1
    ):
        raise RuntimeError("prior Store health contract drift")
    code, _, raw = pub("/store/catalog.json", "application/json")
    if code != 200 or sha(raw) != PRIOR_CATALOG_SHA:
        raise RuntimeError("prior live catalog drift")
    code, _, raw = pub("/store/bootstrap/MUSITU_Store_1.0.0.apk", "application/vnd.android.package-archive")
    if code != 200 or len(raw) != OLD_BYTES or sha(raw) != OLD_SHA:
        raise RuntimeError("prior Store 1.0.0 public artifact drift")
    code, _, raw = pub("/store/bootstrap/MUSITU_Store_1.0.1.apk", "application/vnd.android.package-archive")
    if code != 404:
        raise RuntimeError("Store 1.0.1 public route is not empty pre-upgrade")
    verify_chemistry()
    r2_readback(OLD_KEY, EVIDENCE / "r2-old-preflight.apk", OLD_BYTES, OLD_SHA)
    r2_assert_absent(NEW_KEY)
    checks["preflight_route_id"] = route_id
    checks["preflight_catalog_revision"] = 1


def verify_new_state():
    route_id = verify_topology()
    ready = None
    for _ in range(30):
        code, _, raw = pub("/store/healthz", "application/json")
        if code == 200:
            try:
                h = json.loads(raw or b"{}")
            except Exception:
                h = {}
            if h.get("ok") is True and h.get("catalog_revision") == 2:
                ready = h
                break
        time.sleep(2)
    if ready is None:
        raise RuntimeError("Store revision 2 did not become ready")
    if ready.get("runtime_publication_state") != "production" or ready.get("phase2_authorized") is not False or ready.get("fresh_device_phase1_complete") is not False:
        raise RuntimeError("Store revision 2 runtime-state contract failed")
    expected_catalog = (ROOT / "store/phase1/catalog.json").read_bytes()
    expected_sig = (ROOT / "store/phase1/catalog.sig").read_bytes()
    code, _, raw = pub("/store/catalog.json", "application/json")
    if code != 200 or raw != expected_catalog:
        raise RuntimeError("public Store catalog revision 2 exact-byte mismatch")
    code, _, raw = pub("/store/catalog.sig", "text/plain")
    if code != 200 or raw != expected_sig:
        raise RuntimeError("public Store catalog signature exact-byte mismatch")
    code, headers, raw = pub("/store/bootstrap/MUSITU_Store_1.0.1.apk", "application/vnd.android.package-archive")
    if code != 200 or len(raw) != NEW_BYTES or sha(raw) != NEW_SHA or headers.get("X-Content-SHA256") != NEW_SHA:
        raise RuntimeError("public Store 1.0.1 artifact mismatch")
    code, _, raw = pub("/store/bootstrap/MUSITU_Store_1.0.0.apk", "application/vnd.android.package-archive")
    if code != 200 or len(raw) != OLD_BYTES or sha(raw) != OLD_SHA:
        raise RuntimeError("rollback Store 1.0.0 artifact drift")
    code, _, raw = pub("/store/install", "text/html", "Mozilla/5.0 (Linux; Android 14; Pixel 8)")
    if code != 200 or b"MUSITU_Store_1.0.1.apk" not in raw:
        raise RuntimeError("Android install surface does not point at 1.0.1")
    code, _, raw = pub("/store/sw.js", "application/javascript")
    if code != 200 or b"MUSITU_Store_1.0.1.apk" in raw or b"MUSITU_Store_1.0.0.apk" in raw:
        raise RuntimeError("installer entered offline service-worker cache")
    verify_chemistry()
    r2_readback(NEW_KEY, EVIDENCE / "r2-new-postdeploy.apk", NEW_BYTES, NEW_SHA)
    r2_readback(OLD_KEY, EVIDENCE / "r2-old-postdeploy.apk", OLD_BYTES, OLD_SHA)
    checks["postdeploy_route_id"] = route_id
    checks["postdeploy_catalog_revision"] = 2


def restore_prior_state():
    state["rollback_performed"] = True
    errors: list[str] = []
    if state["worker_updated"]:
        try:
            upload_worker(ROLLBACK)
        except Exception as exc:
            errors.append("worker_restore: " + repr(exc))
    if state["new_object_uploaded"]:
        try:
            p = wrangler("r2", "object", "delete", BUCKET + "/" + NEW_KEY, "--remote", check=False)
            if p.returncode != 0:
                errors.append("object_delete: " + p.stdout[-500:])
        except Exception as exc:
            errors.append("object_delete: " + repr(exc))
    try:
        route_id = verify_topology()
        code, _, raw = pub("/store/healthz", "application/json")
        health = json.loads(raw or b"{}") if code == 200 else {}
        if not (code == 200 and health.get("catalog_revision") == 1 and health.get("runtime_publication_state") == "production" and health.get("phase2_authorized") is False and health.get("fresh_device_phase1_complete") is False):
            raise RuntimeError("rollback health mismatch")
        code, _, raw = pub("/store/catalog.json", "application/json")
        if code != 200 or sha(raw) != PRIOR_CATALOG_SHA:
            raise RuntimeError("rollback catalog mismatch")
        code, _, raw = pub("/store/bootstrap/MUSITU_Store_1.0.0.apk", "application/vnd.android.package-archive")
        if code != 200 or len(raw) != OLD_BYTES or sha(raw) != OLD_SHA:
            raise RuntimeError("rollback 1.0.0 mismatch")
        code, _, _ = pub("/store/bootstrap/MUSITU_Store_1.0.1.apk", "application/vnd.android.package-archive")
        if code != 404:
            raise RuntimeError("rollback 1.0.1 route still public")
        verify_chemistry()
        r2_assert_absent(NEW_KEY)
        checks["rollback_route_id"] = route_id
        checks["rollback_verified"] = True
    except Exception as exc:
        errors.append("rollback_verify: " + repr(exc))
    if errors:
        raise RuntimeError("rollback incomplete: " + " | ".join(errors))


def write_evidence(gate: str, error: str | None = None, rollback_error: str | None = None):
    out = {
        "schema": "musitu.store.phase1.v101.production_upgrade_evidence.v1",
        "head_sha": os.environ.get("GITHUB_SHA"),
        "sealed_main": SEALED_MAIN,
        "rollback_commit": ROLLBACK_COMMIT,
        "prior_catalog_sha256": PRIOR_CATALOG_SHA,
        "new_catalog_revision": 2,
        "old_store_version": "1.0.0",
        "old_store_sha256": OLD_SHA,
        "new_store_version": "1.0.1",
        "new_store_sha256": NEW_SHA,
        "new_store_bytes": NEW_BYTES,
        "chemistry_apk_sha256": CHEM_SHA,
        "chemistry_invariants_preserved": checks.get("chemistry_preserved", True),
        "r2_append_only_key": NEW_KEY,
        "route": ROUTE,
        "worker": WORKER,
        "r2_bucket": BUCKET,
        "phase2_authorized": False,
        "fresh_device_phase1_complete": False,
        "private_signing_key_used": False,
        "rollback_performed": state["rollback_performed"],
        "checks": checks,
        "error": error,
        "rollback_error": rollback_error,
        "gate": gate,
    }
    raw = (json.dumps(out, indent=2, sort_keys=True) + "\n").encode()
    (EVIDENCE / "deployment.json").write_bytes(raw)
    (EVIDENCE / "deployment.sha256").write_text(sha(raw) + "  deployment.json\n")
    print(json.dumps({"gate": gate, "rollback_performed": state["rollback_performed"], "phase2_authorized": False}, sort_keys=True))


def main():
    if not NEW_APK.is_file() or NEW_APK.stat().st_size != NEW_BYTES or sha(NEW_APK.read_bytes()) != NEW_SHA:
        raise RuntimeError("locally reconstructed Store 1.0.1 APK drift")
    for root in (CURRENT, ROLLBACK):
        for name in ("worker.mjs", "render.mjs", "assets.mjs", "generated-data.mjs"):
            if not (root / name).is_file():
                raise RuntimeError("missing Worker module " + str(root / name))
    verify_prior_state()
    checks["chemistry_preserved"] = True
    wrangler(
        "r2", "object", "put", BUCKET + "/" + NEW_KEY,
        "--file=" + str(NEW_APK), "--remote",
        "--content-type=application/vnd.android.package-archive",
        '--content-disposition=attachment; filename="MUSITU_Store_1.0.1.apk"',
    )
    state["new_object_uploaded"] = True
    r2_readback(NEW_KEY, EVIDENCE / "r2-new-immediate.apk", NEW_BYTES, NEW_SHA)
    upload_worker(CURRENT)
    state["worker_updated"] = True
    verify_new_state()
    write_evidence("MUSITU_STORE_V101_PRODUCTION_DEPLOY_PASS")


if __name__ == "__main__":
    primary_error = None
    rollback_error = None
    try:
        main()
    except Exception as exc:
        primary_error = repr(exc)
        try:
            if state["new_object_uploaded"] or state["worker_updated"]:
                restore_prior_state()
        except Exception as rb_exc:
            rollback_error = repr(rb_exc)
        write_evidence("MUSITU_STORE_V101_PRODUCTION_DEPLOY_FAIL", primary_error, rollback_error)
        print("PRIMARY_ERROR=" + primary_error, file=sys.stderr)
        if rollback_error:
            print("ROLLBACK_ERROR=" + rollback_error, file=sys.stderr)
        raise SystemExit(1)
