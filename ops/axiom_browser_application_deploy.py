#!/usr/bin/env python3
from __future__ import annotations

import argparse
from http.cookies import SimpleCookie
import hashlib
import html
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request


CF_API = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = "93f395f5121954671f92fffa453d6b61"
ZONE_ID = "5b56528f03948ff5917a5e0cd9f7109e"
ZONE_NAME = "mftintelligence.com"
D1_UUID = "504029cc-f9a5-495e-818f-63c6144b4ea4"
SERVICE = "musitu-axiom-browser-application"
APP_HOST = "app.mftintelligence.com"
APP_ORIGIN = f"https://{APP_HOST}"
INTEGRATION_ENTRY = "https://mftintelligence.com/axiom"
RESERVED_API_HOST = "axiom.mftintelligence.com"
ROUTE_PATTERNS = (
    "mftintelligence.com/axiom",
    "mftintelligence.com/axiom/*",
    "www.mftintelligence.com/axiom",
    "www.mftintelligence.com/axiom/*",
)


class Cloudflare:
    def __init__(self) -> None:
        email = os.environ.get("CLOUDFLARE_EMAIL", "")
        key = os.environ.get("CLOUDFLARE_GLOBAL_API_KEY", "")
        if not email or not key:
            raise RuntimeError("Cloudflare deployment credentials are unavailable")
        self.headers = {
            "X-Auth-Email": email,
            "X-Auth-Key": key,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "MUSITU-Axiom-Browser-Application-Deploy/1.0",
        }

    def call(self, path: str, method: str = "GET", body: dict | None = None):
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        request = urllib.request.Request(CF_API + path, headers=self.headers, data=data, method=method)
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        try:
            payload = json.loads(raw or b"{}")
        except Exception:
            payload = {}
        if not 200 <= status < 300 or payload.get("success") is False:
            raise RuntimeError(f"Cloudflare request failed: {method} {path} HTTP {status}")
        return payload.get("result")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):  # noqa: ANN001
        return None


NO_REDIRECT = urllib.request.build_opener(NoRedirect)


def http(
    url: str,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    follow_redirects: bool = True,
) -> tuple[int, object, bytes]:
    selected = urllib.request.build_opener() if follow_redirects else NO_REDIRECT
    request_headers = {
        "Accept": "*/*",
        "User-Agent": "MUSITU-Axiom-Browser-Application-Verify/1.0",
        **(headers or {}),
    }
    request = urllib.request.Request(url, headers=request_headers, data=body, method=method)
    try:
        with selected.open(request, timeout=35) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def records_by_name(rows: list[dict], name: str) -> list[dict]:
    return [row for row in rows if isinstance(row, dict) and row.get("hostname") == name]


def routes_by_pattern(rows: list[dict], pattern: str) -> list[dict]:
    return [row for row in rows if isinstance(row, dict) and row.get("pattern") == pattern]


def public_domain(row: dict) -> dict:
    return {key: row.get(key) for key in ("id", "hostname", "service", "environment", "zone_id") if row.get(key) is not None}


def public_route(row: dict) -> dict:
    return {key: row.get(key) for key in ("id", "pattern", "script") if row.get(key) is not None}


def live_topology(client: Cloudflare) -> dict:
    zones = client.call("/zones?" + urllib.parse.urlencode({"name": ZONE_NAME, "status": "active", "per_page": 50})) or []
    if len(zones) != 1:
        raise RuntimeError(f"expected one active {ZONE_NAME} zone, observed {len(zones)}")
    zone = zones[0]
    if zone.get("id") != ZONE_ID or (zone.get("account") or {}).get("id") != ACCOUNT_ID:
        raise RuntimeError("canonical Cloudflare zone/account identity mismatch")
    domains = client.call(f"/accounts/{ACCOUNT_ID}/workers/domains") or []
    routes = client.call(f"/zones/{ZONE_ID}/workers/routes") or []
    dns = client.call(f"/zones/{ZONE_ID}/dns_records?per_page=500") or []
    return {"zone": zone, "domains": domains, "routes": routes, "dns": dns}


