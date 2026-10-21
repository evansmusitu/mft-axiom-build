"""Cloudflare Access **deny-all HOLD** self-hosted app bootstrap for MUSITU.

Only allowed write: create a brand-new, non-launcher Access app with NO allow,
bypass, or service-auth policy. Never touches existing Access apps, IdPs,
DNS, Workers, payments, MFA, D1, Durable Objects, memberships, or routes.
Fails closed on ambiguous account, policy, duplicate, stale or API results.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
DOMAIN = "mftintelligence.com"
HOST = "workspace.mftintelligence.com"
APP_NAME = "MUSITU Cloud Workspace — HOLD / DENY ALL"
BASE = "https://api.cloudflare.com/client/v4"
RESULT = Path("musitu-access-hold-assessment.json")
UUID = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$", re.I)


class HoldBlocked(Exception):
    pass


def api(method, path, token, data=None, opener=urllib.request.urlopen):
    prefix = f"/accounts/{ACCOUNT}/access/apps"
    allowed_get = (
        path.startswith("/zones?"),
        path == prefix + "?page=1&per_page=100",
        path.startswith(prefix + "/") and (path.endswith("/policies") or
                                           UUID.fullmatch(path[len(prefix)+1:]) is not None),
    )
    if (".." in path or not path.startswith("/") or
        (method == "GET" and not any(allowed_get)) or
        (method == "POST" and (path != prefix or data is None)) or
        method not in ("GET", "POST")):
        raise HoldBlocked("API_SCOPE_DENIED")
    req = urllib.request.Request(BASE + path,
                                 headers={"Authorization": "Bearer " + token,
                                          "Accept": "application/json",
                                          "Content-Type": "application/json"},
                                 data=json.dumps(data).encode() if data is not None else None,
                                 method=method)
    try:
        with opener(req, timeout=18) as response:
            if response.status not in (200, 201):
                raise HoldBlocked("API_STATUS_INVALID")
            raw = response.read(262145)
    except urllib.error.HTTPError as error:
        # Cloudflare error bodies may include account details. Never print them.
        raise HoldBlocked("API_HTTP_" + str(error.code)) from None
    except urllib.error.URLError:
        raise HoldBlocked("API_NETWORK_UNAVAILABLE") from None
    if len(raw) > 262144:
        raise HoldBlocked("API_RESPONSE_OVERSIZE")
    try:
        answer = json.loads(raw)
    except (TypeError, ValueError):
        raise HoldBlocked("API_RESPONSE_INVALID") from None
    if not isinstance(answer, dict) or answer.get("success") is not True:
        raise HoldBlocked("API_REJECTED")
    return answer


def existing_apps(token, opener):
    path = f"/accounts/{ACCOUNT}/access/apps?page=1&per_page=100"
    response = api("GET", path, token, opener=opener)
    apps = response.get("result")
    info = response.get("result_info")
    if not isinstance(apps, list) or not isinstance(info, dict):
        raise HoldBlocked("INCOMPLETE_APP_INVENTORY")
    total = info.get("total_count")
    if not isinstance(total, int) or total != len(apps) or total > 100:
        raise HoldBlocked("INCOMPLETE_APP_INVENTORY")
    return apps


def hostname(app):
    names = [app.get("domain", "")]
    for destination in app.get("destinations") or []:
        if isinstance(destination, dict):
            uri = destination.get("uri", "")
            if isinstance(uri, str) and uri:
                names.append(uri)
    return [urllib.parse.urlsplit(str(name) if "://" in str(name) else
                                      "https://" + str(name)).hostname or ""
            for name in names if name]


def ensure_account(token, opener):
    query = urllib.parse.urlencode({"name": DOMAIN, "page": 1, "per_page": 50})
    r = api("GET", "/zones?" + query, token, opener=opener).get("result")
    if not isinstance(r, list) or len(r) != 1:
        raise HoldBlocked("ACCOUNT_ZONE_AMBIGUOUS")
    zone = r[0]
    if (zone.get("name") != DOMAIN or zone.get("status") != "active" or
        (zone.get("account") or {}).get("id") != ACCOUNT):
        raise HoldBlocked("ACCOUNT_ZONE_MISMATCH")


def check_deny_all_app(app, token, opener):
    if (not isinstance(app, dict) or app.get("type") != "self_hosted" or
        app.get("name") != APP_NAME or app.get("domain") != HOST or
        not isinstance(app.get("id"), str) or not UUID.fullmatch(app["id"]) or
        not isinstance(app.get("aud"), str) or not (8 <= len(app["aud"]) <= 160) or
        app.get("app_launcher_visible") is not False or
        app.get("allow_authenticate_via_warp") is not False or
        app.get("options_preflight_bypass") is not False):
        raise HoldBlocked("APP_READBACK_NOT_DENY_ONLY")
    policies = api("GET", f"/accounts/{ACCOUNT}/access/apps/{app['id']}/policies",
                   token, opener=opener).get("result")
    if not isinstance(policies, list) or policies:
        raise HoldBlocked("ACCESS_POLICY_NOT_EMPTY")
    return {"state": "EXISTS_DENY_ALL", "app_id": app["id"],
            "audience": app["aud"], "access_policies": 0,
            "mfa_verified": False, "no_worker_deployed": True,
            "no_allow_policy_created": True}


def bootstrap(token, opener=urllib.request.urlopen):
    ensure_account(token, opener)
    apps = existing_apps(token, opener)
    possible = []
    for app in apps:
        if not isinstance(app, dict):
            raise HoldBlocked("INVALID_APP_INVENTORY")
        names = hostname(app)
        if HOST in names or ("*." + DOMAIN) in names:
            possible.append(app)
    if len(possible) > 1:
        raise HoldBlocked("OVERLAPPING_ACCESS_APPS")
    if possible:
        app = possible[0]
        if app.get("domain") != HOST or app.get("name") != APP_NAME:
            raise HoldBlocked("EXISTING_ACCESS_APP_COLLISION")
        full = api("GET", f"/accounts/{ACCOUNT}/access/apps/{app['id']}",
                   token, opener=opener).get("result")
        return check_deny_all_app(full, token, opener)
    body = {"name": APP_NAME, "type": "self_hosted", "domain": HOST,
            "policies": [], "app_launcher_visible": False,
            "allow_authenticate_via_warp": False,
            "options_preflight_bypass": False, "session_duration": "15m"}
    created = api("POST", f"/accounts/{ACCOUNT}/access/apps", token, body,
                  opener=opener).get("result")
    if not isinstance(created, dict) or created.get("domain") != HOST:
        raise HoldBlocked("NEW_APP_RESPONSE_UNVERIFIED")
    # Never retry the create when the response or readback is uncertain.
    app_id = created.get("id")
    if not isinstance(app_id, str) or not UUID.fullmatch(app_id):
        raise HoldBlocked("NEW_APP_ID_INVALID")
    readback = api("GET", f"/accounts/{ACCOUNT}/access/apps/{app_id}",
                   token, opener=opener).get("result")
    result = check_deny_all_app(readback, token, opener)
    result["state"] = "CREATED_DENY_ALL"
    return result


def main():
    if (os.environ.get("EXPECTED_ACCOUNT_ID") != ACCOUNT or
        os.environ.get("EXPECTED_DOMAIN") != DOMAIN or
        os.environ.get("MUSITU_ACCESS_HOLD_INTENT") != "CREATE_DENY_ALL_ONLY"):
        print("BLOCKED: canonical account and deny-all intent guards not met")
        return 2
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("BLOCKED: Cloudflare credential unavailable")
        return 3
    try:
        assessment = bootstrap(token)
        payload = {
            "schema": "musitu.cloud_workspace.access_hold.v1",
            "account_id": ACCOUNT, "domain": DOMAIN,
            "private_hostname": HOST,
            "private_mfa_verified": False,
            "tenant_provisioned": False,
            "worker_deployed": False,
            "cloud_workspace_enabled": False,
            **assessment,
        }
        RESULT.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n",
                          encoding="utf-8")
        print("MUSITU ACCESS HOLD:", assessment["state"],
              "POLICIES:", assessment["access_policies"],
              "NO MFA CLAIM, NO WORKER DEPLOYMENT, NO USER ACCESS")
        return 0
    except HoldBlocked as error:
        print("MUSITU ACCESS HOLD BLOCKED:", str(error), "NO AUTOMATIC RETRY")
        return 4


if __name__ == "__main__":
    sys.exit(main())
