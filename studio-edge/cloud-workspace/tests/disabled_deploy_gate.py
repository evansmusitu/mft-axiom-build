"""One-time safely unrouted private Worker deployment preflight/postflight.

No changes to existing Workers. Upstream workflow deploys ONLY the disabled
source-only Durable Objects candidate, with no workers.dev, preview URLs,
custom hostname, route, auth audience, rate binding, internal key or tenant.
This script makes GET requests only and verifies Access app deny-all hold.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from access_hold_bootstrap import (
    ACCOUNT, DOMAIN, HOST, APP_NAME, HoldBlocked, ensure_account,
    existing_apps, check_deny_all_app, api,
)

WORKER = "musitu-cloud-workspace-durable-private-candidate"
BASE = "https://api.cloudflare.com/client/v4"
ARTIFACT = "musitu-cloud-workspace-disabled-worker-verification.json"


def workers_get(path, token, opener=urllib.request.urlopen):
    if path not in (
        f"/accounts/{ACCOUNT}/workers/scripts",
        f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/subdomain",
    ):
        raise HoldBlocked("WORKER_API_SCOPE_DENIED")
    req = urllib.request.Request(
        BASE + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
        method="GET",
    )
    try:
        with opener(req, timeout=18) as resp:
            if resp.status != 200:
                raise HoldBlocked("WORKER_READ_INVALID")
            raw = resp.read(262145)
    except urllib.error.HTTPError as err:
        raise HoldBlocked("WORKER_HTTP_" + str(err.code)) from None
    except urllib.error.URLError:
        raise HoldBlocked("WORKER_NETWORK_UNAVAILABLE") from None
    if len(raw) > 262144:
        raise HoldBlocked("WORKER_READ_OVERSIZE")
    try:
        result = json.loads(raw)
    except (TypeError, ValueError):
        raise HoldBlocked("WORKER_JSON_INVALID") from None
    if not isinstance(result, dict) or result.get("success") is not True:
        raise HoldBlocked("WORKER_API_DENIED")
    return result


def scripts(token, opener):
    response = workers_get(f"/accounts/{ACCOUNT}/workers/scripts", token, opener)
    values = response.get("result")
    if not isinstance(values, list):
        raise HoldBlocked("WORKER_LIST_INVALID")
    info = response.get("result_info")
    # If pagination exists, an incomplete first page must not be confused with
    # the absence of a conflicting script.
    if isinstance(info, dict):
        total = info.get("total_count", len(values))
        if not isinstance(total, int) or total != len(values):
            raise HoldBlocked("WORKER_INVENTORY_INCOMPLETE")
    elif len(values) >= 100:
        raise HoldBlocked("WORKER_INVENTORY_UNBOUNDED")
    if any(not isinstance(s, dict) or not isinstance(s.get("id"), str) for s in values):
        raise HoldBlocked("WORKER_LIST_INVALID")
    return values


def prove_access_hold(token, opener):
    ensure_account(token, opener)
    apps = existing_apps(token, opener)
    matching = [app for app in apps if isinstance(app, dict) and
                (str(app.get("domain") or "").lower() == HOST or
                 app.get("name") == APP_NAME)]
    if len(matching) != 1 or matching[0].get("domain") != HOST:
        raise HoldBlocked("ACCESS_HOLD_NOT_UNIQUE")
    appid = matching[0].get("id")
    if not isinstance(appid, str):
        raise HoldBlocked("ACCESS_HOLD_ID_INVALID")
    full = api("GET", f"/accounts/{ACCOUNT}/access/apps/{appid}",
               token, opener=opener).get("result")
    return check_deny_all_app(full, token, opener)


def qualify(phase, token, opener=urllib.request.urlopen):
    if phase not in ("preflight", "postdeploy"):
        raise HoldBlocked("DEPLOY_PHASE_INVALID")
    held = prove_access_hold(token, opener)
    names = [w["id"] for w in scripts(token, opener)]
    count = names.count(WORKER)
    if phase == "preflight":
        if count:
            raise HoldBlocked("WORKER_NAME_ALREADY_OCCUPIED")
        return {"status": "PRIVATE_DISABLED_DEPLOY_PREFLIGHT", "can_deploy_new_script": True,
                "access_policies": held["access_policies"],
                "user_access_enabled": False, "service_enabled": False}
    if count != 1:
        raise HoldBlocked("WORKER_NOT_UNIQUELY_CREATED")
    state = workers_get(
        f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/subdomain", token, opener
    ).get("result")
    if (not isinstance(state, dict) or state.get("enabled") is not False or
        state.get("previews_enabled") is not False):
        raise HoldBlocked("WORKER_SUBDOMAIN_OR_PREVIEW_EXPOSED")
    return {"status": "PRIVATE_DISABLED_DEPLOY_READBACK", "worker_present": True,
            "workers_dev_enabled": False, "preview_urls_enabled": False,
            "access_policies": 0, "user_access_enabled": False,
            "service_enabled": False, "private_origin_connected": False}


def main():
    if (os.environ.get("EXPECTED_ACCOUNT_ID") != ACCOUNT or
        os.environ.get("EXPECTED_DOMAIN") != DOMAIN or
        os.environ.get("WORKSPACE_DISABLE_DEPLOY_INTENT") != "CREATE_UNROUTED_DISABLED_ONLY"):
        print("BLOCKED: canonical account or disabled deployment intent mismatch")
        return 2
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("BLOCKED: GitHub Cloudflare token not present")
        return 3
    try:
        result = qualify(os.environ.get("WORKSPACE_DEPLOY_PHASE", ""), token)
        if os.environ.get("WORKSPACE_DEPLOY_PHASE") == "postdeploy":
            Path(ARTIFACT).write_text(json.dumps({
                "schema": "musitu.workspace.disabled_worker.v1",
                "canonical_account": ACCOUNT, "domain": DOMAIN,
                "access_application": HOST, **result
            }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(result["status"], "access_policies:", result["access_policies"],
              "NO WORKSPACE OPERATIONS OR USER ACCESS ENABLED")
        return 0
    except HoldBlocked as e:
        print("BLOCKED WORKSPACE DISABLED DEPLOYMENT:", str(e),
              "NO RETRY OR PROTECTED WORKER MUTATIONS")
        return 4


if __name__ == "__main__":
    sys.exit(main())