def validate_target(topology: dict) -> dict:
    domains = topology["domains"]
    routes = topology["routes"]
    dns = topology["dns"]
    app_domains = records_by_name(domains, APP_HOST)
    if len(app_domains) > 1:
        raise RuntimeError("duplicate application custom-domain rows")
    if app_domains and app_domains[0].get("service") != SERVICE:
        raise RuntimeError("application hostname is already owned by another Worker")
    app_dns = [row for row in dns if isinstance(row, dict) and row.get("name") == APP_HOST]
    if not app_domains and app_dns:
        raise RuntimeError("application hostname already has DNS records; refusing origin override")
    target_routes: list[dict] = []
    for pattern in ROUTE_PATTERNS:
        matches = routes_by_pattern(routes, pattern)
        if len(matches) > 1:
            raise RuntimeError(f"duplicate Worker route: {pattern}")
        if matches and matches[0].get("script") != SERVICE:
            raise RuntimeError(f"integration route already belongs to another Worker: {pattern}")
        target_routes.extend(matches)
    reserved = records_by_name(domains, RESERVED_API_HOST)
    if len(reserved) != 1:
        raise RuntimeError("reserved production API domain authority is missing or duplicated")
    if reserved[0].get("service") == SERVICE:
        raise RuntimeError("browser application Worker cannot own the reserved production API domain")
    return {
        "app_domain": [public_domain(row) for row in app_domains],
        "app_dns": [
            {key: row.get(key) for key in ("id", "name", "type", "content", "proxied") if row.get(key) is not None}
            for row in app_dns
        ],
        "target_routes": [public_route(row) for row in target_routes],
        "reserved_api_domain": [public_domain(row) for row in reserved],
    }


def preflight(output: Path, source_sha: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        client = Cloudflare()
        selected = validate_target(live_topology(client))
        result = {
            "schema": "musitu.axiom.browser-application.production-preflight.v1",
            "status": "PASS",
            "source_git_sha": source_sha,
            "zone": {"id": ZONE_ID, "name": ZONE_NAME, "account_id": ACCOUNT_ID},
            "worker_service": SERVICE,
            "application_hostname": APP_HOST,
            "integration_entry": INTEGRATION_ENTRY,
            "integration_route_patterns": list(ROUTE_PATTERNS),
            "target_before": selected,
            "existing_apex_origin_override_authorized": False,
            "reserved_api_origin_repurpose_authorized": False,
            "write_performed": False,
        }
        output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"preflight": "PASS", "app_domain_exists": bool(selected["app_domain"]), "existing_target_routes": len(selected["target_routes"])}, sort_keys=True))
    except Exception as error:
        failure = {
            "schema": "musitu.axiom.browser-application.production-preflight.failure.v1",
            "status": "FAIL",
            "source_git_sha": source_sha,
            "error_type": type(error).__name__,
            "error": str(error),
            "write_performed": False,
            "existing_apex_origin_override_authorized": False,
            "reserved_api_origin_repurpose_authorized": False,
        }
        output.with_name("preflight-failure.json").write_text(
            json.dumps(failure, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        raise


def worker_settings(client: Cloudflare, source_sha: str) -> None:
    settings = client.call(f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(SERVICE, safe='')}/settings") or {}
    bindings = [row for row in (settings.get("bindings") or []) if isinstance(row, dict)]
    d1 = [row for row in bindings if row.get("name") == "AXIOM_DB" and row.get("type") == "d1"]
    if len(d1) != 1 or d1[0].get("id") != D1_UUID:
        raise RuntimeError("browser application Worker D1 binding mismatch")
    secret = [row for row in bindings if row.get("name") == "AXIOM_BROWSER_SESSION_SECRET" and row.get("type") in {"secret_text", "secret"}]
    if len(secret) != 1:
        raise RuntimeError("browser application Worker session secret binding missing")
    limiter = [row for row in bindings if row.get("name") == "AUTH_RATE_LIMITER" and row.get("type") in {"ratelimit", "rate_limit"}]
    if len(limiter) != 1:
        raise RuntimeError("browser application Worker authentication rate-limit binding missing")
    build = [row for row in bindings if row.get("name") == "BUILD_SHA" and row.get("type") == "plain_text"]
    if len(build) != 1 or build[0].get("text") != source_sha:
        raise RuntimeError("browser application Worker exact build SHA binding mismatch")


def wait_for_application(source_sha: str) -> dict:
    last = "unavailable"
    for _ in range(90):
        try:
            status, headers, body = http(f"{APP_ORIGIN}/health")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = f"{type(error).__name__}: application hostname is not reachable yet"
            time.sleep(2)
            continue
        try:
            payload = json.loads(body or b"{}")
        except Exception:
            payload = {}
        if (
            status == 200
            and payload.get("ok") is True
            and payload.get("build_sha") == source_sha
            and payload.get("app_origin") == APP_ORIGIN
            and payload.get("integration_entry") == INTEGRATION_ENTRY
            and payload.get("reserved_api_origin_preserved") is True
            and payload.get("normal_launch_download") is False
            and payload.get("account_session_integration") is True
            and headers.get("x-axiom-browser-application") == "production"
        ):
            return payload
        last = f"HTTP {status}; keys={sorted(payload) if isinstance(payload, dict) else []}"
        time.sleep(2)
    raise RuntimeError(f"application health did not reach the exact deployment contract: {last}")


def cookie_value(headers, name: str) -> str:  # noqa: ANN001
    for value in headers.get_all("Set-Cookie") or []:
        parsed = SimpleCookie()
        parsed.load(value)
        if name in parsed:
            return parsed[name].value
    return ""


def verify_static_application(source_sha: str) -> dict:
    status, headers, body = http(f"{APP_ORIGIN}/")
    content_type = (headers.get("content-type") or "").lower()
    if status != 200 or "text/html" not in content_type or headers.get("content-disposition") != "inline":
        raise RuntimeError("canonical browser application root did not return inline HTML")
    if b"MUSITU Axiom Workspace" not in body or body.startswith(b"PK"):
        raise RuntimeError("canonical browser application document content mismatch")
    if headers.get("x-axiom-browser-application") != "production":
        raise RuntimeError("canonical browser application hardening marker missing")
    deep_status, _, deep_body = http(f"{APP_ORIGIN}/index.html", headers={"Accept": "text/html"})
    if deep_status != 200 or b"MUSITU Axiom Workspace" not in deep_body:
        raise RuntimeError("browser application navigation fallback mismatch")
    manifest_status, manifest_headers, manifest_body = http(f"{APP_ORIGIN}/manifest.webmanifest", headers={"Accept": "application/manifest+json"})
    try:
        manifest = json.loads(manifest_body)
    except Exception as error:
        raise RuntimeError("production web manifest is invalid JSON") from error
    if manifest_status != 200 or manifest.get("start_url") != "./#/home" or manifest.get("scope") != "./" or manifest.get("prefer_related_applications") is not False:
        raise RuntimeError("production web manifest launch contract mismatch")
    if "json" not in (manifest_headers.get("content-type") or "").lower():
        raise RuntimeError("production web manifest content type mismatch")
    worker_status, worker_headers, worker_body = http(f"{APP_ORIGIN}/sw.js")
    if worker_status != 200 or worker_headers.get("service-worker-allowed") != "/" or b"/.well-known/axiom-session" not in worker_body:
        raise RuntimeError("production service worker contract mismatch")
    contract_status, _, contract_body = http(f"{APP_ORIGIN}/browser-app.json", headers={"Accept": "application/json"})
    try:
        contract = json.loads(contract_body)
    except Exception as error:
        raise RuntimeError("production browser application contract is invalid JSON") from error
    deployment = contract.get("deployment") or {}
    if (
        contract_status != 200
        or deployment.get("production_app_origin") != APP_ORIGIN
        or deployment.get("reserved_api_origin") != "https://axiom.mftintelligence.com"
        or (contract.get("actions") or {}).get("open_browser", {}).get("download") is not False
    ):
        raise RuntimeError("production browser application contract mismatch")
    return {
        "root_inline_html": True,
        "root_body_sha256": hashlib.sha256(body).hexdigest(),
        "navigation_fallback": True,
        "manifest_valid": True,
        "service_worker_valid": True,
        "open_launch_download_absent": True,
        "source_git_sha": source_sha,
    }


def verify_identity() -> dict:
    raw_key = os.environ.get("OPENAI_REVIEWER_ACCOUNT_KEY", "")
    normalized = re.sub(r"^[\s\u200E\u200F\u202A-\u202E\u2066-\u2069]+|[\s\u200E\u200F\u202A-\u202E\u2066-\u2069]+$", "", raw_key)
    if len(normalized) < 48:
        raise RuntimeError("reviewer account verification credential is unavailable")
    start_status, start_headers, start_body = http(f"{APP_ORIGIN}/auth/start")
    csrf_cookie = cookie_value(start_headers, "__Host-axiom_login_csrf")
    csrf_match = re.search(rb'name="csrf" value="([^"]+)"', start_body)
    if start_status != 200 or not csrf_cookie or not csrf_match:
        raise RuntimeError("browser account sign-in start contract mismatch")
    csrf = html.unescape(csrf_match.group(1).decode())
    form = urllib.parse.urlencode({"csrf": csrf, "musitu_account_key": normalized}).encode()
    login_status, login_headers, _ = http(
        f"{APP_ORIGIN}/auth/session",
        "POST",
        form,
        {
            "Accept": "text/html",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": f"__Host-axiom_login_csrf={csrf_cookie}",
            "Origin": APP_ORIGIN,
        },
        follow_redirects=False,
    )
    session_cookie = cookie_value(login_headers, "__Host-axiom_session")
    if login_status != 303 or login_headers.get("location") != "/#/home" or not session_cookie:
        raise RuntimeError("browser account authentication handoff mismatch")
    session_status, session_headers, session_body = http(
        f"{APP_ORIGIN}/.well-known/axiom-session",
        headers={"Accept": "application/json", "Cookie": f"__Host-axiom_session={session_cookie}"},
    )
    try:
        session = json.loads(session_body)
    except Exception as error:
        raise RuntimeError("authenticated browser session response is invalid JSON") from error
    allowed = {"schema", "authenticated", "subject", "display_name", "session_id", "assurance", "expires_at", "sign_out_path"}
    if (
        session_status != 200
        or session_headers.get("cache-control") != "no-store"
        or session.get("schema") != "musitu.axiom.browser-session.v1"
        or session.get("authenticated") is not True
        or not session.get("subject")
        or not session.get("display_name")
        or not session.get("session_id")
        or session.get("assurance") != "MUSITU_ACCOUNT_KEY_SERVER_SESSION"
        or session.get("sign_out_path") != "/auth/sign-out"
        or set(session) != allowed
    ):
        raise RuntimeError("authenticated browser session contract mismatch")
    signout_status, signout_headers, _ = http(
        f"{APP_ORIGIN}/auth/sign-out",
        "POST",
        b"",
        {"Accept": "application/json", "Cookie": f"__Host-axiom_session={session_cookie}", "Origin": APP_ORIGIN},
        follow_redirects=False,
    )
    if signout_status != 204 or "Max-Age=0" not in (signout_headers.get("set-cookie") or ""):
        raise RuntimeError("browser session sign-out contract mismatch")
    guest_status, guest_headers, guest_body = http(f"{APP_ORIGIN}/.well-known/axiom-session", headers={"Accept": "application/json"})
    try:
        guest = json.loads(guest_body)
    except Exception as error:
        raise RuntimeError("guest browser session response is invalid JSON") from error
    if guest_status != 200 or guest_headers.get("cache-control") != "no-store" or guest != {"schema": "musitu.axiom.browser-session.v1", "authenticated": False, "sign_in_path": "/auth/start"}:
        raise RuntimeError("guest browser session contract mismatch")
    return {
        "real_active_account_authentication": True,
        "http_only_session_restore": True,
        "account_key_returned_to_browser": False,
        "browser_credential_storage": False,
        "sign_out_verified": True,
        "guest_fallback_verified": True,
    }


def verify_integration_routes() -> dict:
    urls = (
        "https://mftintelligence.com/axiom",
        "https://mftintelligence.com/axiom/",
        "https://www.mftintelligence.com/axiom",
        "https://www.mftintelligence.com/axiom/",
    )
    last = "unavailable"
    for _ in range(90):
        checks = []
        for url in urls:
            try:
                status, headers, _ = http(url, follow_redirects=False)
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                last = f"{type(error).__name__}: integration entry is not reachable yet"
                break
            location = headers.get("location") or ""
            if status != 308 or location != f"{APP_ORIGIN}/":
                last = f"HTTP {status}: route has not reached the exact redirect contract yet"
                break
            checks.append({"entry": url, "http_status": status, "location": location})
        if len(checks) == len(urls):
            return {"direct_redirects": checks, "redirect_loop_absent": True}
        time.sleep(2)
    raise RuntimeError(f"apex integration routes did not reach the exact redirect contract: {last}")


def delete_created(client: Cloudflare, created_domain_id: str | None, created_route_ids: list[str]) -> dict:
    result = {"domain_deleted": False, "routes_deleted": [], "errors": []}
    for route_id in reversed(created_route_ids):
        try:
            client.call(f"/zones/{ZONE_ID}/workers/routes/{route_id}", "DELETE")
            result["routes_deleted"].append(route_id)
        except Exception as error:  # pragma: no cover - live failure path
            result["errors"].append(f"route:{route_id}:{type(error).__name__}")
    if created_domain_id:
        try:
            client.call(f"/accounts/{ACCOUNT_ID}/workers/domains/{created_domain_id}", "DELETE")
            result["domain_deleted"] = True
        except Exception as error:  # pragma: no cover - live failure path
            result["errors"].append(f"domain:{type(error).__name__}")
    return result


def write_evidence(directory: Path, name: str, payload: dict) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    (directory / f"{name}.sha256").write_text(f"{digest}  {name}\n", encoding="utf-8")
    return digest


def activate(preflight_path: Path, evidence_dir: Path, source_sha: str) -> None:
    prior = json.loads(preflight_path.read_text(encoding="utf-8"))
    if prior.get("status") != "PASS" or prior.get("source_git_sha") != source_sha:
        raise RuntimeError("deployment preflight is missing or belongs to another source SHA")
    client = Cloudflare()
    worker_settings(client, source_sha)
    before = validate_target(live_topology(client))
    if before != prior.get("target_before"):
        raise RuntimeError("Cloudflare target topology changed after preflight")
    created_domain_id: str | None = None
    created_route_ids: list[str] = []
    try:
        if not before["app_domain"]:
            client.call(f"/accounts/{ACCOUNT_ID}/workers/domains", "PUT", {
                "hostname": APP_HOST,
                "service": SERVICE,
                "zone_id": ZONE_ID,
                "zone_name": ZONE_NAME,
            })
            current = validate_target(live_topology(client))
            if len(current["app_domain"]) != 1 or not current["app_domain"][0].get("id"):
                raise RuntimeError("application custom-domain creation readback failed")
            created_domain_id = current["app_domain"][0]["id"]
        health = wait_for_application(source_sha)
        static = verify_static_application(source_sha)
        identity = verify_identity()
        current = validate_target(live_topology(client))
        existing_patterns = {row.get("pattern") for row in current["target_routes"]}
        for pattern in ROUTE_PATTERNS:
            if pattern in existing_patterns:
                continue
            created = client.call(f"/zones/{ZONE_ID}/workers/routes", "POST", {"pattern": pattern, "script": SERVICE}) or {}
            if not created.get("id"):
                raise RuntimeError(f"integration route creation did not return an id: {pattern}")
            created_route_ids.append(created["id"])
        after = validate_target(live_topology(client))
        if len(after["app_domain"]) != 1 or after["app_domain"][0].get("service") != SERVICE:
            raise RuntimeError("application custom-domain final readback mismatch")
        route_map = {row.get("pattern"): row.get("script") for row in after["target_routes"]}
        if route_map != {pattern: SERVICE for pattern in ROUTE_PATTERNS}:
            raise RuntimeError("path-isolated apex integration route readback mismatch")
        if after["reserved_api_domain"] != before["reserved_api_domain"]:
            raise RuntimeError("reserved production API domain changed during browser deployment")
        integration = verify_integration_routes()
        evidence = {
            "schema": "musitu.axiom.browser-application.production-deployment.v1",
            "status": "PASS",
            "source_git_sha": source_sha,
            "application_url": f"{APP_ORIGIN}/",
            "application_entry_url": f"{APP_ORIGIN}/#/home",
            "integration_entry_url": INTEGRATION_ENTRY,
            "worker_service": SERVICE,
            "application_domain": after["app_domain"][0],
            "integration_routes": after["target_routes"],
            "reserved_api_domain_before": before["reserved_api_domain"],
            "reserved_api_domain_after": after["reserved_api_domain"],
            "reserved_api_origin_preserved": True,
            "existing_apex_origin_overridden": False,
            "apex_routes_path_isolated": True,
            "worker_health": health,
            "static_application": static,
            "identity_integration": identity,
            "integration": integration,
            "production_deployment_claimed": True,
            "production_identity_integration_claimed": True,
            "phase13_earned_claimed": False,
            "phase14_earned_claimed": False,
        }
        digest = write_evidence(evidence_dir, "axiom-browser-application-production-deployment.json", evidence)
        print(json.dumps({"deployment": "PASS", "application_url": evidence["application_url"], "integration_entry_url": INTEGRATION_ENTRY, "evidence_sha256": digest}, sort_keys=True))
    except Exception as error:
        rollback = delete_created(client, created_domain_id, created_route_ids)
        failure = {
            "schema": "musitu.axiom.browser-application.production-deployment.failure.v1",
            "status": "FAIL",
            "source_git_sha": source_sha,
            "error_type": type(error).__name__,
            "error": str(error),
            "rollback": rollback,
            "reserved_api_origin_repurpose_authorized": False,
            "existing_apex_origin_override_authorized": False,
        }
        write_evidence(evidence_dir, "axiom-browser-application-production-deployment-failure.json", failure)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Fail-closed MUSITU Axiom browser application production deployment")
    subparsers = parser.add_subparsers(dest="command", required=True)
    preflight_parser = subparsers.add_parser("preflight")
    preflight_parser.add_argument("--output", type=Path, required=True)
    preflight_parser.add_argument("--source-sha", required=True)
    activate_parser = subparsers.add_parser("activate")
    activate_parser.add_argument("--preflight", type=Path, required=True)
    activate_parser.add_argument("--evidence-dir", type=Path, required=True)
    activate_parser.add_argument("--source-sha", required=True)
    arguments = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", arguments.source_sha):
        raise SystemExit("source SHA must be an exact 40-character lowercase Git commit")
    if arguments.command == "preflight":
        preflight(arguments.output, arguments.source_sha)
    else:
        activate(arguments.preflight, arguments.evidence_dir, arguments.source_sha)


if __name__ == "__main__":
    main()
